require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      // 需要跑分叉测试时：npx hardhat test --network hardhat（配合 FORK_URL 环境变量）
      forking: process.env.FORK_URL ? { url: process.env.FORK_URL } : undefined,
      allowUnlimitedContractSize: false,
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
  // 在 Basescan 上验证源码用（可选）：申请 API Key 后设置 BASESCAN_API_KEY
  etherscan: {
    apiKey: { base: process.env.BASESCAN_API_KEY || "" },
  },
  mocha: { timeout: 600000 },
};