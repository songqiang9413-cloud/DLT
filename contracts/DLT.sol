// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IUniswapV2Router02, IUniswapV2Factory, IUniswapV2Pair} from "./interfaces/IUniswapV2.sol";

/**
 * @title DLT
 * @notice DLT 代币：零 owner、零 admin、参数全部写死、不可升级、无赎回、无提币。
 *
 * 铸币（用户）：唯一入口是向本合约发送 ETH（receive / fallback）。
 *   0.001 ETH = 20 DLT；必须是 0.001 ETH 的整数倍；99% 的 ETH 打进黑洞，1% 留作国库。
 * 增发（仅两处）：
 *   1) 彩票合约调用 mintByLottery（开奖激励 / 奖金 / 团队份额）；
 *   2) 自动做市时按池子当前价格自增发，与国库 ETH 一起注入永久锁定的 LP。
 * 销毁（仅一处）：彩票合约调用 burnFromUser，且必须消耗用户对彩票合约的授权额度。
 * 国库：合约内 ETH 只能通过 autoAddLiquidity() 用于自动做市；没有任何提币函数。
 */
contract DLT is ERC20, ReentrancyGuard {
    // ==================== 全局固定常量（写死，部署不可改） ====================
    uint256 public constant MINT_UNIT = 0.001 ether; // 最小铸币单位
    uint256 public constant TOKENS_PER_UNIT = 20 ether; // 每 0.001 ETH 铸 20 DLT
    uint256 public constant TOKENS_PER_ETH = 20_000 ether; // 官方价：1 ETH = 20,000 DLT
    uint256 public constant BPS_DENOMINATOR = 10_000;

    uint256 public constant ETH_BURN_BPS = 9_900; // 99% ETH -> 黑洞
    uint256 public constant ETH_TREASURY_BPS = 100; // 1% ETH -> 国库（留在本合约）

    uint256 public constant LIQ_TRIGGER = 0.01 ether; // 国库达到该额度即可触发加池
    uint256 public constant LIQ_MAX_USE = 0.5 ether; // 单次最多动用的 ETH
    uint256 public constant LIQ_POOL_BPS = 1_000; // 单次不超过池子 ETH 余额的 10%
    uint256 public constant LIQ_TOLERANCE_BPS = 100; // 加池最小成交保护 1%（防极端价格）
    uint256 public constant DEADLINE_SECONDS = 600; // Uniswap 交易截止时间

    // ==================== 固定地址 ====================
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public constant ROUTER_ADDRESS = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24; // Base Uniswap V2
    address public constant WETH_ADDRESS = 0x4200000000000000000000000000000000000006; // Base WETH

    // ==================== 不可变量（部署时写入，之后永久不可改） ====================
    address public immutable lottery; // 唯一的铸币/销毁合作方：彩票合约
    IUniswapV2Router02 public immutable router;
    IUniswapV2Factory public immutable factory;

    bool private _inLiquidityAdd; // 加池过程中 Router 退回 ETH 时用于识别，避免误铸

    event Minted(address indexed buyer, uint256 ethIn, uint256 tokenOut);
    event LotteryMint(address indexed to, uint256 amount);
    event LotteryBurn(address indexed from, uint256 amount);
    event LiquidityAdded(uint256 ethUsed, uint256 tokenAdded, bool bootstrap);

    constructor() ERC20("DLT", "DLT") {
        lottery = msg.sender; // 部署者即彩票合约（由 Lottery 构造函数 new 出来）
        router = IUniswapV2Router02(ROUTER_ADDRESS);
        factory = IUniswapV2Factory(router.factory());
        require(router.WETH() == WETH_ADDRESS, "weth mismatch");
    }

    // ==================== 铸币入口 ====================

    /// @notice 空 calldata 的 ETH 转账：铸币
    receive() external payable {
        _mintByETH();
    }

    /// @notice 带 calldata 的 ETH 转账：同样只允许铸币
    fallback() external payable {
        require(msg.value > 0, "no such function");
        _mintByETH();
    }

    function _mintByETH() private {
        // 加池时 Uniswap Router 会把多余的 ETH 退回本合约，这部分不能重复铸币
        if (msg.sender == address(router)) {
            require(_inLiquidityAdd, "unexpected ETH");
            return;
        }

        uint256 ethIn = msg.value;
        require(ethIn >= MINT_UNIT, "below min mint");
        require(ethIn % MINT_UNIT == 0, "must be multiple of 0.001 ETH");

        uint256 tokenOut = (ethIn / MINT_UNIT) * TOKENS_PER_UNIT;
        _mint(msg.sender, tokenOut);

        // 99% 直接进黑洞，剩余 1% 留在本合约作为国库
        uint256 burnAmount = (ethIn * ETH_BURN_BPS) / BPS_DENOMINATOR;
        (bool ok, ) = BURN_ADDRESS.call{value: burnAmount}("");
        require(ok, "burn transfer failed");

        emit Minted(msg.sender, ethIn, tokenOut);
    }

    // ==================== 彩票合约专用（增发 / 销毁） ====================

    modifier onlyLottery() {
        require(msg.sender == lottery, "only lottery");
        _;
    }

    /// @notice 开奖相关增发：激励、中奖奖金、团队份额
    function mintByLottery(address to, uint256 amount) external onlyLottery {
        _mint(to, amount);
        emit LotteryMint(to, amount);
    }

    /// @notice 销毁用户投注：必须消耗用户授予彩票合约的额度，总供应真实减少
    function burnFromUser(address from, uint256 amount) external onlyLottery {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
        emit LotteryBurn(from, amount);
    }

    // ==================== 国库 ETH 自动做市（唯一出口） ====================

    /**
     * @notice 任何人可调用：把国库 ETH 与一份新铸的 DLT 按池子当前比例注入 Uniswap V2 池子，
     *         LP 永久锁死在本合约内，合约里没有任何取出 LP / 撤回流动性的函数。
     *
     *         为什么不是"先用 ETH 去市场买 DLT 再加池"：
     *         Uniswap V2 的 Pair.swap 有一条硬性安全规定 require(to != token0 && to != token1)，
     *         即池子不允许把币直接转给池子里的币合约本身。本合约就是池子里的 DLT，
     *         所以 swapExactETHForTokens 的输出无法回到本合约（会直接 revert: INVALID_TO）。
     *         改为按池子当前价格自增发对应数量的 DLT 加池，效果完全相同（池子同比例变深），
     *         且没有滑点、没有 MEV 抢跑空间、gas 更省。铸出的 DLT 立刻被等额 ETH 支撑并永久锁定。
     *
     * 单次动用上限 = min(0.5 ETH, 池子 ETH 余额的 10%, 国库余额)。
     */
    function autoAddLiquidity() external nonReentrant {
        uint256 balance = address(this).balance;
        require(balance >= LIQ_TRIGGER, "treasury below trigger");

        IUniswapV2Pair pair = IUniswapV2Pair(factory.getPair(WETH_ADDRESS, address(this)));
        uint256 poolEth = 0;
        uint256 poolToken = 0;
        if (address(pair) != address(0)) {
            (uint112 r0, uint112 r1, ) = pair.getReserves();
            if (pair.token0() == WETH_ADDRESS) {
                poolEth = uint256(r0);
                poolToken = uint256(r1);
            } else {
                poolEth = uint256(r1);
                poolToken = uint256(r0);
            }
        }

        // 单次动用上限：0.5 ETH、池子 ETH 余额的 10%、国库余额，三者取最小
        uint256 ethForLp = LIQ_MAX_USE;
        if (poolEth > 0) {
            uint256 poolCap = (poolEth * LIQ_POOL_BPS) / BPS_DENOMINATOR;
            if (poolCap < ethForLp) ethForLp = poolCap;
        }
        if (balance < ethForLp) ethForLp = balance;
        require(ethForLp > 0, "nothing to add");

        // 要配的 DLT 数量：已有池子按池子当前比例算，没有池子按官方价；
        // 上限为官方价对应的数量，防止池子价格异常时超量铸币。
        uint256 tokensForLp = (ethForLp * TOKENS_PER_ETH) / 1 ether;
        if (poolEth > 0 && poolToken > 0) {
            uint256 marketTokens = (ethForLp * poolToken) / poolEth;
            if (marketTokens < tokensForLp) tokensForLp = marketTokens;
        }

        bool bootstrap = poolEth == 0;

        _mint(address(this), tokensForLp);
        _approve(address(this), address(router), tokensForLp);

        _inLiquidityAdd = true;
        (uint256 tokensUsed, uint256 ethUsed, ) = router.addLiquidityETH{value: ethForLp}(
            address(this),
            tokensForLp,
            (tokensForLp * (BPS_DENOMINATOR - LIQ_TOLERANCE_BPS)) / BPS_DENOMINATOR,
            (ethForLp * (BPS_DENOMINATOR - LIQ_TOLERANCE_BPS)) / BPS_DENOMINATOR,
            address(this),
            block.timestamp + DEADLINE_SECONDS
        );
        _approve(address(this), address(router), 0);
        _inLiquidityAdd = false;

        // 未被池子吃下的那部分新币直接销毁，不留在合约里
        if (tokensUsed < tokensForLp) _burn(address(this), tokensForLp - tokensUsed);

        emit LiquidityAdded(ethUsed, tokensUsed, bootstrap);
    }
}
