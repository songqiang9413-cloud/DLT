#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(name + " is not a number");
  return Math.trunc(n);
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

const CONFIG = {
  rpcUrl: process.env.RPC_URL || "https://mainnet.base.org",
  logRpcUrl: process.env.LOG_RPC_URL || "",
  privateKey: (process.env.PRIVATE_KEY || "").trim(),
  lottery: process.env.LOTTERY_ADDRESS || "0x88B31E49Fd48108c132Aa0891DBd74caA5199A68",
  dlt: process.env.DLT_ADDRESS || "0xe9c553454B48C71537AC9Dddae495D9181E3990f",
  betCount: envInt("BET_COUNT", 1),
  betOffsetSeconds: envInt("BET_OFFSET_MINUTES", 5) * 60,
  minSecondsBeforeBoundary: envInt("MIN_SECONDS_BEFORE_BOUNDARY", 300),
  enableDraw: envBool("ENABLE_DRAW", true),
  startupLookback: envInt("STARTUP_LOOKBACK_PERIODS", 48),
  lookback: envInt("LOOKBACK_PERIODS", 3),
  betScanBlocks: envInt("BET_SCAN_BLOCKS", 2400),
  pollSeconds: envInt("POLL_SECONDS", 30),
  statusLogSeconds: envInt("STATUS_LOG_SECONDS", 300),
  minEth: ethers.parseEther(process.env.MIN_ETH_BALANCE || "0.00012"),
  dryRun: envBool("DRY_RUN", false) || process.argv.includes("--dry-run"),
  once: process.argv.includes("--once"),
  stateFile: process.env.STATE_FILE || path.join(__dirname, "state.json"),
  lockFile: process.env.LOCK_FILE || path.join(__dirname, "bot.lock"),
};

const LOTTERY_ABI = [
  "function currentPeriod() view returns (uint256)",
  "function rounds(uint256) view returns (uint64 betCount, uint64 requestBlock, bool requested, bool drawn, bool requestRewarded)",
  "function bet(uint256 count)",
  "function requestDraw(uint256 periodId)",
  "function executeDraw(uint256 periodId)",
  "function PERIOD_DURATION() view returns (uint256)",
  "function RANDOM_WAIT_BLOCK() view returns (uint256)",
  "function EXECUTE_WINDOW_BLOCKS() view returns (uint256)",
  "function BET_PRICE() view returns (uint256)",
  "event Bet(uint256 indexed periodId, address indexed bettor, uint256 count, uint256 amount)",
  "event DrawRequested(uint256 indexed periodId, address indexed caller, uint256 requestBlock, bool rewarded)",
  "event DrawExecuted(uint256 indexed periodId, address indexed winner, uint256 winnerIndex, uint256 winnerAmount, uint256 teamAmount, uint256 baseAmount, address caller)",
];

const DLT_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const CHAIN = {
  periodDuration: 3600,
  waitBlocks: 200,
  executeWindow: 255,
  betPrice: ethers.parseEther("2"),
};

let provider;
let logProvider;
let wallet;
let lottery;
let logLottery;
let dlt;
let state;
let lockOwned = false;
let running = true;
let lastStatusAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(CONFIG.lockFile, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      lockOwned = true;
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let pid = 0;
      try {
        pid = Number(fs.readFileSync(CONFIG.lockFile, "utf8").trim());
      } catch {
        pid = 0;
      }
      if (pid && processAlive(pid)) {
        log("another instance is running (pid " + pid + "); exiting");
        process.exit(0);
      }
      try {
        fs.unlinkSync(CONFIG.lockFile);
      } catch {
        // ignore
      }
    }
  }
  throw new Error("could not acquire lock");
}

function releaseLock() {
  if (!lockOwned) return;
  try {
    const pid = Number(fs.readFileSync(CONFIG.lockFile, "utf8").trim());
    if (pid === process.pid) fs.unlinkSync(CONFIG.lockFile);
  } catch {
    // ignore
  }
  lockOwned = false;
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG.stateFile, "utf8"));
    return {
      lastBetPeriod: String(raw.lastBetPeriod || "0"),
      pending: raw.pending && typeof raw.pending === "object" ? raw.pending : {},
    };
  } catch {
    return { lastBetPeriod: "0", pending: {} };
  }
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  const tmp = CONFIG.stateFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, CONFIG.stateFile);
}

async function retry(label, fn, tries = 5) {
  let delay = 1500;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e && (e.shortMessage || e.message) ? e.shortMessage || e.message : String(e);
      if (i === tries - 1) throw e;
      log("WARN " + label + ": " + msg + "; retry " + (i + 1) + "/" + tries + " in " + delay + "ms");
      await sleep(delay);
      delay = Math.min(delay * 2, 15000);
    }
  }
}

async function getChainTime() {
  const block = await retry("getBlock", () => provider.getBlock("latest"));
  if (!block) throw new Error("latest block not available");
  return { timestamp: Number(block.timestamp), blockNumber: Number(block.number) };
}

async function getBalances() {
  const [eth, dltBalance] = await Promise.all([
    retry("getBalance", () => provider.getBalance(wallet.address)),
    retry("dlt.balanceOf", () => dlt.balanceOf(wallet.address)),
  ]);
  return { eth, dlt: dltBalance };
}

async function hasGas() {
  const balance = await retry("getBalance", () => provider.getBalance(wallet.address));
  if (balance < CONFIG.minEth) {
    log("low ETH balance " + ethers.formatEther(balance) + " < " + ethers.formatEther(CONFIG.minEth) + "; skip tx");
    return false;
  }
  return true;
}

async function ensureApproval(cost) {
  const allowance = await retry("dlt.allowance", () => dlt.allowance(wallet.address, CONFIG.lottery));
  if (allowance >= cost) return true;
  if (CONFIG.dryRun) {
    log("DRY RUN: would approve DLT");
    return true;
  }
  if (!(await hasGas())) return false;
  const tx = await dlt.approve(CONFIG.lottery, ethers.MaxUint256);
  log("approve sent tx=" + tx.hash);
  const receipt = await tx.wait();
  log("approve confirmed block=" + receipt.blockNumber + " gas=" + receipt.gasUsed);
  return true;
}

async function hasBet(period) {
  if (String(state.lastBetPeriod) === String(period)) return true;
  const latest = await retry("getBlockNumber", () => provider.getBlockNumber());
  const fromBlock = Math.max(0, latest - CONFIG.betScanBlocks);
  const readers = logLottery ? [logLottery, lottery] : [lottery];
  for (const reader of readers) {
    try {
      const events = await retry("queryFilter Bet", () =>
        reader.queryFilter(reader.filters.Bet(BigInt(period), wallet.address), fromBlock, latest)
      );
      if (events.length > 0) {
        state.lastBetPeriod = String(period);
        saveState();
        return true;
      }
      return false;
    } catch (e) {
      const label = reader === logLottery ? "log RPC" : "primary RPC";
      log("WARN bet scan failed on " + label + ": " + (e.shortMessage || e.message));
    }
  }
  return false;
}

async function maybeBet(chainTime) {
  const period = Math.floor(chainTime.timestamp / CHAIN.periodDuration);
  const periodStart = period * CHAIN.periodDuration;
  const elapsed = chainTime.timestamp - periodStart;
  const remaining = CHAIN.periodDuration - elapsed;

  if (elapsed < CONFIG.betOffsetSeconds) {
    log("period " + period + ": bet offset in " + (CONFIG.betOffsetSeconds - elapsed) + "s");
    return;
  }
  if (remaining < CONFIG.minSecondsBeforeBoundary) {
    log("period " + period + ": only " + remaining + "s left; skip to avoid next-period landing");
    return;
  }
  if (await hasBet(period)) return;

  const cost = CHAIN.betPrice * BigInt(CONFIG.betCount);
  const balance = await getBalances();
  if (balance.dlt < cost) {
    log("period " + period + ": DLT " + ethers.formatEther(balance.dlt) + " < " + ethers.formatEther(cost) + "; skip bet");
    return;
  }
  if (balance.eth < CONFIG.minEth) {
    log("period " + period + ": ETH " + ethers.formatEther(balance.eth) + " < " + ethers.formatEther(CONFIG.minEth) + "; skip bet");
    return;
  }
  if (!(await ensureApproval(cost))) return;
  if (CONFIG.dryRun) {
    log("DRY RUN: would bet " + CONFIG.betCount + " in period " + period);
    return;
  }

  const tx = await lottery.bet(CONFIG.betCount);
  log("bet sent period=" + period + " tx=" + tx.hash);
  const receipt = await tx.wait();
  let actualPeriod = period;
  for (const entry of receipt.logs) {
    try {
      const parsed = lottery.interface.parseLog(entry);
      if (parsed && parsed.name === "Bet" && String(parsed.args.bettor).toLowerCase() === wallet.address.toLowerCase()) {
        actualPeriod = Number(parsed.args.periodId);
      }
    } catch {
      // ignore unrelated logs
    }
  }
  state.lastBetPeriod = String(actualPeriod);
  saveState();
  log("bet confirmed period=" + actualPeriod + " block=" + receipt.blockNumber + " gas=" + receipt.gasUsed);
  if (actualPeriod !== period) log("WARN bet landed in period " + actualPeriod + ", expected " + period);
}

async function sendRequest(period) {
  if (!(await hasGas())) return;
  if (CONFIG.dryRun) {
    log("DRY RUN: would requestDraw(" + period + ")");
    return;
  }
  const tx = await lottery.requestDraw(BigInt(period));
  log("requestDraw sent period=" + period + " tx=" + tx.hash);
  const receipt = await tx.wait();
  let requestBlock = null;
  for (const entry of receipt.logs) {
    try {
      const parsed = lottery.interface.parseLog(entry);
      if (parsed && parsed.name === "DrawRequested" && Number(parsed.args.periodId) === Number(period)) {
        requestBlock = Number(parsed.args.requestBlock);
      }
    } catch {
      // ignore unrelated logs
    }
  }
  if (requestBlock !== null) {
    state.pending[period] = { requestBlock };
    saveState();
  }
  log("requestDraw confirmed period=" + period + " block=" + receipt.blockNumber + " gas=" + receipt.gasUsed + " requestBlock=" + requestBlock);
}

async function sendExecute(period) {
  if (!(await hasGas())) return;
  if (CONFIG.dryRun) {
    log("DRY RUN: would executeDraw(" + period + ")");
    return;
  }
  const tx = await lottery.executeDraw(BigInt(period));
  log("executeDraw sent period=" + period + " tx=" + tx.hash);
  const receipt = await tx.wait();
  delete state.pending[period];
  saveState();
  log("executeDraw confirmed period=" + period + " block=" + receipt.blockNumber + " gas=" + receipt.gasUsed);
}

async function processPeriod(period, chainTime) {
  const round = await retry("rounds(" + period + ")", () => lottery.rounds(BigInt(period)));
  if (round.drawn) {
    if (state.pending[period]) {
      delete state.pending[period];
      saveState();
    }
    return;
  }
  if (round.betCount === 0n) return;

  const requestBlock = Number(round.requestBlock);
  const nowBlock = chainTime.blockNumber;

  if (!round.requested) {
    log("period " + period + ": betCount=" + round.betCount.toString() + " not requested; requesting");
    await sendRequest(period);
    return;
  }

  const entropyBlock = requestBlock + CHAIN.waitBlocks;
  if (nowBlock > entropyBlock && nowBlock <= entropyBlock + CHAIN.executeWindow) {
    log("period " + period + ": ready to execute (block " + nowBlock + ", entropy " + entropyBlock + ")");
    await sendExecute(period);
    return;
  }
  if (nowBlock >= requestBlock + CHAIN.waitBlocks + CHAIN.executeWindow + 1) {
    log("period " + period + ": window expired; re-requesting");
    await sendRequest(period);
    return;
  }
  log("period " + period + ": waiting for block " + (entropyBlock + 1) + " (now " + nowBlock + ")");
}

function periodsToScan(chainTime, fullScan) {
  const current = Math.floor(chainTime.timestamp / CHAIN.periodDuration);
  const set = new Set();
  const lookback = fullScan ? CONFIG.startupLookback : CONFIG.lookback;
  for (let i = 1; i <= lookback; i++) {
    const period = current - i;
    if (period > 0) set.add(period);
  }
  for (const key of Object.keys(state.pending || {})) set.add(Number(key));
  return Array.from(set).sort((a, b) => a - b);
}

async function tick(fullScan) {
  const chainTime = await getChainTime();

  if (CONFIG.enableDraw) {
    for (const period of periodsToScan(chainTime, fullScan)) {
      try {
        await processPeriod(period, chainTime);
      } catch (e) {
        log("period " + period + " error: " + (e.shortMessage || e.message));
      }
      await sleep(150);
    }
  }

  await maybeBet(chainTime);

  const now = Date.now();
  if (fullScan || now - lastStatusAt >= CONFIG.statusLogSeconds * 1000) {
    lastStatusAt = now;
    const balance = await getBalances();
    log(
      "status period=" + Math.floor(chainTime.timestamp / CHAIN.periodDuration) +
      " block=" + chainTime.blockNumber +
      " eth=" + ethers.formatEther(balance.eth) +
      " dlt=" + ethers.formatEther(balance.dlt) +
      " lastBet=" + state.lastBetPeriod +
      " pending=" + (Object.keys(state.pending).join(",") || "-")
    );
  }
}

function shutdown() {
  log("shutdown requested");
  running = false;
  releaseLock();
  setTimeout(() => process.exit(0), 100).unref();
}

async function main() {
  if (!CONFIG.privateKey) throw new Error("PRIVATE_KEY is required");
  if (!/^0x[0-9a-fA-F]{64}$/.test(CONFIG.privateKey)) throw new Error("PRIVATE_KEY must be 32-byte hex");
  if (!(CONFIG.betCount >= 1 && CONFIG.betCount <= 200)) throw new Error("BET_COUNT must be 1..200");

  acquireLock();
  state = loadState();

  provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  wallet = new ethers.Wallet(CONFIG.privateKey, provider);
  lottery = new ethers.Contract(CONFIG.lottery, LOTTERY_ABI, wallet);
  dlt = new ethers.Contract(CONFIG.dlt, DLT_ABI, wallet);

  if (CONFIG.logRpcUrl && CONFIG.logRpcUrl !== CONFIG.rpcUrl) {
    logProvider = new ethers.JsonRpcProvider(CONFIG.logRpcUrl);
    logLottery = new ethers.Contract(CONFIG.lottery, LOTTERY_ABI, logProvider);
  }

  const network = await retry("getNetwork", () => provider.getNetwork());
  if (network.chainId !== 8453n) throw new Error("wrong chainId " + network.chainId.toString() + ", expected 8453");

  CHAIN.periodDuration = Number(await retry("PERIOD_DURATION", () => lottery.PERIOD_DURATION()));
  CHAIN.waitBlocks = Number(await retry("RANDOM_WAIT_BLOCK", () => lottery.RANDOM_WAIT_BLOCK()));
  CHAIN.executeWindow = Number(await retry("EXECUTE_WINDOW_BLOCKS", () => lottery.EXECUTE_WINDOW_BLOCKS()));
  CHAIN.betPrice = await retry("BET_PRICE", () => lottery.BET_PRICE());

  log(
    "started address=" + wallet.address +
    " lottery=" + CONFIG.lottery +
    " dlt=" + CONFIG.dlt +
    " logRpc=" + (CONFIG.logRpcUrl || "same") +
    " betCount=" + CONFIG.betCount +
    " draw=" + CONFIG.enableDraw +
    " dryRun=" + CONFIG.dryRun
  );

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await tick(true);
  if (CONFIG.once) return;

  while (running) {
    await sleep(CONFIG.pollSeconds * 1000);
    if (!running) break;
    try {
      await tick(false);
    } catch (e) {
      log("tick error: " + (e.shortMessage || e.message));
    }
  }
}

main()
  .then(() => {
    releaseLock();
    if (CONFIG.once) process.exit(0);
  })
  .catch((e) => {
    console.error(new Date().toISOString(), "fatal:", e.shortMessage || e.message);
    releaseLock();
    process.exit(1);
  });
