const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");

const ONE = 10n ** 18n;
const DEAD = "0x000000000000000000000000000000000000dEaD";
const TEAM = "0x45F3aE8A36A1bC263AC5543d6876Dc37542F1785";
const BET = 2n * ONE;

async function deployAll() {
  const [owner, alice, bob, carol] = await ethers.getSigners();
  const Lottery = await ethers.getContractFactory("Lottery");
  const lottery = await Lottery.deploy(owner.address);
  await lottery.waitForDeployment();
  const dlt = await ethers.getContractAt("DLT", await lottery.dlt());
  return { owner, alice, bob, carol, lottery, dlt };
}

async function mintTo(dlt, signer, ethWei) {
  await (await signer.sendTransaction({ to: await dlt.getAddress(), value: ethWei })).wait();
}

async function goToPeriodStart(pid) {
  const target = Number((BigInt(pid) + 1n) * 3600n) + 1;
  const now = await time.latest();
  if (target > now) await time.increaseTo(target);
}

describe("DLT 铸币", function () {
  let dlt, alice, bob;

  before(async () => {
    ({ dlt, alice, bob } = await deployAll());
  });

  it("0.001 ETH = 20 DLT，99% 进黑洞，1% 留国库", async () => {
    const deadBefore = await ethers.provider.getBalance(DEAD);
    const treasuryBefore = await ethers.provider.getBalance(await dlt.getAddress());
    await mintTo(dlt, alice, 10n ** 15n); // 0.001 ETH
    expect(await dlt.balanceOf(alice)).to.equal(20n * ONE);
    const deadAfter = await ethers.provider.getBalance(DEAD);
    const treasuryAfter = await ethers.provider.getBalance(await dlt.getAddress());
    expect(deadAfter - deadBefore).to.equal(99n * 10n ** 13n); // 0.00099 ETH
    expect(treasuryAfter - treasuryBefore).to.equal(10n ** 13n); // 0.00001 ETH
  });

  it("0.01 ETH = 200 DLT", async () => {
    const before = await dlt.balanceOf(bob);
    await mintTo(dlt, bob, 10n ** 16n);
    expect((await dlt.balanceOf(bob)) - before).to.equal(200n * ONE);
  });

  it("低于最低额 / 非 0.001 整数倍 都拒绝", async () => {
    await expect(mintTo(dlt, alice, 5n * 10n ** 14n)).to.be.revertedWith("below min mint"); // 0.0005
    await expect(mintTo(dlt, alice, 15n * 10n ** 14n)).to.be.revertedWith("must be multiple of 0.001 ETH"); // 0.0015
  });

  it("只有彩票合约能增发 / 销毁", async () => {
    await expect(dlt.mintByLottery(alice.address, ONE)).to.be.revertedWith("only lottery");
    await expect(dlt.burnFromUser(alice.address, ONE)).to.be.revertedWith("only lottery");
  });

  it("没有 owner / admin / 可写函数", async () => {
    const names = Object.keys(dlt.interface.fragments.reduce((a, f) => {
      if (f.type === "function") a[f.name] = 1;
      return a;
    }, {}));
    for (const bad of ["owner", "TEAM", "team", "setTeam", "setRouter", "withdraw", "pause", "mint", "setLottery", "transferOwnership"]) {
      expect(names).to.not.include(bad);
    }
  });
});

describe("彩票：投注", function () {
  let lottery, dlt, alice, bob;

  before(async () => {
    ({ lottery, dlt, alice, bob } = await deployAll());
    await mintTo(dlt, alice, 10n ** 16n); // 200 DLT
    await mintTo(dlt, bob, 10n ** 16n);
  });

  it("未授权不能投注", async () => {
    await expect(lottery.connect(alice).bet(1)).to.be.revertedWithCustomError(dlt, "ERC20InsufficientAllowance");
  });

  it("投 1 注：销毁 2 DLT，计入当期，按注数记账", async () => {
    await dlt.connect(alice).approve(await lottery.getAddress(), ethers.MaxUint256);
    const pid = await lottery.currentPeriod();
    const supplyBefore = await dlt.totalSupply();
    const balBefore = await dlt.balanceOf(alice);
    const t0 = (await lottery.totalBet(pid)) + 3n * BET;

    await lottery.connect(alice).bet(3);
    expect(await dlt.totalSupply()).to.equal(supplyBefore - 3n * BET);
    expect(await dlt.balanceOf(alice)).to.equal(balBefore - 3n * BET);
    expect(await lottery.totalBet(pid)).to.equal(t0);
    const r = await lottery.rounds(pid);
    expect(r.betCount).to.equal(3n);
    for (let i = 0; i < 3; i++) expect(await lottery.bettors(pid, i)).to.equal(alice.address);
  });

  it("批量投注上限 200 注，0 注拒绝", async () => {
    await expect(lottery.connect(alice).bet(0)).to.be.revertedWith("invalid count");
    await expect(lottery.connect(alice).bet(201)).to.be.revertedWith("invalid count");
  });

  it("整点封盘：过期后投注自动进入下一期", async () => {
    await dlt.connect(bob).approve(await lottery.getAddress(), ethers.MaxUint256);
    const pid = await lottery.currentPeriod();
    await goToPeriodStart(pid);
    await lottery.connect(bob).bet(1);
    const pid2 = await lottery.currentPeriod();
    expect(pid2).to.equal(pid + 1n);
    expect((await lottery.rounds(pid2)).betCount).to.equal(1n);
  });

  it("彩票合约不接受直接转 ETH", async () => {
    await expect(alice.sendTransaction({ to: await lottery.getAddress(), value: 10n ** 15n })).to.be.revertedWith("no ETH accepted");
  });
});

describe("彩票：开奖", function () {
  it("1 注也发激励：request 10 + execute 20，奖金照发（推广期含基础奖池）", async () => {
    const { lottery, dlt, alice, bob, carol } = await deployAll();
    await mintTo(dlt, alice, 10n ** 16n);
    await dlt.connect(alice).approve(await lottery.getAddress(), ethers.MaxUint256);
    const pid = await lottery.currentPeriod();
    await lottery.connect(alice).bet(1); // 池子 2 DLT

    await goToPeriodStart(pid);
    const bobBefore = await dlt.balanceOf(bob);
    await lottery.connect(bob).requestDraw(pid);
    expect((await dlt.balanceOf(bob)) - bobBefore).to.equal(10n * ONE); // 非空期就发请求激励
    const r = await lottery.rounds(pid);
    expect(r.requested).to.equal(true);
    expect(r.requestRewarded).to.equal(true);

    const base = Number(r.requestBlock) + 200;
    await mine(base + 1 - (await ethers.provider.getBlockNumber()));

    const aliceBefore = await dlt.balanceOf(alice);
    const teamBefore = await dlt.balanceOf(TEAM);
    const carolBefore = await dlt.balanceOf(carol);
    const supplyBefore = await dlt.totalSupply();

    await lottery.connect(carol).executeDraw(pid);

    // 推广期：基础奖池 = min(1000, 真实投注 2 DLT 的一半) = 1 DLT -> 奖池 3 DLT
    const pool = 3n * ONE;
    expect((await dlt.balanceOf(alice)) - aliceBefore).to.equal((pool * 4900n) / 10000n); // 1.47
    expect((await dlt.balanceOf(TEAM)) - teamBefore).to.equal((pool * 100n) / 10000n); // 0.03
    expect((await dlt.balanceOf(carol)) - carolBefore).to.equal(20n * ONE); // 执行激励
    expect(await dlt.totalSupply()).to.equal(supplyBefore + pool / 2n + 20n * ONE); // 奖金 50% + 执行激励
    expect((await lottery.rounds(pid)).drawn).to.equal(true);
  });

  it("100 DLT 池：request 10 + execute 20 激励发放", async () => {
    const { lottery, dlt, alice, bob, carol } = await deployAll();
    await mintTo(dlt, alice, 10n ** 18n); // 20000 DLT
    await dlt.connect(alice).approve(await lottery.getAddress(), ethers.MaxUint256);
    const pid = await lottery.currentPeriod();
    await lottery.connect(alice).bet(50); // 100 DLT 池

    await goToPeriodStart(pid);
    const bobBefore = await dlt.balanceOf(bob);
    await lottery.connect(bob).requestDraw(pid);
    expect((await dlt.balanceOf(bob)) - bobBefore).to.equal(10n * ONE);

    const r = await lottery.rounds(pid);
    const base = Number(r.requestBlock) + 200;
    await mine(base + 1 - (await ethers.provider.getBlockNumber()));

    const carolBefore = await dlt.balanceOf(carol);
    const supplyBefore = await dlt.totalSupply();
    await lottery.connect(carol).executeDraw(pid);
    expect((await dlt.balanceOf(carol)) - carolBefore).to.equal(20n * ONE);
    // 推广期：基础奖池 = min(1000, 100 DLT 的一半) = 50 DLT -> 奖池 150 DLT
    // 本次开奖增发 = 奖池的 50%（75）+ 执行激励 20（请求激励 10 在 requestDraw 时已发）
    expect(await dlt.totalSupply()).to.equal(supplyBefore + 75n * ONE + 20n * ONE);
  });

  it("空期：标记已处理、不铸造、不报错", async () => {
    const { lottery, dlt, bob } = await deployAll();
    const pid = (await lottery.currentPeriod()) - 1n; // 上一期：无人投注
    const supplyBefore = await dlt.totalSupply();
    const bobBefore = await dlt.balanceOf(bob);
    await lottery.connect(bob).requestDraw(pid);
    expect((await lottery.rounds(pid)).drawn).to.equal(true);
    expect(await dlt.totalSupply()).to.equal(supplyBefore);
    expect(await dlt.balanceOf(bob)).to.equal(bobBefore);
    await expect(lottery.connect(bob).requestDraw(pid)).to.be.revertedWith("already drawn");
  });

  it("期未结束不能请求封盘", async () => {
    const { lottery, alice } = await deployAll();
    const pid = await lottery.currentPeriod();
    await expect(lottery.connect(alice).requestDraw(pid)).to.be.revertedWith("period still open");
  });

  it("等待区块不足 / 窗口过期都不能开奖", async () => {
    const { lottery, dlt, alice, bob } = await deployAll();
    await mintTo(dlt, alice, 10n ** 16n);
    await dlt.connect(alice).approve(await lottery.getAddress(), ethers.MaxUint256);
    const pid = await lottery.currentPeriod();
    await lottery.connect(alice).bet(1);
    await goToPeriodStart(pid);
    const bobFirstBefore = await dlt.balanceOf(bob);
    await lottery.connect(bob).requestDraw(pid);
    expect((await dlt.balanceOf(bob)) - bobFirstBefore).to.equal(10n * ONE); // 第一次请求发激励

    await expect(lottery.connect(bob).executeDraw(pid)).to.be.revertedWith("wait 200 blocks");

    const r = await lottery.rounds(pid);
    const lastOk = Number(r.requestBlock) + 200 + 255;
    await mine(lastOk + 1 - (await ethers.provider.getBlockNumber()));
    await expect(lottery.connect(bob).executeDraw(pid)).to.be.revertedWith("window expired, re-request");

    // 过期后可以重新请求，且不再发请求激励
    const bobBefore = await dlt.balanceOf(bob);
    await lottery.connect(bob).requestDraw(pid);
    expect(await dlt.balanceOf(bob)).to.equal(bobBefore);
    const r2 = await lottery.rounds(pid);
    expect(r2.requested).to.equal(true);
    expect(r2.requestBlock).to.be.greaterThan(r.requestBlock);

    const base2 = Number(r2.requestBlock) + 200;
    await mine(base2 + 1 - (await ethers.provider.getBlockNumber()));
    await lottery.connect(bob).executeDraw(pid);
    expect((await lottery.rounds(pid)).drawn).to.equal(true);
  });

  it("同一期不能重复开奖", async () => {
    const { lottery, dlt, alice, bob } = await deployAll();
    await mintTo(dlt, alice, 10n ** 16n);
    await dlt.connect(alice).approve(await lottery.getAddress(), ethers.MaxUint256);
    const pid = await lottery.currentPeriod();
    await lottery.connect(alice).bet(1);
    await goToPeriodStart(pid);
    await lottery.connect(bob).requestDraw(pid);
    const r = await lottery.rounds(pid);
    await mine(Number(r.requestBlock) + 201 - (await ethers.provider.getBlockNumber()));
    await lottery.connect(bob).executeDraw(pid);
    await expect(lottery.connect(bob).executeDraw(pid)).to.be.revertedWith("already drawn");
  });

  it("中奖者 = 区块哈希取模（可离线复算）", async () => {
    const { lottery, dlt, alice, bob, carol, owner } = await deployAll();
    await mintTo(dlt, alice, 10n ** 16n);
    await mintTo(dlt, bob, 10n ** 16n);
    await mintTo(dlt, carol, 10n ** 16n);
    for (const u of [alice, bob, carol]) {
      await dlt.connect(u).approve(await lottery.getAddress(), ethers.MaxUint256);
    }
    const pid = await lottery.currentPeriod();
    await lottery.connect(alice).bet(2);
    await lottery.connect(bob).bet(1);
    await lottery.connect(carol).bet(3);
    await goToPeriodStart(pid);
    await lottery.connect(owner).requestDraw(pid);

    const r = await lottery.rounds(pid);
    const base = Number(r.requestBlock) + 200;
    await mine(base + 1 - (await ethers.provider.getBlockNumber()));

    const entropyHash = (await ethers.provider.getBlock(base)).hash;
    const seed = BigInt(ethers.keccak256(ethers.solidityPacked(["bytes32", "uint256", "uint64"], [entropyHash, pid, r.requestBlock])));
    const n = await r.betCount;
    const expectedWinner = await lottery.bettors(pid, seed % n);

    const tx = await lottery.connect(owner).executeDraw(pid);
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return lottery.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "DrawExecuted");
    expect(ev.args.winner).to.equal(expectedWinner);
    expect(ev.args.winnerIndex).to.equal(seed % n);
  });

  it("推广期：基础奖池 = min(1,000, 投注量一半)，中奖者多拿 50%", async () => {
    const { lottery, dlt, alice, bob, carol } = await deployAll();
    await mintTo(dlt, alice, 10n ** 18n);
    await dlt.connect(alice).approve(await lottery.getAddress(), ethers.MaxUint256);
    const pid = await lottery.currentPeriod();
    expect(await lottery.promoStartPeriod()).to.equal(pid); // 推广期从上线当期开始算
    await lottery.connect(alice).bet(100); // 200 DLT

    await goToPeriodStart(pid);
    await lottery.connect(bob).requestDraw(pid);
    const r = await lottery.rounds(pid);
    await mine(Number(r.requestBlock) + 201 - (await ethers.provider.getBlockNumber()));

    const supplyBefore = await dlt.totalSupply();
    const tx = await lottery.connect(carol).executeDraw(pid);
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return lottery.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "DrawExecuted");

    expect(ev.args.baseAmount).to.equal(100n * ONE); // 200 DLT 的一半
    expect(ev.args.winnerAmount).to.equal((300n * ONE * 4900n) / 10000n); // 147（原来只有 98）
    expect(ev.args.teamAmount).to.equal((300n * ONE * 100n) / 10000n); // 3
    expect(await dlt.totalSupply()).to.equal(supplyBefore + 150n * ONE + 20n * ONE);
  });

  it("1 注自玩：奖金 1.47 + 激励 30，净赚约 29.47 DLT（保证开奖的固定成本）", async () => {
    const { lottery, dlt, alice } = await deployAll();
    await mintTo(dlt, alice, 10n ** 16n);
    await dlt.connect(alice).approve(await lottery.getAddress(), ethers.MaxUint256);
    const pid = await lottery.currentPeriod();
    const before = await dlt.balanceOf(alice);
    await lottery.connect(alice).bet(1); // -2 DLT

    await goToPeriodStart(pid);
    await lottery.connect(alice).requestDraw(pid); // +10
    const r = await lottery.rounds(pid);
    await mine(Number(r.requestBlock) + 201 - (await ethers.provider.getBlockNumber()));
    await lottery.connect(alice).executeDraw(pid); // +20 + 1.47 奖金

    const got = (await dlt.balanceOf(alice)) - before;
    // -2 投注 + 10 请求激励 + 20 执行激励 + 1.47 中奖奖金 = +29.47
    expect(got).to.equal(2947n * 10n ** 16n);
  });

  it("第 721 期起：基础奖池消失，恢复原规则", async () => {
    const { lottery, dlt, alice, bob, carol } = await deployAll();
    await mintTo(dlt, alice, 10n ** 18n);
    await dlt.connect(alice).approve(await lottery.getAddress(), ethers.MaxUint256);

    const start = await lottery.promoStartPeriod();
    const promoPeriods = await lottery.PROMO_PERIODS();
    await time.increaseTo(Number((start + promoPeriods) * 3600n) + 1); // 时间推进到推广期结束

    const pid = await lottery.currentPeriod();
    expect(pid).to.equal(start + promoPeriods);
    await lottery.connect(alice).bet(100); // 200 DLT，此时已没有基础奖池

    await goToPeriodStart(pid);
    await lottery.connect(bob).requestDraw(pid);
    const r = await lottery.rounds(pid);
    await mine(Number(r.requestBlock) + 201 - (await ethers.provider.getBlockNumber()));

    const supplyBefore = await dlt.totalSupply();
    const tx = await lottery.connect(carol).executeDraw(pid);
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return lottery.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "DrawExecuted");

    expect(ev.args.baseAmount).to.equal(0n);
    expect(ev.args.winnerAmount).to.equal((200n * ONE * 4900n) / 10000n); // 98
    expect(await dlt.totalSupply()).to.equal(supplyBefore + 100n * ONE + 20n * ONE);
  });
});

describe("管理员：只能延迟修改团队地址", function () {
  it("部署时写入管理员，初始团队地址写死，DLT 没有团队权限", async () => {
    const { owner, lottery, dlt } = await deployAll();
    expect(await lottery.admin()).to.equal(owner.address);
    expect(await lottery.INITIAL_TEAM()).to.equal(TEAM);
    expect(await lottery.team()).to.equal(TEAM);
    expect(await lottery.TEAM_CHANGE_DELAY()).to.equal(24n * 60n * 60n);

    const dltFns = dlt.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    expect(dltFns).to.not.include("TEAM");
    expect(dltFns).to.not.include("team");
  });

  it("非管理员不能提案；零地址 / 当前地址被拒绝", async () => {
    const { owner, alice, lottery } = await deployAll();
    await expect(lottery.connect(alice).proposeTeam(alice.address)).to.be.revertedWith("only admin");
    await expect(lottery.connect(owner).proposeTeam(ethers.ZeroAddress)).to.be.revertedWith("zero address");
    await expect(lottery.connect(owner).proposeTeam(TEAM)).to.be.revertedWith("same team");
  });

  it("提案 24 小时内不生效，任何人都不能提前激活", async () => {
    const { owner, alice, bob, lottery } = await deployAll();
    const tx = await lottery.connect(owner).proposeTeam(alice.address);
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return lottery.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "TeamChangeProposed");
    expect(ev.args.oldTeam).to.equal(TEAM);
    expect(ev.args.newTeam).to.equal(alice.address);
    expect(await lottery.team()).to.equal(TEAM); // 当前地址完全没变
    expect(await lottery.pendingTeam()).to.equal(alice.address);
    const effectiveAt = await lottery.teamChangeEffectiveAt();
    expect(effectiveAt).to.equal(BigInt(await time.latest()) + 24n * 60n * 60n);

    await expect(lottery.connect(bob).activateTeam()).to.be.revertedWith("wait 24 hours");

    // 精确停到生效前 1 秒：任何人调用都必须失败
    await time.setNextBlockTimestamp(effectiveAt - 1n);
    await expect(lottery.connect(bob).activateTeam()).to.be.revertedWith("wait 24 hours");
  });

  it("24 小时后任何人可激活，新地址开始收 1% 团队份额", async () => {
    const { owner, alice, bob, carol, lottery, dlt } = await deployAll();
    await lottery.connect(owner).proposeTeam(alice.address);
    await time.increase(24 * 60 * 60 + 1);

    const tx = await lottery.connect(bob).activateTeam();
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return lottery.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "TeamChanged");
    expect(ev.args.oldTeam).to.equal(TEAM);
    expect(ev.args.newTeam).to.equal(alice.address);
    expect(await lottery.team()).to.equal(alice.address);
    expect(await lottery.pendingTeam()).to.equal(ethers.ZeroAddress);
    expect(await lottery.teamChangeEffectiveAt()).to.equal(0n);

    // 新地址确实能收到后续开奖的 1%
    await mintTo(dlt, bob, 10n ** 16n);
    await dlt.connect(bob).approve(await lottery.getAddress(), ethers.MaxUint256);
    const pid = await lottery.currentPeriod();
    await lottery.connect(bob).bet(1);
    await goToPeriodStart(pid);
    await lottery.connect(carol).requestDraw(pid);
    const r = await lottery.rounds(pid);
    await mine(Number(r.requestBlock) + 201 - (await ethers.provider.getBlockNumber()));

    const aliceBefore = await dlt.balanceOf(alice);
    await lottery.connect(carol).executeDraw(pid);
    expect((await dlt.balanceOf(alice)) - aliceBefore).to.equal((3n * ONE * 100n) / 10000n); // 0.03
  });

  it("重新提案会覆盖旧提案并重置 24 小时，不能绕过等待", async () => {
    const { owner, alice, bob, carol, lottery } = await deployAll();
    await lottery.connect(owner).proposeTeam(alice.address);
    await time.increase(12 * 60 * 60);
    await lottery.connect(owner).proposeTeam(bob.address);
    expect(await lottery.pendingTeam()).to.equal(bob.address);

    await time.increase(12 * 60 * 60 + 1); // 距第一次已 24h+，但距第二次只有 12h+
    await expect(lottery.connect(carol).activateTeam()).to.be.revertedWith("wait 24 hours");

    await time.increase(12 * 60 * 60 + 1); // 距第二次超过 24h
    await lottery.connect(carol).activateTeam();
    expect(await lottery.team()).to.equal(bob.address);
  });

  it("管理员可撤回未生效提案；撤回后无法激活，且只有管理员能撤回", async () => {
    const { owner, alice, bob, lottery } = await deployAll();
    await lottery.connect(owner).proposeTeam(alice.address);

    await expect(lottery.connect(bob).cancelTeamChange()).to.be.revertedWith("only admin");

    const tx = await lottery.connect(owner).cancelTeamChange();
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return lottery.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "TeamChangeCancelled");
    expect(ev.args.oldTeam).to.equal(TEAM);
    expect(ev.args.cancelledTeam).to.equal(alice.address);
    expect(await lottery.team()).to.equal(TEAM);
    expect(await lottery.pendingTeam()).to.equal(ethers.ZeroAddress);
    expect(await lottery.teamChangeEffectiveAt()).to.equal(0n);

    await time.increase(24 * 60 * 60 + 1);
    await expect(lottery.connect(bob).activateTeam()).to.be.revertedWith("no pending team");
    await expect(lottery.connect(owner).cancelTeamChange()).to.be.revertedWith("no pending team");
  });

  it("管理员没有其他权力：不能暂停、提币、增发、改参数、换管理员、立即改地址", async () => {
    const { lottery } = await deployAll();
    const fns = lottery.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const bad of ["owner", "setAdmin", "changeAdmin", "transferAdmin", "pause", "unpause", "withdraw", "mint", "setTeam", "setReward", "setBetPrice", "upgradeTo", "upgradeToAndCall", "renounceOwnership"]) {
      expect(fns).to.not.include(bad);
    }
    expect(fns).to.include("proposeTeam");
    expect(fns).to.include("cancelTeamChange");
    expect(fns).to.include("activateTeam");
  });
});

describe("DLT 自动做市", function () {
  it("国库不足时拒绝；首次调用按官方价建池，LP 锁死在合约", async () => {
    const { lottery, dlt, alice, bob } = await deployAll();
    const dltAddr = await dlt.getAddress();

    await expect(dlt.connect(bob).autoAddLiquidity()).to.be.revertedWith("treasury below trigger");

    // 铸 1 ETH：国库 0.01 ETH，达到触发线
    await mintTo(dlt, alice, ONE);
    expect(await ethers.provider.getBalance(dltAddr)).to.equal(10n ** 16n);

    const router = await ethers.getContractAt("IUniswapV2Router02", await dlt.ROUTER_ADDRESS());
    const weth = await dlt.WETH_ADDRESS();
    const factory = await ethers.getContractAt("IUniswapV2Factory", await router.factory());

    const pairAddr = await factory.getPair(weth, dltAddr);
    expect(pairAddr).to.equal(ethers.ZeroAddress);

    const supplyBefore = await dlt.totalSupply();
    await (await dlt.connect(bob).autoAddLiquidity()).wait();

    const pair = await factory.getPair(weth, dltAddr);
    expect(pair).to.not.equal(ethers.ZeroAddress);

    const p = await ethers.getContractAt("IUniswapV2Pair", pair);
    const [r0, r1] = await p.getReserves();
    const token0 = await p.token0();
    const ethReserve = token0 === weth ? r0 : r1;
    const dltReserve = token0 === weth ? r1 : r0;
    expect(ethReserve).to.equal(10n ** 16n); // 0.01 ETH
    expect(dltReserve).to.equal(200n * ONE); // 按官方价 20,000 DLT/ETH
    expect(await dlt.totalSupply()).to.equal(supplyBefore + 200n * ONE);

    // LP 全部在 DLT 合约内，且合约没有任何取出 LP 的函数
    const lp = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pair);
    expect(await lp.balanceOf(dltAddr)).to.be.greaterThan(0);
    const fns = dlt.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const bad of ["withdraw", "removeLiquidity", "transferLP"]) expect(fns).to.not.include(bad);
  });

  it("第二次调用：按池子当前比例铸币加池，池子同比例变深、国库随之下降", async () => {
    const { lottery, dlt, alice, bob } = await deployAll();
    const dltAddr = await dlt.getAddress();
    await mintTo(dlt, alice, ONE); // 国库 0.01
    await (await dlt.connect(bob).autoAddLiquidity()).wait(); // 首次建池 0.01 ETH

    await mintTo(dlt, alice, ONE); // 再攒 0.01 ETH 国库
    const router = await ethers.getContractAt("IUniswapV2Router02", await dlt.ROUTER_ADDRESS());
    const factory = await ethers.getContractAt("IUniswapV2Factory", await router.factory());
    const pairAddr = await factory.getPair(await dlt.WETH_ADDRESS(), dltAddr);
    const p = await ethers.getContractAt("IUniswapV2Pair", pairAddr);
    const [e0, d0] = await p.getReserves();
    const supply0 = await dlt.totalSupply();

    await (await dlt.connect(bob).autoAddLiquidity()).wait();
    const [e1, d1] = await p.getReserves();
    expect(e1).to.be.greaterThan(e0); // 池子 ETH 变深
    expect(d1).to.be.greaterThan(d0); // 池子 DLT 同步变深，比例保持
    expect(await dlt.totalSupply()).to.be.greaterThan(supply0); // 铸出的币全部注入池子
    expect(await dlt.balanceOf(dltAddr)).to.equal(0); // 合约内不留多余 DLT
    expect(await ethers.provider.getBalance(dltAddr)).to.be.lessThan(10n ** 16n);
  });
});