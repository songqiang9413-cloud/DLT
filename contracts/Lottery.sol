// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DLT} from "./DLT.sol";

/**
 * @title Lottery
 * @notice DLT 小时彩票：零 owner、参数全部写死、不可升级；
 *         只有一个"只能延迟修改团队收款地址"的限权管理员。
 *
 * 周期：按 UNIX 时间整点对齐，每 1 小时一期。当期投注，下一整点封盘。
 * 投注：每注 2 DLT，立即 100% 销毁；按注数加权抽奖（投 N 注占 N 个号）。
 * 开奖：requestDraw 记录请求区块 -> 等 200 个区块 -> executeDraw 用
 *       keccak256(blockhash(请求区块 + 200), 期号, 请求区块) 取模选出中奖者。
 *       执行窗口为 255 个区块（区块哈希只能回溯 256 个），过期可重新请求（激励不重复发）。
 * 分配：奖金 = 当期投注总量的 49%（铸给中奖者）；团队份额 = 1%（铸给当前团队地址）。
 * 推广期：上线起前 720 期（约 30 天），每期额外补一份"基础奖池" = min(1,000 DLT, 当期投注量的一半)，
 *         与投注量合并后再按 49% / 1% 分配，让早期中奖者多拿 50%；第 721 期起自动恢复原规则。
 * 激励：requestDraw 10 DLT、executeDraw 20 DLT；只要当期至少有 1 注就发，且每期各一次。
 *       这是为了保证每期都有人愿意开奖而付出的固定成本。
 * 空期：当期无人投注 -> 直接标记已处理，不铸造、不报错、不发激励。
 * 团队地址：初始地址写死；管理员只能提案修改或撤回提案，链上公示 24 小时后由任何人激活，
 *           没有立即修改、暂停、提币、增发、升级等其他权限。
 */
contract Lottery is ReentrancyGuard {
    // ==================== 全局固定常量（写死，部署不可改） ====================
    uint256 public constant PERIOD_DURATION = 1 hours; // 每期时长
    uint256 public constant BET_PRICE = 2 ether; // 每注 2 DLT
    uint256 public constant MAX_BETS_PER_TX = 200; // 单笔最多投注笔数（防超区块 gas 上限）
    uint256 public constant TEAM_CHANGE_DELAY = 24 hours; // 团队地址提案后的公示期
    uint256 public constant REWARD_DRAW_REQUEST = 10 ether; // requestDraw 固定激励
    uint256 public constant REWARD_DRAW_EXECUTE = 20 ether; // executeDraw 固定激励
    uint256 public constant WINNER_REWARD_BPS = 4_900; // 中奖者 49%（按投注总量）
    uint256 public constant TEAM_REWARD_BPS = 100; // 团队 1%（按投注总量）
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant RANDOM_WAIT_BLOCK = 200; // 等待区块数
    uint256 public constant EXECUTE_WINDOW_BLOCKS = 255; // 执行窗口（区块哈希可回溯 256 个）

    // ---- 推广期基础奖池（写死，只在前 720 期生效） ----
    uint256 public constant PROMO_PERIODS = 720; // 推广期期数（30 天）
    uint256 public constant PROMO_BASE_POOL = 1_000 ether; // 单期最多额外补 1,000 DLT
    uint256 public constant PROMO_MATCH_BPS = 5_000; // 基础奖池 = 当期真实投注量的 50%

    // ==================== 固定地址 ====================
    address public constant INITIAL_TEAM = 0x45F3aE8A36A1bC263AC5543d6876Dc37542F1785; // 初始团队收款地址

    // ==================== 不可变量（部署时写入，之后永久不可改） ====================
    DLT public immutable dlt; // 本合约在构造函数里创建 DLT
    address public immutable admin; // 唯一管理员：只能提案修改团队收款地址，不可转让
    uint256 public immutable promoStartPeriod; // 推广期起始期号 = 部署当期

    // ==================== 可变状态（全项目唯一可变的就是团队收款地址） ====================
    address public team; // 当前团队收款地址；初始值 = INITIAL_TEAM
    address public pendingTeam; // 待生效的新团队地址（0 表示没有提案）
    uint256 public teamChangeEffectiveAt; // 提案可激活的时间戳（0 表示没有提案）

    /// @dev 每期状态，打包在同一个存储槽
    struct Round {
        uint64 betCount; // 投注笔数（即抽奖号数）
        uint64 requestBlock; // 封盘请求所在区块
        bool requested; // 是否已请求封盘
        bool drawn; // 是否已处理（开奖 / 空期关闭）
        bool requestRewarded; // 请求激励是否已发过（重抽不再发）
    }

    mapping(uint256 => Round) public rounds; // 期号 => 状态
    mapping(uint256 => mapping(uint256 => address)) public bettors; // 期号 => 号 => 投注者
    mapping(uint256 => uint256) public totalBet; // 期号 => 当期投注总量

    event Bet(uint256 indexed periodId, address indexed bettor, uint256 count, uint256 amount);
    event DrawRequested(uint256 indexed periodId, address indexed caller, uint256 requestBlock, bool rewarded);
    event DrawExecuted(
        uint256 indexed periodId,
        address indexed winner,
        uint256 winnerIndex,
        uint256 winnerAmount,
        uint256 teamAmount,
        uint256 baseAmount,
        address caller
    );
    event EmptyRoundClosed(uint256 indexed periodId);
    event TeamChangeProposed(address indexed oldTeam, address indexed newTeam, uint256 effectiveAt);
    event TeamChanged(address indexed oldTeam, address indexed newTeam);
    event TeamChangeCancelled(address indexed oldTeam, address indexed cancelledTeam);

    constructor(address admin_) {
        require(admin_ != address(0), "zero admin");
        dlt = new DLT(); // 代币与彩票互相写死：DLT 里 lottery = 本合约
        admin = admin_;
        team = INITIAL_TEAM;
        promoStartPeriod = block.timestamp / PERIOD_DURATION; // 上线当期开始算推广期
    }

    /// @notice 合约不接受 ETH
    receive() external payable {
        revert("no ETH accepted");
    }

    /// @notice 当前期号（UNIX 时间整点对齐）
    function currentPeriod() public view returns (uint256) {
        return block.timestamp / PERIOD_DURATION;
    }

    // ==================== 限权管理员：只能延迟修改团队收款地址 ====================

    modifier onlyAdmin() {
        require(msg.sender == admin, "only admin");
        _;
    }

    /**
     * @notice 管理员提案修改团队收款地址。提案不会立即生效，必须等 24 小时。
     * @dev 提案会覆盖上一个未生效的提案，并重新开始 24 小时计时。
     *      链上事件 TeamChangeProposed 就是"全网公布"的公开凭证。
     */
    function proposeTeam(address newTeam) external onlyAdmin {
        require(newTeam != address(0), "zero address");
        require(newTeam != team, "same team");
        pendingTeam = newTeam;
        teamChangeEffectiveAt = block.timestamp + TEAM_CHANGE_DELAY;
        emit TeamChangeProposed(team, newTeam, teamChangeEffectiveAt);
    }

    /**
     * @notice 管理员撤回尚未生效的提案（防手滑）。撤回后 team 不变，提案清零。
     * @dev 只是撤销一次未来的地址变更，不能立即改地址，也不能动任何资金。
     */
    function cancelTeamChange() external onlyAdmin {
        address cancelled = pendingTeam;
        require(cancelled != address(0), "no pending team");
        pendingTeam = address(0);
        teamChangeEffectiveAt = 0;
        emit TeamChangeCancelled(team, cancelled);
    }

    /**
     * @notice 24 小时公示期满后，任何人可调用，让新团队地址生效。
     * @dev 合约不会自动执行；必须有一笔交易触发。公开可调是为了防止管理员忘记激活。
     */
    function activateTeam() external {
        address newTeam = pendingTeam;
        require(newTeam != address(0), "no pending team");
        require(block.timestamp >= teamChangeEffectiveAt, "wait 24 hours");
        address oldTeam = team;
        team = newTeam;
        pendingTeam = address(0);
        teamChangeEffectiveAt = 0;
        emit TeamChanged(oldTeam, newTeam);
    }

    // ==================== 投注 ====================

    /**
     * @notice 投注 count 注，每注 2 DLT，立即全部销毁。
     * @dev 需要用户先对本合约授权至少 count * 2 DLT。
     */
    function bet(uint256 count) external nonReentrant {
        require(count > 0 && count <= MAX_BETS_PER_TX, "invalid count");

        uint256 periodId = currentPeriod();
        uint256 amount = count * BET_PRICE;

        // 立刻销毁（由 DLT 校验并消耗授权额度，总供应真实减少）
        dlt.burnFromUser(msg.sender, amount);

        Round storage r = rounds[periodId];
        uint256 start = uint256(r.betCount);
        require(start + count <= type(uint64).max, "betCount overflow");

        for (uint256 i = 0; i < count; ++i) {
            bettors[periodId][start + i] = msg.sender; // 一注一个号
        }
        r.betCount = uint64(start + count);
        totalBet[periodId] += amount;

        emit Bet(periodId, msg.sender, count, amount);
    }

    // ==================== 封盘请求 ====================

    /**
     * @notice 任何人可调用。某期结束后请求封盘，记录请求区块。
     * @dev 只要当期至少有 1 注，单期首次请求就发 10 DLT 激励；
     *      若上一次请求的执行窗口已过期，任何人可重新请求（不再发请求激励）。
     */
    function requestDraw(uint256 periodId) external nonReentrant {
        require(block.timestamp >= (periodId + 1) * PERIOD_DURATION, "period still open");

        Round storage r = rounds[periodId];
        require(!r.drawn, "already drawn");
        if (r.requested) {
            require(_requestExpired(r), "previous request still valid");
        }

        // 空期保护：不铸造、不报错
        if (r.betCount == 0) {
            r.drawn = true;
            emit EmptyRoundClosed(periodId);
            return;
        }

        r.requested = true;
        r.requestBlock = uint64(block.number);

        bool rewarded = false;
        if (!r.requestRewarded) {
            r.requestRewarded = true;
            rewarded = true;
            dlt.mintByLottery(msg.sender, REWARD_DRAW_REQUEST);
        }

        emit DrawRequested(periodId, msg.sender, block.number, rewarded);
    }

    // ==================== 开奖执行 ====================

    /**
     * @notice 任何人可调用。等待区块满足后开奖：铸 49% 给中奖者、1% 给当前团队地址，调用者得 20 DLT 激励。
     * @dev 推广期内奖池 = 真实投注量 + 基础奖池（min(1,000 DLT, 投注量的一半)），中奖者因此多拿 50%。
     *      随机数取「请求区块 + 200」的区块哈希，请求时无法预知，因此无法挑选对自己有利的时机。
     */
    function executeDraw(uint256 periodId) external nonReentrant {
        Round storage r = rounds[periodId];
        require(r.requested, "not requested");
        require(!r.drawn, "already drawn");

        uint256 entropyBlock = uint256(r.requestBlock) + RANDOM_WAIT_BLOCK;
        require(block.number > entropyBlock, "wait 200 blocks");
        require(block.number <= entropyBlock + EXECUTE_WINDOW_BLOCKS, "window expired, re-request");

        uint256 betCount = uint256(r.betCount);
        require(betCount > 0, "empty round");

        uint256 seed = uint256(keccak256(abi.encodePacked(blockhash(entropyBlock), periodId, r.requestBlock)));
        uint256 winnerIndex = seed % betCount;
        address winner = bettors[periodId][winnerIndex];

        uint256 betPool = totalBet[periodId];
        uint256 basePool = _promoBasePool(periodId, betPool);
        uint256 pool = betPool + basePool; // 推广期内奖池 = 真实投注 + 基础奖池

        uint256 winnerAmount = (pool * WINNER_REWARD_BPS) / BPS_DENOMINATOR;
        uint256 teamAmount = (pool * TEAM_REWARD_BPS) / BPS_DENOMINATOR;

        r.drawn = true; // 先落状态，再外部调用

        dlt.mintByLottery(winner, winnerAmount);
        dlt.mintByLottery(team, teamAmount);

        // 非空期就发执行激励（前面已 require betCount > 0）；这是保证每期有人开奖的固定成本。
        dlt.mintByLottery(msg.sender, REWARD_DRAW_EXECUTE);

        emit DrawExecuted(periodId, winner, winnerIndex, winnerAmount, teamAmount, basePool, msg.sender);
    }

    // ==================== 内部工具 ====================

    /**
     * @dev 推广期基础奖池：上线起前 720 期，每期额外补 min(1,000 DLT, 当期真实投注量的一半)。
     *      基础奖池本身不会超过真实烧掉的额度；但开奖激励（10 + 20 DLT）是额外新增的，
     *      所以"自己投 1 注 + 自己开奖"会净赚约 29.47 DLT。这是为了保证早期每期都有人开奖
     *      而明确接受的固定成本，不是漏洞。
     *      没人投注时不补（0 的一半还是 0），空期照旧跳过。
     */
    function _promoBasePool(uint256 periodId, uint256 betPool) private view returns (uint256) {
        if (periodId < promoStartPeriod || periodId >= promoStartPeriod + PROMO_PERIODS) return 0;
        uint256 base = (betPool * PROMO_MATCH_BPS) / BPS_DENOMINATOR;
        return base < PROMO_BASE_POOL ? base : PROMO_BASE_POOL;
    }

    /// @dev 上一次请求的执行窗口是否已过期（过期后允许重新请求）
    function _requestExpired(Round storage r) private view returns (bool) {
        return block.number >= uint256(r.requestBlock) + RANDOM_WAIT_BLOCK + EXECUTE_WINDOW_BLOCKS + 1;
    }
}