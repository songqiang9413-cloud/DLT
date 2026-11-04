// 建立初始交易池（可选，但强烈建议在上线后马上做）
// 用法：npx hardhat run scripts/createInitialPool.js --network base
//
// 它会做三件事：
//   1) 用 0.001 ETH 向 DLT 合约铸币，得到 20 DLT（必须按 0.001 ETH 的整数倍）
//   2) 授权 Uniswap V2 Router 动用这 20 DLT
//   3) 用 0.001 ETH + 20 DLT 建立交易池，LP（流动性凭证）直接发到 DLT 合约地址 => 永久锁死
//
// ⚠️ 一共花掉 0.002 ETH（外加几十美分 gas），这笔钱和 LP 一起永久锁在池子里，谁都拿不回来。
//    池子价格 = 0.001 ETH : 20 DLT，正好等于官方铸币价（1 ETH = 20000 DLT）。
const fs = require("fs");
const hre = require("hardhat");

const ETH_IN = hre.ethers.parseEther("0.001"); // 最小铸币单位
const DLT_OUT = hre.ethers.parseEther("20"); // 0.001 ETH 换 20 DLT

async function main() {
  const [signer] = await hre.ethers.getSigners();
  if (!signer) throw new Error("没有可用账户：请先设置环境变量 DEPLOYER_KEY");

  const info = JSON.parse(fs.readFileSync("deployment-" + hre.network.name + ".json", "utf8"));
  const dltAddr = info.dlt;
  const dlt = await hre.ethers.getContractAt("DLT", dltAddr);
  const routerAddr = await dlt.ROUTER_ADDRESS();
  const router = await hre.ethers.getContractAt("IUniswapV2Router02", routerAddr);
  const factory = await hre.ethers.getContractAt("IUniswapV2Factory", await router.factory());
  const weth = await dlt.WETH_ADDRESS();

  const existing = await factory.getPair(weth, dltAddr);
  if (existing !== hre.ethers.ZeroAddress) {
    console.log("池子已经存在:", existing, "本脚本不再重复建池。");
    return;
  }

  console.log("DLT 合约     :", dltAddr);
  console.log("将花费       : 0.002 ETH（0.001 铸币 + 0.001 建池）+ gas");
  console.log("账户余额     :", hre.ethers.formatEther(await hre.ethers.provider.getBalance(signer.address)), "ETH");

  // 1) 铸币：向 DLT 合约转账 0.001 ETH，得到 20 DLT
  console.log("\n[1/3] 铸币 20 DLT ...");
  const mintTx = await signer.sendTransaction({ to: dltAddr, value: ETH_IN });
  await mintTx.wait();
  console.log("  完成，tx:", mintTx.hash, "| 当前持有:", hre.ethers.formatEther(await dlt.balanceOf(signer.address)), "DLT");

  // 2) 授权 Router
  console.log("\n[2/3] 授权 Uniswap Router 动用 20 DLT ...");
  const approveTx = await dlt.approve(routerAddr, DLT_OUT);
  await approveTx.wait();
  console.log("  完成，tx:", approveTx.hash);

  // 3) 建池：LP 直接发到 DLT 合约地址 => 永久锁死
  console.log("\n[3/3] 建立交易池，LP 直接锁进 DLT 合约 ...");
  const deadline = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp) + 600n;
  const addTx = await router.addLiquidityETH(dltAddr, DLT_OUT, DLT_OUT, ETH_IN, dltAddr, deadline, { value: ETH_IN });
  await addTx.wait();
  console.log("  完成，tx:", addTx.hash);

  const pairAddr = await factory.getPair(weth, dltAddr);
  const pair = await hre.ethers.getContractAt("IUniswapV2Pair", pairAddr);
  const [r0, r1] = await pair.getReserves();
  const isWeth0 = (await pair.token0()) === weth;
  const lp = await hre.ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddr);

  console.log("\n=== 建池完成 ===");
  console.log("池子地址        :", pairAddr);
  console.log("池子 ETH        :", hre.ethers.formatEther(isWeth0 ? r0 : r1), "ETH");
  console.log("池子 DLT        :", hre.ethers.formatEther(isWeth0 ? r1 : r0), "DLT");
  console.log("LP 锁在 DLT 合约:", hre.ethers.formatEther(await lp.balanceOf(dltAddr)));
  console.log("LP 总量         :", hre.ethers.formatEther(await lp.totalSupply()));
  console.log("\n交易池已上线：玩家现在可以在 Uniswap 上买 DLT 了。");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});