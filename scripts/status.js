// 系统状态查看（只读，不花任何 gas，不改变任何东西）
// 用法：npx hardhat run scripts/status.js --network base
const fs = require("fs");
const hre = require("hardhat");

async function main() {
  const file = "deployment-" + hre.network.name + ".json";
  const info = JSON.parse(fs.readFileSync(file, "utf8"));
  const dltAddr = info.dlt;
  const lotteryAddr = info.lottery;

  const dlt = await hre.ethers.getContractAt("DLT", dltAddr);
  const lottery = await hre.ethers.getContractAt("Lottery", lotteryAddr);
  const router = await hre.ethers.getContractAt("IUniswapV2Router02", await dlt.ROUTER_ADDRESS());
  const factory = await hre.ethers.getContractAt("IUniswapV2Factory", await router.factory());

  const now = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
  const period = await lottery.currentPeriod();
  const periodEnd = (period + 1n) * 3600n;

  console.log("=== DLT 项目状态（" + hre.network.name + "）===");
  console.log("DLT 代币合约 :", dltAddr);
  console.log("彩票合约     :", lotteryAddr);
  console.log("DLT 总供应量 :", hre.ethers.formatEther(await dlt.totalSupply()), "DLT");

  const admin = await lottery.admin();
  const initialTeam = await lottery.INITIAL_TEAM();
  const team = await lottery.team();
  const pendingTeam = await lottery.pendingTeam();
  const effectiveAt = await lottery.teamChangeEffectiveAt();
  const delay = await lottery.TEAM_CHANGE_DELAY();

  console.log("\n[权限与团队收款]");
  console.log("  管理员       :", admin, "（只能提案修改/撤回团队收款地址，不能暂停/提币/增发/升级）");
  console.log("  初始团队地址 :", initialTeam);
  console.log("  当前团队地址 :", team);
  console.log("  修改延迟     :", delay.toString(), "秒（24 小时）");
  if (pendingTeam === hre.ethers.ZeroAddress) {
    console.log("  待生效提案   : 无");
  } else {
    console.log("  待生效地址   :", pendingTeam);
    console.log("  可激活时间   :", effectiveAt.toString(), "（链上时间戳）");
    if (now >= effectiveAt) {
      console.log("  状态         : 已到时间，任何人可调用 activateTeam() 让新地址生效");
    } else {
      const left = effectiveAt - now;
      console.log("  状态         : 公示中，还需", left.toString(), "秒（约", (left / 60n).toString(), "分钟）");
    }
  }

  const treasury = await hre.ethers.provider.getBalance(dltAddr);
  const trigger = await dlt.LIQ_TRIGGER();
  console.log("\n[国库]");
  console.log("  国库 ETH   :", hre.ethers.formatEther(treasury), "ETH");
  console.log("  加池触发线 :", hre.ethers.formatEther(trigger), "ETH",
    treasury >= trigger ? "-> 已达标，任何人可调用 autoAddLiquidity()" : "-> 未达标");

  const pairAddr = await factory.getPair(await dlt.WETH_ADDRESS(), dltAddr);
  console.log("\n[交易池]");
  if (pairAddr === hre.ethers.ZeroAddress) {
    console.log("  池子还没建立（可执行 createInitialPool.js，或等国库达标后由 autoAddLiquidity 自动建池）");
  } else {
    const pair = await hre.ethers.getContractAt("IUniswapV2Pair", pairAddr);
    const [r0, r1] = await pair.getReserves();
    const weth = await dlt.WETH_ADDRESS();
    const isWeth0 = (await pair.token0()) === weth;
    const ethRes = isWeth0 ? r0 : r1;
    const dltRes = isWeth0 ? r1 : r0;
    console.log("  池子地址   :", pairAddr);
    console.log("  池子 ETH   :", hre.ethers.formatEther(ethRes), "ETH");
    console.log("  池子 DLT   :", hre.ethers.formatEther(dltRes), "DLT");
    if (ethRes > 0n && dltRes > 0n) {
      const perEth = (dltRes * 10n ** 18n) / ethRes;
      console.log("  池子价格   : 1 ETH =", hre.ethers.formatEther(perEth), "DLT（官方价 20000）");
    }
    const lp = await hre.ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddr);
    const lpTotal = await lp.totalSupply();
    const lpLocked = await lp.balanceOf(dltAddr);
    console.log("  锁死在合约里的 LP:", hre.ethers.formatEther(lpLocked), "/", hre.ethers.formatEther(lpTotal), "（永久锁死，没有任何取出函数）");
  }

  console.log("\n[彩票]");
  console.log("  当前期号   :", period.toString(), "（本期将于整点封盘）");
  const secLeft = periodEnd > now ? periodEnd - now : 0n;
  console.log("  距封盘     :", secLeft.toString(), "秒");
  console.log("  开奖激励   : 只要当期至少有 1 注，requestDraw 10 DLT + executeDraw 20 DLT");
  const promoStart = await lottery.promoStartPeriod();
  const promoPeriods = await lottery.PROMO_PERIODS();
  const promoCap = await lottery.PROMO_BASE_POOL();
  const bet = await lottery.totalBet(period);
  const inPromo = period >= promoStart && period < promoStart + promoPeriods;
  let promoBase = 0n;
  if (inPromo) {
    promoBase = bet / 2n;
    if (promoBase > promoCap) promoBase = promoCap;
  }
  console.log("  本期投注   :", hre.ethers.formatEther(bet), "DLT /",
    (await lottery.rounds(period)).betCount.toString(), "注");
  if (inPromo) {
    console.log("  推广期     : 进行中（第 " + (period - promoStart + 1n).toString() + "/" + promoPeriods.toString() + " 期）");
    console.log("  基础奖池   :", hre.ethers.formatEther(promoBase), "DLT -> 中奖者可拿",
      hre.ethers.formatEther(((bet + promoBase) * 49n) / 100n), "DLT");
  } else {
    console.log("  推广期     : 已结束（不再补基础奖池）");
  }

  for (const p of [period - 1n, period - 2n]) {
    if (p < 0n) continue;
    const r = await lottery.rounds(p);
    const state = r.drawn ? (r.betCount === 0n ? "空期已关闭" : "已开奖") : r.requested ? "已封盘，等待 200 区块后开奖" : "未封盘（需要有人调用 requestDraw）";
    console.log("  第 " + p.toString() + " 期:", state, "| 投注", hre.ethers.formatEther(await lottery.totalBet(p)), "DLT");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});