# Basescan 源码验证（OKX 显示“合约未开源”的解决办法）

OKX Web3 的“合约未开源”读取的是 **Base 链浏览器 Basescan 的源码验证状态**，
不是 GitHub 仓库。把代码推到 GitHub 不会自动改变 OKX 的标签；必须在 Basescan
完成合约验证。

## 当前状态（2026-11-04）

两个合约已经通过 **Sourcify exact_match** 验证（创建字节码和运行字节码都完全匹配）：

- DLT：https://repo.sourcify.dev/contracts/full_match/8453/0xe9c553454B48C71537AC9Dddae495D9181E3990f/
  - matchId `58397368`
- Lottery：https://repo.sourcify.dev/contracts/full_match/8453/0x88B31E49Fd48108c132Aa0891DBd74caA5199A68/
  - matchId `58397366`

Basescan 仍未验证：Sourcify 尝试自动提交 Basescan 时，Etherscan 返回
“Daily limit of 500 source code submissions reached”；Basescan 的注册/验证页面
又要求 reCAPTCHA。Sourcify 的 exact_match 已经是独立、可公开审查的验证结果。

如果 OKX 仍然显示“合约未开源”，可以用 OKX 代币详情页的“反馈/纠错”入口，
附上上面的 Sourcify 链接和 GitHub 仓库：
https://github.com/songqiang9413-cloud/DLT

## 合约地址

| 合约 | 地址 |
| --- | --- |
| DLT 代币 | `0xe9c553454B48C71537AC9Dddae495D9181E3990f` |
| Lottery | `0x88B31E49Fd48108c132Aa0891DBd74caA5199A68` |

## 方法一：Basescan 网页上传 Standard-JSON（不需要 API Key）

1. 打开 https://basescan.org/address/0xe9c553454B48C71537AC9Dddae495D9181E3990f
2. 点 **Contract** → **Verify & Publish**
3. 选择 **Solidity (Standard-Json-Input)**
4. 上传本目录的 `standard-input.json`
5. 编译器选择 `v0.8.20+commit.a1b79de6`，优化开启、runs `200`，EVM `paris`
6. Contract name 填 `contracts/DLT.sol:DLT`，构造函数参数留空
7. 提交验证

然后对 Lottery 重复一次：

1. 打开 https://basescan.org/address/0x88B31E49Fd48108c132Aa0891DBd74caA5199A68
2. Contract → Verify & Publish → Solidity (Standard-Json-Input)
3. 同样上传 `standard-input.json`
4. Contract name 填 `contracts/Lottery.sol:Lottery`
5. 构造函数参数填：

```
0000000000000000000000006dfb0fa0873fbc4038764f7c902a86ebe1ece561
```

## 方法二：Hardhat 验证（需要免费 Basescan API Key）

在 https://basescan.org/myapikey 注册并创建 API Key，然后在本机执行：

```powershell
cd F:\SQ001\100DLT
$env:BASESCAN_API_KEY="你的 Basescan API Key"
npx hardhat verify --network base 0x88B31E49Fd48108c132Aa0891DBd74caA5199A68 0x6DFb0fA0873fBC4038764f7c902A86ebE1ECe561
npx hardhat verify --network base 0xe9c553454B48C71537AC9Dddae495D9181E3990f
```

DLT 是在 Lottery 构造函数里创建的。如果 Basescan 对内部创建的合约拒绝常规验证，
使用上面的 Standard-JSON 方式，或在 Basescan 支持页面提交内部交易验证请求。

## 验证之后

- Basescan 页面会显示绿色的 **Contract Source Code Verified**。
- OKX 的“合约未开源”通常会在其缓存刷新后消失（可能几分钟到几小时）。
- 如果 OKX 长时间不更新，使用 OKX Web3 代币详情页的“反馈/纠错”入口，附上
  Basescan 已验证的链接。
- “较低流动性（低于 5,000 美元）”是另一项独立风险提示，只有把池子做到
  5,000 美元以上才会消失；源码验证不会消除它。

## 当前编译参数

- Solidity: `0.8.20+commit.a1b79de6`
- Optimizer: enabled, runs 200
- EVM version: `paris`
- Sources: 10（含 OpenZeppelin 依赖）
