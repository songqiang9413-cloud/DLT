// DLT 项目部署脚本（Base 主网）
// 用法：npx hardhat run scripts/deploy.js --network base
// 说明：DLT 由 Lottery 的构造函数创建，两者地址互相写死，部署后都无法修改。
//      管理员只能提案修改团队收款地址，24 小时后才生效，没有其他权限。
const fs = require("fs");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("没有可用账户：请先设置环境变量 DEPLOYER_KEY");

  const provider = hre.ethers.provider;
  const net = await provider.getNetwork();
  const bal = await provider.getBalance(deployer.address);

  let admin;
  if (process.env.ADMIN_ADDRESS) {
    try {
      admin = hre.ethers.getAddress(process.env.ADMIN_ADDRESS.trim());
    } catch {
      throw new Error("ADMIN_ADDRESS 不是合法的以太坊地址");
    }
  } else {
    admin = deployer.address;
  }
  if (admin === hre.ethers.ZeroAddress) throw new Error("ADMIN_ADDRESS 不能是零地址");

  console.log("=== DLT 项目部署 ===");
  console.log("网络      :", hre.network.name, "(chainId " + net.chainId.toString() + ")");
  console.log("部署账户  :", deployer.address);
  console.log("账户余额  :", hre.ethers.formatEther(bal), "ETH");
  console.log("管理员    :", admin);
  if (!process.env.ADMIN_ADDRESS) {
    console.log("提示      : 未设置 ADMIN_ADDRESS，管理员默认 = 部署账户。");
    console.log("            这个钱包现在拥有“提案修改团队收款地址”的权限，必须长期保存，不能当一次性热钱包。");
  }
  if (bal === 0n) throw new Error("部署账户没有 ETH，无法支付 gas");

  console.log("\n正在部署 Lottery（构造函数里会一并创建 DLT 代币）...");
  const Lottery = await hre.ethers.getContractFactory("Lottery");
  const lottery = await Lottery.deploy(admin);
  const tx = lottery.deploymentTransaction();
  console.log("交易已发出:", tx.hash);
  await lottery.waitForDeployment();
  const receipt = await tx.wait();

  const lotteryAddr = await lottery.getAddress();
  const dltAddr = await lottery.dlt();
  const adminOnChain = await lottery.admin();
  const initialTeam = await lottery.INITIAL_TEAM();
  const team = await lottery.team();

  console.log("\n=== 部署完成 ===");
  console.log("Lottery 合约 :", lotteryAddr);
  console.log("DLT 代币合约 :", dltAddr);
  console.log("管理员       :", adminOnChain);
  console.log("初始团队地址 :", initialTeam);
  console.log("当前团队地址 :", team);
  console.log("部署区块号   :", receipt.blockNumber);
  console.log("部署交易哈希 :", tx.hash);
  console.log("本次 gas 消耗:", receipt.gasUsed.toString());

  if (adminOnChain.toLowerCase() === team.toLowerCase()) {
    console.log("\n⚠️ 警告：管理员地址与团队收款地址相同。");
    console.log("   这样一旦收款私钥泄露，管理员权限也会一起泄露，24 小时延迟的保护会大打折扣。");
    console.log("   如果这是有意为之，请务必保证这个私钥的安全；否则建议以后不要再把两把钥匙合成一把。");
  }
  if (adminOnChain.toLowerCase() === deployer.address.toLowerCase()) {
    console.log("\n⚠️ 提醒：管理员就是部署账户。部署完不要把这个钱包当一次性钱包丢掉，");
    console.log("   否则以后团队收款地址泄露时，就没有人能发起修改提案了。");
  }

  // ---- 部署后自检：确认所有关键参数与文档一致 ----
  const dlt = await hre.ethers.getContractAt("DLT", dltAddr);
  const dltFns = dlt.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
  const lotteryFns = lottery.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
  const expectedInitialTeam = "0x45F3aE8A36A1bC263AC5543d6876Dc37542F1785";

  const checks = [
    ["DLT.lottery 指向彩票合约", (await dlt.lottery()) === lotteryAddr],
    ["管理员 = 部署时指定地址", adminOnChain.toLowerCase() === admin.toLowerCase()],
    ["初始团队地址 = 0x45F3...", initialTeam.toLowerCase() === expectedInitialTeam.toLowerCase()],
    ["当前团队地址 = 初始团队地址", team.toLowerCase() === initialTeam.toLowerCase()],
    ["团队地址修改延迟 = 24 小时", (await lottery.TEAM_CHANGE_DELAY()) === 86400n],
    ["DLT 不再保存团队地址（唯一来源在 Lottery）", !dltFns.includes("TEAM") && !dltFns.includes("team")],
    ["没有立即改团队地址的函数", !lotteryFns.includes("setTeam")],
    ["每 0.001 ETH 铸 20 DLT", (await dlt.TOKENS_PER_UNIT()) === hre.ethers.parseEther("20")],
    ["99% ETH 打黑洞", (await dlt.ETH_BURN_BPS()) === 9900n],
    ["国库触发线 0.01 ETH", (await dlt.LIQ_TRIGGER()) === hre.ethers.parseEther("0.01")],
    ["每期 1 小时", (await lottery.PERIOD_DURATION()) === 3600n],
    ["每注 2 DLT", (await lottery.BET_PRICE()) === hre.ethers.parseEther("2")],
    ["开奖等待 200 区块", (await lottery.RANDOM_WAIT_BLOCK()) === 200n],
    ["开奖激励 10 + 20 DLT", (await lottery.REWARD_DRAW_REQUEST()) === hre.ethers.parseEther("10") && (await lottery.REWARD_DRAW_EXECUTE()) === hre.ethers.parseEther("20")],
    ["已删除 100 DLT 激励门槛", !lotteryFns.includes("MIN_POOL_FOR_INCENTIVE")],
    ["奖金 49% / 团队 1%", (await lottery.WINNER_REWARD_BPS()) === 4900n && (await lottery.TEAM_REWARD_BPS()) === 100n],
    ["推广期共 720 期", (await lottery.PROMO_PERIODS()) === 720n],
    ["单期基础奖池上限 1,000 DLT", (await lottery.PROMO_BASE_POOL()) === hre.ethers.parseEther("1000")],
    ["基础奖池 = 投注量一半", (await lottery.PROMO_MATCH_BPS()) === 5000n],
    ["推广期从上线当期开始", (await lottery.promoStartPeriod()) === (await lottery.currentPeriod())],
  ];
  console.log("\n=== 参数自检 ===");
  let allOk = true;
  for (const [name, ok] of checks) {
    console.log((ok ? "  [OK]   " : "  [异常] ") + name);
    if (!ok) allOk = false;
  }
  if (!allOk) throw new Error("自检未通过，请勿继续使用，把上面的输出发我");

  const out = {
    network: hre.network.name,
    chainId: net.chainId.toString(),
    lottery: lotteryAddr,
    dlt: dltAddr,
    admin: adminOnChain,
    initialTeam: initialTeam,
    team: team,
    teamChangeDelaySeconds: "86400",
    deployer: deployer.address,
    deployBlock: receipt.blockNumber,
    deployTx: tx.hash,
  };
  const file = "deployment-" + hre.network.name + ".json";
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("\n部署信息已写入:", file);

  console.log("\n=== 下一步 ===");
  console.log("1) 把上面两个合约地址抄下来保存好（DLT 代币合约地址 = 玩家要添加的代币地址）");
  console.log("2) 建议执行：npx hardhat run scripts/createInitialPool.js --network base  建初始交易池");
  console.log("3) 可选：在 Basescan 上验证源码（见 README.md）");
  console.log("4) 随时查看系统状态：npx hardhat run scripts/status.js --network base");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});