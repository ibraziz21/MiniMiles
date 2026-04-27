// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MiniPoints.sol"; // IMiniPoints
import "@witnet/solidity/contracts/interfaces/IWitRandomness.sol";
import "@witnet/solidity/contracts/interfaces/IWitRandomnessConsumer.sol";
import {Witnet} from "@witnet/solidity/contracts/libs/Witnet.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Akiba Dice Game
/// @notice 6-player pots. Each player picks a unique number 1-6 for a given tier.
///         When the pot fills, randomness is requested and one number wins the full pot.
///         V2: adds USDT-denominated USD tiers and optional USDT bonus on the 30-Miles tier.
contract AkibaDiceGame is UUPSUpgradeable, ReentrancyGuardUpgradeable, IWitRandomnessConsumer {
    using SafeERC20 for IERC20;

    /* ────────────────────────────────────────────────────────────── */
    /* Types & storage                                                */
    /* ────────────────────────────────────────────────────────────── */

    /// @dev All economic parameters are snapshotted at round-open time so that
    ///      subsequent owner reconfiguration cannot affect in-flight rounds.
    struct DiceRound {
        uint256 id;
        uint256 tier;
        uint8   filledSlots;
        bool    winnerSelected;
        uint8   winningNumber;
        uint256 randomBlock;
        address winner;

        // ── Config snapshot (immutable once the round is opened) ──────
        /// True when players pay stablecoin; false when they burn AkibaMiles.
        bool    isUsd;
        /// Stablecoin token address (non-zero for USD tiers only).
        address stablecoinSnap;
        /// MiniPoints token address (always snapshotted).
        address miniPointsSnap;
        /// Per-player entry amount.
        ///   Miles tier → raw AkibaMiles (18-dec), e.g. 10e18.
        ///   USD  tier  → USDT amount    (6-dec),  e.g. 250_000.
        uint256 entryAmountSnap;
        /// Winner payout in the *primary* token.
        ///   Miles tier → raw AkibaMiles (18-dec), e.g. 60e18.
        ///   USD  tier  → USDT amount    (6-dec),  e.g. 1_000_000.
        uint256 payoutAmountSnap;
        /// Secondary bonus snapshotted at round-open.
        ///   Miles tier → USDT bonus     (6-dec),  e.g. 100_000 for $0.10.
        ///   USD  tier  → AkibaMiles     (18-dec), e.g. 100e18.
        uint256 bonusSnap;

        // mapping: chosen number => player
        mapping(uint8 => address) playerByNumber;
    }

    /// @notice Round lifecycle used by getRoundState for FE / bots.
    enum RoundState {
        None,        // 0 – invalid
        Open,        // has players, not full
        FullWaiting, // full, randomness missing or pending
        Ready,       // full, randomness ready but not resolved
        Resolved     // winnerSelected
    }

    /// @notice Per-tier aggregate stats.
    struct TierStats {
        uint64  roundsCreated;
        uint64  roundsResolved;
        /// Cumulative entry amounts for completed rounds only (same unit as the tier's token).
        uint128 totalStaked;
        uint128 totalPayout;
    }

    /// @notice Per-player aggregate stats.
    struct PlayerStats {
        uint64  roundsJoined;
        uint64  roundsWon;
        uint128 totalStaked;
        uint128 totalWon;
    }

    address public owner;
    IMiniPoints public miniPoints;

    /// @dev The legacy WitRandomnessV2 address — used only to resolve old rounds
    ///      that stored a randomBlock against the old oracle.
    IWitRandomness public constant RNG_LEGACY =
        IWitRandomness(0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB);

    uint256 public nextRoundId;

    mapping(uint256 => DiceRound) private _rounds;
    mapping(uint256 => uint256) public activeRoundByTier;
    mapping(uint256 => bool) public allowedTier;
    mapping(uint256 => mapping(address => bool)) public hasJoinedRound;

    mapping(uint256 => TierStats) public tierStats;
    mapping(address => PlayerStats) public playerStats;

    uint64  public totalRoundsCreated;
    uint64  public totalRoundsResolved;
    uint64  public totalRoundsCancelled;
    uint128 public totalStakedGlobal;  // mixed-unit global counter (informational)
    uint128 public totalPayoutGlobal;

    /* ── V2 storage (owner-mutable config – NOT read mid-round) ──── */

    /// @notice ERC-20 stablecoin used for USD tiers (USDT on Celo).
    IERC20 public stablecoin;

    /// @notice True if the tier's entry is in stablecoin (not AkibaMiles).
    mapping(uint256 => bool) public isUsdTier;

    /// @notice Stablecoin entry amount per USD tier (6 decimals, e.g. 250000 = $0.25).
    mapping(uint256 => uint256) public usdcEntryAmount;

    /// @notice Stablecoin winner payout per USD tier (6 decimals).
    mapping(uint256 => uint256) public usdcPayoutAmount;

    /// @notice AkibaMiles winner bonus per USD tier (18 decimals).
    mapping(uint256 => uint256) public milesPayoutAmount;

    /// @notice Optional stablecoin bonus for Miles-based tiers (6 decimals).
    mapping(uint256 => uint256) public usdcBonusAmount;

    /// @notice Treasury wallet – receives house revenue from USD tiers.
    address public treasury;

    /// @notice Owner-deposited USDT reserved exclusively for Miles-tier bonuses.
    ///         Tracked separately so USD-round collateral cannot subsidise bonuses.
    uint256 public bonusPool;

    /* ── V3 storage (appended after all V2 slots) ────────────────── */

    /// @dev The canonical WitRandomnessV3 base — address confirmed with Witnet team
    ///      before calling setupClone(). Stored as a variable (not a constant) so it
    ///      can be set at upgrade time without redeploying.
    IWitRandomness public rngBase;

    /// @dev Our private clone of rngBase, settled with this contract as consumer.
    ///      Zero until setupClone() is called; legacy-only mode until then.
    IWitRandomness public rngClone;

    /// @dev Maps randomize block number → roundId for clone-oracle rounds.
    ///      Lets reportRandomness() identify which round to finalize on callback.
    mapping(uint256 => uint256) public roundByRandomBlock;

    /// @dev True for rounds whose randomness was requested via the new clone oracle.
    ///      Default false keeps every pre-existing round on the legacy oracle path.
    mapping(uint256 => bool) public roundUsesCloneRng;

    /* ────────────────────────────────────────────────────────────── */
    /* Events                                                        */
    /* ────────────────────────────────────────────────────────────── */

    event RoundOpened(uint256 indexed roundId, uint256 indexed tier);
    event Joined(uint256 indexed roundId, uint8 indexed number, address indexed player);
    event RandomnessRequested(uint256 indexed roundId, uint256 randomBlock);
    event RoundResolved(
        uint256 indexed roundId, uint8 indexed winningNumber,
        address indexed winner, uint256 payout
    );
    event RoundCancelled(uint256 indexed roundId);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event AllowedTierSet(uint256 indexed tier, bool allowed);
    event UsdTierConfigured(uint256 indexed tier, uint256 entry, uint256 payout, uint256 miles);
    event MilesTierBonusSet(uint256 indexed tier, uint256 bonus);
    event TreasurySet(address indexed treasury);
    event BonusPoolDeposited(address indexed from, uint256 amount);
    event BonusPoolWithdrawn(address indexed to, uint256 amount);
    event CloneSetup(address indexed clone);
    event RandomnessDelivered(uint256 indexed roundId, uint256 indexed randomizeBlock, bytes32 randomness);

    /* ────────────────────────────────────────────────────────────── */
    /* Modifiers                                                     */
    /* ────────────────────────────────────────────────────────────── */

    modifier onlyOwner() {
        require(msg.sender == owner, "Owner: not owner");
        _;
    }

    modifier roundExists(uint256 roundId) {
        require(roundId != 0 && roundId < nextRoundId, "Dice: round not found");
        _;
    }

    /* ────────────────────────────────────────────────────────────── */
    /* Initializers & UUPS                                           */
    /* ────────────────────────────────────────────────────────────── */

    function initialize(address _miniPoints, address _owner) public initializer {
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        require(_miniPoints != address(0), "Dice: invalid MiniPoints");
        require(_owner != address(0), "Dice: invalid owner");

        miniPoints = IMiniPoints(_miniPoints);
        owner = _owner;
        nextRoundId = 1;

        allowedTier[10] = true;
        allowedTier[20] = true;
        allowedTier[30] = true;

        emit OwnershipTransferred(address(0), _owner);
        emit AllowedTierSet(10, true);
        emit AllowedTierSet(20, true);
        emit AllowedTierSet(30, true);
    }

    /// @notice V2 reinitializer – sets stablecoin and treasury.
    function initializeV2(
        address _stablecoin,
        address _treasury
    ) public reinitializer(2) onlyOwner {
        require(_stablecoin != address(0), "Dice: invalid stablecoin");
        require(_treasury != address(0), "Dice: invalid treasury");
        stablecoin = IERC20(_stablecoin);
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    function setMiniPoints(address _mp) external onlyOwner {
        miniPoints = IMiniPoints(_mp);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /* ────────────────────────────────────────────────────────────── */
    /* Core game logic                                               */
    /* ────────────────────────────────────────────────────────────── */

    /// @notice Join a pot for a given tier by picking a number 1–6.
    ///         The round's economic configuration is snapshotted once on creation;
    ///         subsequent owner changes do not affect existing rounds.
    function joinTier(uint256 tier, uint8 chosenNumber) external nonReentrant {
        require(allowedTier[tier], "Dice: tier not allowed");
        require(chosenNumber >= 1 && chosenNumber <= 6, "Dice: bad number");

        uint256 roundId = activeRoundByTier[tier];
        DiceRound storage round = _rounds[roundId];

        // ── Open a new round if none exists or the current one is closed ──
        if (roundId == 0 || round.filledSlots == 6 || round.winnerSelected) {
            roundId = nextRoundId++;
            round = _rounds[roundId];
            round.id = roundId;
            round.tier = tier;
            round.filledSlots = 0;
            round.winnerSelected = false;
            round.winningNumber = 0;
            round.randomBlock = 0;
            round.winner = address(0);

            // ── Snapshot economic config at creation ─────────────────────
            bool usd = isUsdTier[tier];
            round.isUsd = usd;
            round.miniPointsSnap = address(miniPoints);

            if (usd) {
                uint256 entry = usdcEntryAmount[tier];
                require(entry > 0, "Dice: USD tier not configured");
                require(address(stablecoin) != address(0), "Dice: stablecoin not set");
                round.stablecoinSnap   = address(stablecoin);
                round.entryAmountSnap  = entry;
                round.payoutAmountSnap = usdcPayoutAmount[tier];
                round.bonusSnap        = milesPayoutAmount[tier]; // AkibaMiles bonus (18-dec)
            } else {
                // Snapshot the stablecoin address even for Miles rounds so that the
                // optional USDT bonus can be paid from bonusPool using the snapshotted token.
                round.stablecoinSnap   = address(stablecoin);
                round.entryAmountSnap  = tier * 10 ** 18;
                round.payoutAmountSnap = tier * 6 * 10 ** 18;
                round.bonusSnap        = usdcBonusAmount[tier]; // USDT bonus (6-dec)
            }
            // ─────────────────────────────────────────────────────────────

            activeRoundByTier[tier] = roundId;
            totalRoundsCreated += 1;
            tierStats[tier].roundsCreated += 1;
            emit RoundOpened(roundId, tier);
        }

        require(!hasJoinedRound[roundId][msg.sender], "Dice: already joined");
        require(round.playerByNumber[chosenNumber] == address(0), "Dice: number taken");

        // ── Collect entry using the round's snapshotted config ────────────
        uint256 entryAmount;
        if (round.isUsd) {
            entryAmount = round.entryAmountSnap;
            IERC20(round.stablecoinSnap).safeTransferFrom(
                msg.sender, address(this), entryAmount
            );
        } else {
            entryAmount = _milesEntry(round);
            IMiniPoints(_mpAddr(round)).burn(msg.sender, entryAmount);
        }

        round.playerByNumber[chosenNumber] = msg.sender;
        round.filledSlots += 1;
        hasJoinedRound[roundId][msg.sender] = true;

        // ── Stats (recorded in the token's native units) ──────────────────
        uint128 entryForStats = uint128(entryAmount);
        tierStats[tier].totalStaked     += entryForStats;
        totalStakedGlobal               += entryForStats;
        playerStats[msg.sender].roundsJoined += 1;
        playerStats[msg.sender].totalStaked  += entryForStats;

        emit Joined(roundId, chosenNumber, msg.sender);

        if (round.filledSlots == 6) {
            _tryAutoDraw(roundId);
        }
    }

    function requestRoundRandomness(
        uint256 roundId
    ) external payable nonReentrant roundExists(roundId) {
        DiceRound storage round = _rounds[roundId];
        require(round.filledSlots > 0, "Dice: no players yet");
        require(!round.winnerSelected, "Dice: already resolved");
        require(round.randomBlock == 0, "Dice: randomness requested");

        bool useClone = address(rngClone) != address(0);
        IWitRandomness oracle = useClone ? rngClone : RNG_LEGACY;

        uint256 usedFee = oracle.randomize{value: msg.value}();
        round.randomBlock = block.number;

        if (useClone) {
            require(roundByRandomBlock[block.number] == 0, "Dice: randomize block busy");
            roundUsesCloneRng[roundId] = true;
            roundByRandomBlock[block.number] = roundId;
        }

        if (usedFee < msg.value) {
            payable(msg.sender).transfer(msg.value - usedFee);
        }

        emit RandomnessRequested(roundId, round.randomBlock);
    }

    function drawRound(uint256 roundId) external nonReentrant roundExists(roundId) {
        DiceRound storage round = _rounds[roundId];
        require(round.filledSlots == 6, "Dice: pot not full");
        require(!round.winnerSelected, "Dice: already resolved");
        require(round.randomBlock != 0, "Dice: randomness not requested");
        require(_oracleFor(roundId).isRandomized(round.randomBlock), "Dice: randomness pending");
        _finalizeRound(roundId);
    }

    function _tryAutoDraw(uint256 roundId) internal {
        DiceRound storage round = _rounds[roundId];
        if (round.filledSlots != 6) return;
        if (round.winnerSelected) return;
        if (round.randomBlock == 0) return;
        if (!_oracleFor(roundId).isRandomized(round.randomBlock)) return;
        _finalizeRound(roundId);
    }

    /// @dev Returns the correct oracle for a round: clone for new rounds, legacy for old ones.
    ///      roundUsesCloneRng defaults to false, so every pre-existing round stays on RNG_LEGACY.
    function _oracleFor(uint256 roundId) private view returns (IWitRandomness) {
        return roundUsesCloneRng[roundId] ? rngClone : RNG_LEGACY;
    }

    // ── IWitRandomnessConsumer implementation ────────────────────────

    /// @notice Called by our rngClone when Witnet delivers randomness.
    ///         Looks up the round registered for this block and finalizes it.
    ///         Reverts if called by any address other than rngClone.
    function reportRandomness(
        bytes32 randomness,
        uint256 evmRandomizeBlock,
        uint256 /* evmFinalityBlock */,
        Witnet.Timestamp /* witnetTimestamp */,
        Witnet.TransactionHash /* witnetDrTxHash */
    ) external override nonReentrant {
        require(msg.sender == address(rngClone), "Dice: invalid randomizer");

        uint256 roundId = roundByRandomBlock[evmRandomizeBlock];
        if (roundId == 0) return;

        DiceRound storage round = _rounds[roundId];
        if (round.winnerSelected || round.filledSlots != 6) return;

        require(roundUsesCloneRng[roundId], "Dice: round not clone-oracle");
        require(round.randomBlock == evmRandomizeBlock, "Dice: block mismatch");

        // Derive entropy directly from callback args — avoids calling fetchRandomnessAfter()
        // while the result may not yet be past evmFinalityBlock.
        bytes32 entropy = keccak256(abi.encode(evmRandomizeBlock, bytes8(randomness)));

        emit RandomnessDelivered(roundId, evmRandomizeBlock, randomness);
        _finalizeRoundWithEntropy(roundId, entropy);
    }

    /// @notice Required by IWitRandomnessConsumer — returns the clone oracle address.
    function witRandomness() external view override returns (IWitRandomness) {
        return rngClone;
    }

    // ── Clone setup (one-time owner operation) ───────────────────────

    /// @notice Point to the V3 base, create the private clone, register this contract as consumer.
    ///         Confirm `_rngBase` address with Witnet team before calling on mainnet.
    ///         `callbackGasLimit` should be ≥ 350_000 to cover _finalizeRound gas.
    function setupClone(address _rngBase, uint24 callbackGasLimit) external onlyOwner {
        require(address(rngClone) == address(0), "Dice: clone already set");
        require(_rngBase != address(0), "Dice: zero rngBase");
        rngBase = IWitRandomness(_rngBase);
        rngClone = rngBase.clone(address(this));
        rngClone.settleConsumer(address(this), callbackGasLimit);
        emit CloneSetup(address(rngClone));
    }

    // ── Snapshot fallbacks for rounds created before V2 ──────────────
    // Pre-V2 rounds have miniPointsSnap/entryAmountSnap == 0; fall back to
    // the live contract values so those rounds remain playable and pay out correctly.

    function _mpAddr(DiceRound storage round) private view returns (address) {
        return round.miniPointsSnap != address(0) ? round.miniPointsSnap : address(miniPoints);
    }

    function _milesEntry(DiceRound storage round) private view returns (uint256) {
        return round.entryAmountSnap != 0 ? round.entryAmountSnap : round.tier * 10 ** 18;
    }

    function _milesPayout(DiceRound storage round) private view returns (uint256) {
        return round.payoutAmountSnap != 0 ? round.payoutAmountSnap : round.tier * 6 * 10 ** 18;
    }

    /// @dev Pulls entropy from the oracle and finalizes. Used by drawRound and _tryAutoDraw.
    function _finalizeRound(uint256 roundId) internal {
        DiceRound storage round = _rounds[roundId];
        bytes32 entropy = _oracleFor(roundId).fetchRandomnessAfter(round.randomBlock);
        _finalizeRoundWithEntropy(roundId, entropy);
    }

    /// @dev Core payout logic. Accepts precomputed entropy so the push callback
    ///      can finalize without calling fetchRandomnessAfter() mid-delivery.
    function _finalizeRoundWithEntropy(uint256 roundId, bytes32 entropy) internal {
        DiceRound storage round = _rounds[roundId];

        // Use roundId as salt so concurrent rounds sharing the same Witnet block
        // produce distinct winning numbers.
        uint256 pick = uint256(keccak256(abi.encode(entropy, roundId))) % 6;
        uint8 winningNumber = uint8(pick + 1);

        address winner = round.playerByNumber[winningNumber];
        require(winner != address(0), "Dice: empty winner slot");

        round.winnerSelected = true;
        round.winningNumber  = winningNumber;
        round.winner         = winner;

        uint256 payoutForStats;

        if (round.isUsd) {
            // ── USD tier: USDT to winner + house revenue to treasury ──────
            uint256 winnerPayout = round.payoutAmountSnap;
            IERC20(round.stablecoinSnap).safeTransfer(winner, winnerPayout);

            uint256 totalCollected = round.entryAmountSnap * 6;
            uint256 houseRevenue   = totalCollected > winnerPayout
                ? totalCollected - winnerPayout : 0;
            if (houseRevenue > 0 && treasury != address(0)) {
                IERC20(round.stablecoinSnap).safeTransfer(treasury, houseRevenue);
            }

            // AkibaMiles bonus (bonusSnap = miles in 18-dec for USD rounds)
            uint256 milesBonus = round.bonusSnap;
            if (milesBonus > 0) {
                IMiniPoints(round.miniPointsSnap).mint(winner, milesBonus);
            }

            payoutForStats = winnerPayout;
        } else {
            // ── Miles tier: mint full pot + optional USDT bonus ───────────
            // Use fallback values for rounds created before V2 (snapshots are zero).
            uint256 milesPayout = _milesPayout(round);
            IMiniPoints(_mpAddr(round)).mint(winner, milesPayout);

            // bonusSnap = USDT bonus in 6-dec; paid only from the dedicated bonusPool —
            // never from USD-round collateral held in the contract balance.
            // Pre-V2 rounds have bonusSnap=0 so this branch is safely skipped for them.
            uint256 usdtBonus = round.bonusSnap;
            if (usdtBonus > 0 && round.stablecoinSnap != address(0) && bonusPool >= usdtBonus) {
                bonusPool -= usdtBonus;
                IERC20(round.stablecoinSnap).safeTransfer(winner, usdtBonus);
            }

            payoutForStats = milesPayout;
        }

        totalRoundsResolved += 1;
        totalPayoutGlobal   += uint128(payoutForStats);

        TierStats storage ts = tierStats[round.tier];
        ts.roundsResolved += 1;
        ts.totalPayout    += uint128(payoutForStats);

        PlayerStats storage ps = playerStats[winner];
        ps.roundsWon += 1;
        ps.totalWon  += uint128(payoutForStats);

        emit RoundResolved(roundId, winningNumber, winner, payoutForStats);
    }

    /// @notice Owner can cancel a stuck not-full round. Refunds players and
    ///         reverses their stats contributions.
    function cancelRound(
        uint256 roundId
    ) external nonReentrant onlyOwner roundExists(roundId) {
        DiceRound storage round = _rounds[roundId];
        require(!round.winnerSelected, "Dice: already resolved");
        require(round.filledSlots < 6, "Dice: full pot");
        require(round.randomBlock == 0, "Dice: randomness requested");

        // Use fallback for pre-V2 rounds where snapshots are zero.
        uint256 refundAmount = round.isUsd ? round.entryAmountSnap : _milesEntry(round);
        uint128 refundForStats = uint128(refundAmount);

        for (uint8 n = 1; n <= 6; n++) {
            address player = round.playerByNumber[n];
            if (player == address(0)) continue;

            // Refund using snapshotted token (with V2 fallback for Miles rounds).
            if (round.isUsd) {
                IERC20(round.stablecoinSnap).safeTransfer(player, refundAmount);
            } else {
                IMiniPoints(_mpAddr(round)).mint(player, refundAmount);
            }

            // Reverse join stats
            PlayerStats storage ps = playerStats[player];
            if (ps.roundsJoined > 0) ps.roundsJoined -= 1;
            if (ps.totalStaked >= refundForStats) ps.totalStaked -= refundForStats;

            round.playerByNumber[n] = address(0);
            hasJoinedRound[roundId][player] = false;
        }

        // Reverse tier + global staked counters
        uint128 totalRefunded = refundForStats * uint128(round.filledSlots);
        TierStats storage ts = tierStats[round.tier];
        if (ts.totalStaked >= totalRefunded) ts.totalStaked -= totalRefunded;
        if (totalStakedGlobal >= totalRefunded) totalStakedGlobal -= totalRefunded;

        round.filledSlots    = 0;
        round.winnerSelected = true; // mark closed

        totalRoundsCancelled += 1;
        emit RoundCancelled(roundId);
    }

    /* ────────────────────────────────────────────────────────────── */
    /* View helpers                                                  */
    /* ────────────────────────────────────────────────────────────── */

    function getRoundInfo(uint256 roundId)
        external view roundExists(roundId)
        returns (
            uint256 tier, uint8 filledSlots, bool winnerSelected,
            uint8 winningNumber, uint256 randomBlock, address winner
        )
    {
        DiceRound storage r = _rounds[roundId];
        return (r.tier, r.filledSlots, r.winnerSelected, r.winningNumber, r.randomBlock, r.winner);
    }

    function getRoundSlots(uint256 roundId)
        external view roundExists(roundId)
        returns (address[6] memory players, uint8[6] memory numbers)
    {
        DiceRound storage round = _rounds[roundId];
        for (uint8 i = 0; i < 6; i++) {
            uint8 num = i + 1;
            players[i] = round.playerByNumber[num];
            numbers[i] = num;
        }
    }

    function getRoundSlotPlayer(
        uint256 roundId, uint8 number
    ) external view roundExists(roundId) returns (address) {
        require(number >= 1 && number <= 6, "Dice: bad number");
        return _rounds[roundId].playerByNumber[number];
    }

    function getMyNumberInRound(
        uint256 roundId, address player
    ) external view roundExists(roundId) returns (bool joined, uint8 number) {
        DiceRound storage round = _rounds[roundId];
        for (uint8 n = 1; n <= 6; n++) {
            if (round.playerByNumber[n] == player) return (true, n);
        }
        return (false, 0);
    }

    function getActiveRoundId(uint256 tier) external view returns (uint256) {
        return activeRoundByTier[tier];
    }

    function getRoundState(uint256 roundId)
        external view roundExists(roundId) returns (RoundState)
    {
        DiceRound storage r = _rounds[roundId];
        if (r.winnerSelected) return RoundState.Resolved;
        if (r.filledSlots < 6) return RoundState.Open;
        if (r.randomBlock == 0 || !_oracleFor(roundId).isRandomized(r.randomBlock)) return RoundState.FullWaiting;
        return RoundState.Ready;
    }

    function getMyActiveEntryForTier(
        uint256 tier, address player
    ) external view returns (bool joined, uint256 roundId, uint8 number) {
        roundId = activeRoundByTier[tier];
        if (roundId == 0) return (false, 0, 0);
        DiceRound storage round = _rounds[roundId];
        for (uint8 n = 1; n <= 6; n++) {
            if (round.playerByNumber[n] == player) return (true, roundId, n);
        }
        return (false, roundId, 0);
    }

    function getTierStats(uint256 tier)
        external view
        returns (uint64 roundsCreated, uint64 roundsResolved, uint128 totalStaked, uint128 totalPayout)
    {
        TierStats storage ts = tierStats[tier];
        return (ts.roundsCreated, ts.roundsResolved, ts.totalStaked, ts.totalPayout);
    }

    function getPlayerStats(address player)
        external view
        returns (uint64 roundsJoined, uint64 roundsWon, uint128 totalStaked, uint128 totalWon)
    {
        PlayerStats storage ps = playerStats[player];
        return (ps.roundsJoined, ps.roundsWon, ps.totalStaked, ps.totalWon);
    }

    /* ────────────────────────────────────────────────────────────── */
    /* Admin                                                         */
    /* ────────────────────────────────────────────────────────────── */

    function setAllowedTier(uint256 tier, bool allowed) external onlyOwner {
        allowedTier[tier] = allowed;
        emit AllowedTierSet(tier, allowed);
    }

    /// @notice Configure a USD-denominated tier.
    ///         Only affects rounds opened after this call.
    function setupUsdTier(
        uint256 tierId,
        uint256 entryAmount,
        uint256 payoutAmount,
        uint256 milesAmount
    ) external onlyOwner {
        require(entryAmount > 0, "Dice: zero entry");
        require(payoutAmount > 0, "Dice: zero payout");
        require(payoutAmount <= entryAmount * 6, "Dice: payout exceeds pot");
        isUsdTier[tierId]       = true;
        allowedTier[tierId]     = true;
        usdcEntryAmount[tierId] = entryAmount;
        usdcPayoutAmount[tierId]= payoutAmount;
        milesPayoutAmount[tierId]= milesAmount;
        emit UsdTierConfigured(tierId, entryAmount, payoutAmount, milesAmount);
    }

    /// @notice Set optional USDT bonus for a Miles-based tier.
    ///         Only affects rounds opened after this call.
    function setMilesTierBonus(uint256 tier, uint256 bonus) external onlyOwner {
        require(!isUsdTier[tier], "Dice: use setupUsdTier for USD tiers");
        usdcBonusAmount[tier] = bonus;
        emit MilesTierBonusSet(tier, bonus);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Dice: zero address");
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    function setStablecoin(address _stablecoin) external onlyOwner {
        require(_stablecoin != address(0), "Dice: zero address");
        stablecoin = IERC20(_stablecoin);
    }

    /// @notice Deposit USDT into the bonus pool. Only these funds are used to pay
    ///         Miles-tier USDT bonuses. USD-round collateral is never touched.
    function depositBonusPool(uint256 amount) external onlyOwner {
        require(amount > 0, "Dice: zero amount");
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        bonusPool += amount;
        emit BonusPoolDeposited(msg.sender, amount);
    }

    /// @notice Withdraw from the bonus pool only. Cannot touch USD-round collateral.
    function withdrawBonusPool(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Dice: zero address");
        require(bonusPool >= amount, "Dice: insufficient bonus pool");
        bonusPool -= amount;
        stablecoin.safeTransfer(to, amount);
        emit BonusPoolWithdrawn(to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Owner: zero addr");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice One-time migration for rounds created before V2.
    ///
    ///         The V2 upgrade inserted six config-snapshot fields into DiceRound
    ///         *before* the playerByNumber mapping, shifting the mapping's storage
    ///         slot from struct-offset 5 (V1) to struct-offset 10 (V2).  Player
    ///         addresses written by V1 therefore sit at slot-5 positions while V2+
    ///         reads slot-10 positions — returning address(0) for every number even
    ///         though filledSlots > 0.
    ///
    ///         This function reads each player address directly from the V1 slot
    ///         via assembly and writes it into the V2 slot, making all existing
    ///         view functions and game logic see the correct data again.
    ///
    ///         Safe to call multiple times; skips any number whose V2 slot already
    ///         has a player (handles the case where a post-V2 join raced a V1 slot).
    function migrateV1PlayerSlots(uint256 roundId) external onlyOwner roundExists(roundId) {
        DiceRound storage round = _rounds[roundId];
        require(round.miniPointsSnap == address(0), "Dice: not a pre-V2 round");
        require(!round.winnerSelected, "Dice: round already resolved");

        // Slot of the _rounds mapping in contract storage.
        uint256 roundsSlot;
        assembly { roundsSlot := _rounds.slot }

        // Base storage slot of the struct _rounds[roundId].
        uint256 structBase = uint256(keccak256(abi.encode(roundId, roundsSlot)));

        // V1: playerByNumber occupied struct-relative slot 5.
        uint256 v1MapBase = structBase + 5;

        for (uint8 n = 1; n <= 6; n++) {
            // V1 player slot = keccak256(number, v1MapBase)
            bytes32 v1Slot = keccak256(abi.encode(uint256(n), v1MapBase));
            address v1Player;
            assembly { v1Player := sload(v1Slot) }

            // Write to V2 slot only if V1 had a player and V2 slot is still empty.
            if (v1Player != address(0) && round.playerByNumber[n] == address(0)) {
                round.playerByNumber[n] = v1Player;
            }
        }
    }

    // 32 slots remain after the 8 V2 variables consumed from the original gap of 40
    uint256[32] private __gap;
}
