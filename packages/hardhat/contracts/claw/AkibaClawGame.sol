// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {IClawRng} from "./IClawRng.sol";
import {IMiniPoints} from "../MiniPoints.sol";

/* ─────────────────────────────── Interfaces ──────────────────────────────── */

interface IAkibaRewardVault {
    function pay(address to, uint256 amount) external;
    function balance() external view returns (uint256);
}

interface IAkibaVoucherRegistry {
    function issue(
        address owner_,
        uint8   tierId,
        uint8   rewardClass,
        uint16  discountBps,
        uint256 maxValue,
        uint256 expiresAt,
        bytes32 merchantId
    ) external returns (uint256 voucherId);

    function markBurned(uint256 voucherId) external;
}

/* ─────────────────────────────── Main Contract ───────────────────────────── */

/// @title AkibaClawGame
/// @notice Three-tier claw machine game backed by a pluggable RNG adapter.
///
///         Tiers:
///           0 — Basic       50 AkibaMiles
///           1 — Better Odds 150 AkibaMiles
///           2 — Premium     1 USDT
///
///         Reward classes: Lose | Common | Rare | Epic | Legendary
///
///         Flow:
///           startGame(tierId)      — pay, register a batch/VRF request, open session
///           settleGame(sessionId)  — anyone calls once the RNG result is ready; determines outcome
///           claimReward(sessionId) — player claims (Miles / USDT / voucher)
///           burnVoucherReward(sessionId) — player burns Rare/Legendary for fallback value
///
///         Current production mode uses MerkleBatchRng. Settlement is permissionless;
///         a backend relayer monitors pending sessions and commits outcomes.
contract AkibaClawGame is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    /* ─────────────────────────── Constants ─────────────────────────────────── */

    uint32  public constant TOTAL_WEIGHT   = 10_000;
    uint256 public constant VOUCHER_EXPIRY = 14 days;

    /* ─────────────────────────── Enums ─────────────────────────────────────── */

    /// @notice Reward outcome for a settled session.
    enum RewardClass {
        None,       // 0 — default / unset
        Lose,       // 1
        Common,     // 2 — AkibaMiles reward
        Rare,       // 3 — 20% merchant voucher (or burn for Miles fallback)
        Epic,       // 4 — direct USDT reward
        Legendary   // 5 — 100% capped merchant voucher (or burn for USDT fallback)
    }

    /// @notice Session lifecycle state machine.
    enum SessionStatus {
        None,      // 0 — slot unused
        Pending,   // 1 — randomness requested, awaiting resolution
        Settled,   // 2 — reward class determined, awaiting player action
        Claimed,   // 3 — reward claimed (Miles minted / USDT sent / voucher issued)
        Burned,    // 4 — voucher reward burned for fallback value
        Refunded   // 5 — emergency refund by admin
    }

    /* ─────────────────────────── Structs ───────────────────────────────────── */

    /// @notice Per-tier configuration. Stored in a mapping and fully admin-configurable.
    struct TierConfig {
        bool    active;
        uint8   tierId;

        // ── Payment ───────────────────────────────────────────────────────────
        /// @dev true → burn AkibaMiles; false → transfer USDT to reward vault
        bool    payInMiles;
        /// @dev 18-dec for Miles, 6-dec for USDT
        uint256 playCost;

        // ── Weights (must sum to TOTAL_WEIGHT = 10 000) ───────────────────────
        uint32  loseWeight;
        uint32  commonWeight;
        uint32  rareWeight;
        uint32  epicWeight;
        uint32  legendaryWeight;

        // ── Reward amounts ────────────────────────────────────────────────────
        uint256 commonMilesReward;   // Miles minted on Common win       (18 dec)
        uint256 rareBurnMiles;       // Miles minted if Rare voucher burned  (18 dec)
        uint256 epicUsdtReward;      // USDT sent on Epic win             (6 dec)
        uint256 legendaryBurnUsdt;   // USDT sent if Legendary voucher burned (6 dec)

        // ── Voucher params ────────────────────────────────────────────────────
        uint16  rareVoucherBps;        // 2000  (20 %)
        uint16  legendaryVoucherBps;   // 10000 (100 %)
        uint256 legendaryVoucherCap;   // max USDT value of legendary voucher (6 dec)

        // ── Safety limits ─────────────────────────────────────────────────────
        uint256 dailyPlayLimit;      // max plays per tier per UTC day (0 = unlimited)
        uint256 legendaryCooldown;   // seconds between legendary wins per wallet
        bytes32 defaultMerchantId;   // merchant ID stamped on issued vouchers
    }

    /// @notice State for one game session.
    struct GameSession {
        uint256       sessionId;
        address       player;
        uint8         tierId;
        SessionStatus status;
        uint256       createdAt;
        uint256       settledAt;
        uint256       requestBlock; // block used as Witnet anchor
        RewardClass   rewardClass;
        /// @dev Common/Epic: reward amount; Rare/Legendary: fallback amount for burn path
        uint256       rewardAmount;
        uint256       voucherId;    // 0 if no voucher issued yet
    }

    /* ─────────────────────────── State ─────────────────────────────────────── */

    IClawRng public rng;
    IMiniPoints           public miles;
    IERC20                public usdt;
    IAkibaRewardVault     public rewardVault;
    IAkibaVoucherRegistry public voucherRegistry;

    mapping(uint8   => TierConfig)   internal _tiers;
    mapping(uint256 => GameSession)  internal _sessions;

    uint256 public nextSessionId;

    /// @notice Daily play counter: tierId → UTC day → count.
    mapping(uint8 => mapping(uint256 => uint256)) public dailyPlays;

    /// @notice Number of Pending sessions per player (capped by maxUnresolvedPerUser).
    mapping(address => uint256) public unresolvedSessions;
    uint256 public maxUnresolvedPerUser;

    /// @notice Timestamp of each player's most recent Legendary win (any tier).
    mapping(address => uint256) public lastLegendaryAt;

    /* ─────────────────────────── Events ────────────────────────────────────── */

    event TierConfigured(uint8 indexed tierId);

    event GameStarted(
        uint256 indexed sessionId,
        address indexed player,
        uint8   indexed tierId,
        uint256         playCost,
        uint256         requestBlock
    );

    event GameSettled(
        uint256     indexed sessionId,
        address     indexed player,
        RewardClass         rewardClass,
        uint256             rewardAmount
    );

    event RewardClaimed(
        uint256     indexed sessionId,
        address     indexed player,
        RewardClass         rewardClass
    );

    event VoucherIssued(
        uint256 indexed voucherId,
        uint256 indexed sessionId,
        address indexed owner
    );

    event VoucherBurned(
        uint256 indexed voucherId,
        address indexed owner,
        uint256         fallbackAmount
    );

    event EmergencyRefund(uint256 indexed sessionId, address indexed player);

    /* ─────────────────────────── Errors ────────────────────────────────────── */

    error TierNotActive(uint8 tierId);
    error InvalidWeights(uint256 total);
    error DailyLimitReached(uint8 tierId);
    error TooManyUnresolvedSessions();
    error LegendaryCooldownActive(uint256 unlocksAt);
    error SessionNotFound(uint256 sessionId);
    error WrongStatus(SessionStatus current);
    error RandomnessNotReady(uint256 sessionId);
    error NotPlayer(address caller);

    /* ─────────────────────────── Initializer ───────────────────────────────── */

    function initialize(
        address _rng,
        address _miles,
        address _usdt,
        address _rewardVault,
        address _voucherRegistry,
        address _owner
    ) external initializer {
        require(
            _rng             != address(0) &&
            _miles           != address(0) &&
            _usdt            != address(0) &&
            _rewardVault     != address(0) &&
            _voucherRegistry != address(0) &&
            _owner           != address(0),
            "zero addr"
        );
        __Ownable_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        rng              = IClawRng(_rng);
        miles            = IMiniPoints(_miles);
        usdt             = IERC20(_usdt);
        rewardVault      = IAkibaRewardVault(_rewardVault);
        voucherRegistry  = IAkibaVoucherRegistry(_voucherRegistry);

        nextSessionId        = 1;
        maxUnresolvedPerUser = 3;

        _transferOwnership(_owner);
        _initDefaultTiers();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /* ─────────────────────────── Default Tier Setup ────────────────────────── */

    /// @dev Writes the three V1 tiers as per the game spec. All amounts are admin-updatable.
    function _initDefaultTiers() internal {
        // ── Tier 0 · Basic · 50 Miles ────────────────────────────────────────
        _tiers[0] = TierConfig({
            active:              true,
            tierId:              0,
            payInMiles:          true,
            playCost:            50e18,
            loseWeight:          6000,
            commonWeight:        3200,
            rareWeight:           600,
            epicWeight:           180,
            legendaryWeight:       20,
            commonMilesReward:   100e18,  // 2× play cost
            rareBurnMiles:       50e18,   // 1× play cost
            epicUsdtReward:       1e6,    // 1 USDT
            legendaryBurnUsdt:    3e6,    // 3 USDT
            rareVoucherBps:      2000,
            legendaryVoucherBps: 10000,
            legendaryVoucherCap: 15e6,    // up to 15 USDT
            dailyPlayLimit:      0,
            legendaryCooldown:   7 days,
            defaultMerchantId:   bytes32(0)
        });

        // ── Tier 1 · Better Odds · 150 Miles ─────────────────────────────────
        _tiers[1] = TierConfig({
            active:              true,
            tierId:              1,
            payInMiles:          true,
            playCost:            150e18,
            loseWeight:          5000,
            commonWeight:        3500,
            rareWeight:          1000,
            epicWeight:           400,
            legendaryWeight:      100,
            commonMilesReward:   300e18,  // 2× play cost
            rareBurnMiles:       300e18,   // 2× play cost
            epicUsdtReward:        2e6,    // 2 USDT
            legendaryBurnUsdt:     5e6,    // 5 USDT
            rareVoucherBps:      2000,
            legendaryVoucherBps: 10000,
            legendaryVoucherCap: 15e6,
            dailyPlayLimit:      0,
            legendaryCooldown:   7 days,
            defaultMerchantId:   bytes32(0)
        });

        // ── Tier 2 · Premium · 1 USDT ────────────────────────────────────────
        _tiers[2] = TierConfig({
            active:              true,
            tierId:              2,
            payInMiles:          false,
            playCost:             1e6,    // 1 USDT (6 dec)
            loseWeight:          4500,
            commonWeight:        3500,
            rareWeight:          1200,
            epicWeight:           600,
            legendaryWeight:      200,
            commonMilesReward:   200e18,  // 200 Miles
            rareBurnMiles:       600e18,  // 3× Common reward
            epicUsdtReward:        2e6,   // 2 USDT (> 1 USDT entry)
            legendaryBurnUsdt:     8e6,   // 8 USDT
            rareVoucherBps:      2000,
            legendaryVoucherBps: 10000,
            legendaryVoucherCap: 15e6,
            dailyPlayLimit:      0,
            legendaryCooldown:   7 days,
            defaultMerchantId:   bytes32(0)
        });

        emit TierConfigured(0);
        emit TierConfigured(1);
        emit TierConfigured(2);
    }

    /* ─────────────────────────── User: startGame ───────────────────────────── */

    /// @notice Open a claw game session.
    /// @param tierId 0 = Basic, 1 = Boosted, 2 = Premium
    /// @dev    In production the game uses MerkleBatchRng, so no CELO fee quote is required.
    ///         The RNG adapter remains pluggable as long as requestRandom(sessionId) conforms
    ///         to IClawRng.
    function startGame(uint8 tierId)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 sessionId)
    {
        TierConfig storage tier = _tiers[tierId];
        if (!tier.active) revert TierNotActive(tierId);

        // Daily play limit
        if (tier.dailyPlayLimit > 0) {
            uint256 today = block.timestamp / 86400;
            if (dailyPlays[tierId][today] >= tier.dailyPlayLimit)
                revert DailyLimitReached(tierId);
            dailyPlays[tierId][today]++;
        }

        // Per-user unresolved cap
        if (unresolvedSessions[msg.sender] >= maxUnresolvedPerUser)
            revert TooManyUnresolvedSessions();

        // Legendary cooldown (anti-farming)
        if (lastLegendaryAt[msg.sender] > 0) {
            uint256 unlocksAt = lastLegendaryAt[msg.sender] + tier.legendaryCooldown;
            if (block.timestamp < unlocksAt)
                revert LegendaryCooldownActive(unlocksAt);
        }

        // Collect payment
        if (tier.payInMiles) {
            miles.burn(msg.sender, tier.playCost);
        } else {
            // Premium: USDT goes directly into the reward vault
            usdt.safeTransferFrom(msg.sender, address(rewardVault), tier.playCost);
        }

        // Create session first so requestRandom can be keyed to sessionId
        sessionId = nextSessionId++;
        _sessions[sessionId] = GameSession({
            sessionId:    sessionId,
            player:       msg.sender,
            tierId:       tierId,
            status:       SessionStatus.Pending,
            createdAt:    block.timestamp,
            settledAt:    0,
            requestBlock: block.number,
            rewardClass:  RewardClass.None,
            rewardAmount: 0,
            voucherId:    0
        });

        // Batch mode assigns the session to the next play slot.
        // The adapter interface remains payable, but production wiring uses zero-fee batch RNG.
        rng.requestRandom(sessionId);

        unresolvedSessions[msg.sender]++;

        emit GameStarted(sessionId, msg.sender, tierId, tier.playCost, block.number);
    }

    /* ─────────────────────────── Permissionless: settleGame ────────────────── */

    /// @notice Settle a pending session once cross-chain randomness has arrived.
    ///         Permissionless — any address (keeper, player, or third party) may call.
    function settleGame(uint256 sessionId) external nonReentrant {
        GameSession storage session = _sessions[sessionId];
        if (session.sessionId == 0)                  revert SessionNotFound(sessionId);
        if (session.status != SessionStatus.Pending) revert WrongStatus(session.status);
        if (!rng.isReady(session.sessionId)) revert RandomnessNotReady(session.sessionId);

        TierConfig storage tier = _tiers[session.tierId];

        // Mode A — batch/raffle: operator pre-committed the outcome via Merkle proof.
        // Mode B — VRF: derive outcome from the random word via weight bands.
        uint8 committed = rng.getCommittedClass(session.sessionId);
        RewardClass rc = (committed != 0)
            ? RewardClass(committed)
            : _mapRoll(uint256(rng.getRandom(session.sessionId, TOTAL_WEIGHT)), tier);
        uint256     amt = _rewardAmountFor(rc, tier);

        session.rewardClass  = rc;
        session.rewardAmount = amt;
        session.status       = SessionStatus.Settled;
        session.settledAt    = block.timestamp;

        unresolvedSessions[session.player]--;

        if (rc == RewardClass.Legendary) {
            lastLegendaryAt[session.player] = block.timestamp;
        }

        emit GameSettled(sessionId, session.player, rc, amt);
    }

    /* ─────────────────────────── User: claimReward ─────────────────────────── */

    /// @notice Claim the reward for a settled session.
    ///         - Lose:      no-op (emits event)
    ///         - Common:    AkibaMiles minted
    ///         - Rare:      20% merchant voucher issued (can still burn afterward)
    ///         - Epic:      USDT transferred from reward vault
    ///         - Legendary: 100%-capped merchant voucher issued (can still burn afterward)
    /// @notice Claim the settled reward. Permissionless — reward always goes to session.player.
    ///         The relayer auto-calls this after settlement so players need no extra tx.
    function claimReward(uint256 sessionId) external nonReentrant whenNotPaused {
        GameSession storage session = _sessions[sessionId];
        if (session.sessionId == 0)                   revert SessionNotFound(sessionId);
        if (session.status != SessionStatus.Settled)  revert WrongStatus(session.status);

        session.status   = SessionStatus.Claimed;
        address player   = session.player;

        TierConfig  storage tier = _tiers[session.tierId];
        RewardClass rc           = session.rewardClass;

        if (rc == RewardClass.Lose) {
            // nothing distributed
        } else if (rc == RewardClass.Common) {
            miles.mint(player, session.rewardAmount);
        } else if (rc == RewardClass.Epic) {
            rewardVault.pay(player, session.rewardAmount);
        } else if (rc == RewardClass.Rare || rc == RewardClass.Legendary) {
            uint256 vId = _issueVoucher(session, tier);
            session.voucherId = vId;
            emit VoucherIssued(vId, sessionId, player);
        }

        emit RewardClaimed(sessionId, player, rc);
    }

    /* ─────────────────────────── User: burnVoucherReward ───────────────────── */

    /// @notice Burn a Rare or Legendary reward to receive the fallback value instead.
    ///         Can be called either:
    ///           a) directly after settlement (status = Settled)  — no voucher was minted yet
    ///           b) after a claimReward call  (status = Claimed)  — burns the already-issued voucher
    function burnVoucherReward(uint256 sessionId) external nonReentrant whenNotPaused {
        GameSession storage session = _sessions[sessionId];
        if (session.sessionId == 0)  revert SessionNotFound(sessionId);
        if (session.player != msg.sender) revert NotPlayer(msg.sender);

        RewardClass rc = session.rewardClass;
        require(
            rc == RewardClass.Rare || rc == RewardClass.Legendary,
            "Claw: not a voucher reward"
        );

        SessionStatus st   = session.status;
        TierConfig storage tier = _tiers[session.tierId];

        if (st == SessionStatus.Settled) {
            // Path A: burn before claiming — no voucher was ever issued.
            session.status = SessionStatus.Burned;
            _distributeBurnFallback(rc, tier, 0);

        } else if (st == SessionStatus.Claimed) {
            // Path B: voucher already issued — burn it via the registry.
            require(session.voucherId != 0, "Claw: no voucher on session");
            voucherRegistry.markBurned(session.voucherId);
            session.status = SessionStatus.Burned;
            _distributeBurnFallback(rc, tier, session.voucherId);

        } else {
            revert WrongStatus(st);
        }
    }

    /* ─────────────────────────── Views ─────────────────────────────────────── */

    function getTierConfig(uint8 tierId) external view returns (TierConfig memory) {
        return _tiers[tierId];
    }

    function getSession(uint256 sessionId) external view returns (GameSession memory) {
        return _sessions[sessionId];
    }

    /// @notice Returns true if settleGame(sessionId) would succeed right now.
    function canSettle(uint256 sessionId) external view returns (bool) {
        GameSession storage s = _sessions[sessionId];
        return s.sessionId != 0
            && s.status == SessionStatus.Pending
            && rng.isReady(s.sessionId);
    }

    /* ─────────────────────────── Admin ─────────────────────────────────────── */

    /// @notice Update or add a tier. Weights must sum to exactly TOTAL_WEIGHT.
    function setTierConfig(uint8 tierId, TierConfig calldata cfg) external onlyOwner {
        uint256 total = uint256(cfg.loseWeight)
            + cfg.commonWeight
            + cfg.rareWeight
            + cfg.epicWeight
            + cfg.legendaryWeight;
        if (total != TOTAL_WEIGHT) revert InvalidWeights(total);
        _tiers[tierId] = cfg;
        emit TierConfigured(tierId);
    }

    function setRewardVault(address vault) external onlyOwner {
        require(vault != address(0), "zero addr");
        rewardVault = IAkibaRewardVault(vault);
    }

    function setVoucherRegistry(address registry) external onlyOwner {
        require(registry != address(0), "zero addr");
        voucherRegistry = IAkibaVoucherRegistry(registry);
    }

    function setRng(address _rng) external onlyOwner {
        require(_rng != address(0), "zero addr");
        rng = IClawRng(_rng);
    }

    function setMiles(address _miles) external onlyOwner {
        require(_miles != address(0), "zero addr");
        miles = IMiniPoints(_miles);
    }

    function setMaxUnresolvedPerUser(uint256 max) external onlyOwner {
        maxUnresolvedPerUser = max;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Accept CELO transfers. Retained for upgrade compatibility.
    receive() external payable {}

    /// @notice Withdraw CELO held by the contract. Admin only.
    function withdrawCelo(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero addr");
        require(address(this).balance >= amount, "insufficient balance");
        to.transfer(amount);
    }

    /// @notice Rescue ERC-20 tokens accidentally sent directly to this contract. Admin only.
    ///         The game never holds ERC-20 balances during normal operation — any balance
    ///         here is accidental and safe to sweep.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero addr");
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Refund a session that has been stuck in Pending beyond a reasonable timeout.
    ///         Returns the play cost to the player. Admin only.
    function emergencyRefund(uint256 sessionId) external onlyOwner nonReentrant {
        GameSession storage session = _sessions[sessionId];
        if (session.sessionId == 0)                  revert SessionNotFound(sessionId);
        if (session.status != SessionStatus.Pending) revert WrongStatus(session.status);

        session.status = SessionStatus.Refunded;
        unresolvedSessions[session.player]--;

        TierConfig storage tier = _tiers[session.tierId];
        if (tier.payInMiles) {
            miles.mint(session.player, tier.playCost);
        } else {
            rewardVault.pay(session.player, tier.playCost);
        }

        emit EmergencyRefund(sessionId, session.player);
    }

    /* ─────────────────────────── Internal Helpers ──────────────────────────── */

    /// @dev Map a roll in [0, TOTAL_WEIGHT) to a RewardClass using the tier's weight bands.
    function _mapRoll(uint256 roll, TierConfig storage tier)
        internal
        view
        returns (RewardClass)
    {
        uint256 acc = tier.loseWeight;
        if (roll < acc) return RewardClass.Lose;

        acc += tier.commonWeight;
        if (roll < acc) return RewardClass.Common;

        acc += tier.rareWeight;
        if (roll < acc) return RewardClass.Rare;

        acc += tier.epicWeight;
        if (roll < acc) return RewardClass.Epic;

        return RewardClass.Legendary;
    }

    /// @dev Determine the reward amount that gets stored on the session at settle time.
    ///      For Rare/Legendary this stores the *fallback* amount used by the burn path,
    ///      so it's always accessible whether or not the player claims normally first.
    function _rewardAmountFor(RewardClass rc, TierConfig storage tier)
        internal
        view
        returns (uint256)
    {
        if (rc == RewardClass.Common)    return tier.commonMilesReward;
        if (rc == RewardClass.Rare)      return tier.rareBurnMiles;
        if (rc == RewardClass.Epic)      return tier.epicUsdtReward;
        if (rc == RewardClass.Legendary) return tier.legendaryBurnUsdt;
        return 0;
    }

    /// @dev Issue a voucher via the registry and return its id.
    function _issueVoucher(GameSession storage session, TierConfig storage tier)
        internal
        returns (uint256 voucherId)
    {
        bool isLegendary = session.rewardClass == RewardClass.Legendary;
        voucherId = voucherRegistry.issue(
            session.player,
            session.tierId,
            uint8(session.rewardClass),
            isLegendary ? tier.legendaryVoucherBps : tier.rareVoucherBps,
            isLegendary ? tier.legendaryVoucherCap : 0,
            block.timestamp + VOUCHER_EXPIRY,
            tier.defaultMerchantId
        );
    }

    /// @dev Send the fallback value to the caller after a burn.
    function _distributeBurnFallback(
        RewardClass rc,
        TierConfig  storage tier,
        uint256     voucherId
    ) internal {
        if (rc == RewardClass.Rare) {
            miles.mint(msg.sender, tier.rareBurnMiles);
            emit VoucherBurned(voucherId, msg.sender, tier.rareBurnMiles);
        } else {
            rewardVault.pay(msg.sender, tier.legendaryBurnUsdt);
            emit VoucherBurned(voucherId, msg.sender, tier.legendaryBurnUsdt);
        }
    }

    /* ─────────────────────────── Storage Gap ───────────────────────────────── */

    uint256[42] private __gap;
}
