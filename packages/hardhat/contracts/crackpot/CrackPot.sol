// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Minimal AkibaMiles interface — non-transferable ERC-20 with mint/burn.
interface IAkibaMiles {
    function mint(address account, uint256 amount) external;
    function burn(address account, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title CrackPot
 * @notice Jackpot game where players pay an entry fee to guess a server-generated
 *         4-symbol code. The first player to crack it wins the entire pot.
 *         If the cycle timer expires unclaimed the pot implodes and resets.
 *
 * Two versions run in parallel on-chain:
 *   Version MILES  — entry in AkibaMiles (burn), payout in AkibaMiles (mint).
 *                    Hourly cycles. Full entry goes to pot; no house rake.
 *   Version USDT   — entry in USDT (transfer), 50% to pot / 50% to house.
 *                    12-hour cycles. Payout from contract USDT balance.
 *
 * The server (relayer) is the only party that can:
 *   - Open a new cycle          (openCycle)
 *   - Declare a winner          (declareWinner)
 *   - Expire an unclaimed cycle (expireCycle)
 *
 * The contract never knows the secret code. It only holds funds and enforces
 * economic rules. All Mastermind logic lives off-chain.
 *
 * USDT accounting invariant (enforced at every mutation):
 *   usdtToken.balanceOf(address(this)) >= usdtReservedPot + usdtHouseWithdrawable
 *
 * Fairness commitment:
 *   Every cycle carries a `secretCommitment` (bytes32 keccak256 precommitment) set
 *   by the relayer when the cycle is opened.  After the cycle ends the server
 *   publishes the preimage so players can verify the secret was fixed before any
 *   entry was accepted.
 *   Algorithm:
 *     keccak256(abi.encodePacked(
 *       "CRACKPOT_SECRET_V1",
 *       block.chainid,      // uint256
 *       address(this),      // address
 *       uint8(version),     // uint8
 *       expiresAt,          // uint64
 *       salt,               // bytes32
 *       codeBytes           // bytes4  (one byte per symbol, 0–5)
 *     ))
 */
contract CrackPot is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────

    enum Version { MILES, USDT }
    enum CycleStatus { ACTIVE, CRACKED, DEAD }

    struct Cycle {
        uint256 id;
        Version version;
        CycleStatus status;

        uint256 potBalance;      // Miles (18-dec) or USDT micro-units (6-dec)
        uint256 potCap;          // Maximum pot before overflow seeded to next cycle
        uint256 seedAmount;      // Amount seeded by platform at cycle open
        uint256 houseAccrued;    // USDT-only: house rake accumulated this cycle

        uint64  openedAt;        // block.timestamp
        uint64  expiresAt;       // server sets this; relayer passes it on openCycle

        address winner;          // zero until cracked
        uint256 winnerGuesses;   // informational only

        // Appended for upgrade safety — reads as 0x0 on pre-upgrade cycles.
        bytes32 secretCommitment;
    }

    // ── Storage ──────────────────────────────────────────────────────
    // IMPORTANT: Never reorder or remove these variables — UUPS storage layout.

    IAkibaMiles  public milesToken;
    IERC20       public usdtToken;

    /// @notice Address authorised to call relayer-only functions.
    address public relayer;

    /// @notice Treasury address that receives USDT house rake on withdrawal.
    address public treasury;

    uint256 public nextCycleId;

    mapping(uint256 => Cycle) private _cycles;

    /// @notice Active cycle id per version. 0 = none.
    mapping(Version => uint256) public activeCycleId;

    // ── Economics (owner-configurable) ───────────────────────────────

    /// Miles entry fee (18-dec), e.g. 10e18 = 10 Miles.
    uint256 public milesEntryFee;
    /// Miles pot seed per new cycle (18-dec).
    uint256 public milesPotSeed;
    /// Miles pot cap (18-dec).
    uint256 public milesPotCap;

    /// USDT entry fee (6-dec), e.g. 100_000 = $0.10.
    uint256 public usdtEntryFee;
    /// USDT pot seed (6-dec), e.g. 2_000_000 = $2.00.
    uint256 public usdtPotSeed;
    /// USDT pot cap (6-dec), e.g. 50_000_000 = $50.00.
    uint256 public usdtPotCap;
    /// House rake on USDT entries, in basis points (5000 = 50%).
    uint256 public usdtHouseRakeBps;

    // ── USDT Accounting (appended for upgrade safety) ─────────────────
    // Invariant: usdtToken.balanceOf(this) >= usdtReservedPot + usdtHouseWithdrawable

    /// @notice Sum of all active USDT pot balances — the minimum the contract
    ///         must hold to honour pending winners.
    uint256 public usdtReservedPot;

    /// @notice USDT safely withdrawable by the house (rake + cap overflow).
    uint256 public usdtHouseWithdrawable;

    // ── Events ───────────────────────────────────────────────────────

    /// @notice Emitted when a new cycle is opened with a commitment.
    ///         Historical `CycleOpened` events from before the upgrade will not
    ///         carry the commitment field (reads as zero).
    event CycleOpened(
        uint256 indexed cycleId,
        Version version,
        uint256 potSeed,
        uint64 expiresAt,
        bytes32 secretCommitment
    );
    event EntryRecorded(uint256 indexed cycleId, address indexed player, uint256 entryAmount, uint256 newPotBalance);
    event CycleCracked(uint256 indexed cycleId, address indexed winner, uint256 payout, uint256 guesses);
    event CycleExpired(uint256 indexed cycleId, Version version, uint256 potBalance);
    event HouseWithdrawn(uint256 amount, address indexed to);
    event RelayerUpdated(address indexed relayer);
    event TreasuryUpdated(address indexed treasury);
    /// @notice Emitted when a USDT entry's pot contribution is clipped by the pot cap.
    event USDTPotCapOverflow(uint256 indexed cycleId, uint256 overflow);

    // ── Errors ───────────────────────────────────────────────────────

    error NotRelayer();
    error NoCycleActive(Version version);
    error CycleNotActive(uint256 cycleId);
    error CycleAlreadyActive(Version version);
    error CycleNotExpired(uint256 cycleId);
    error ZeroAddress();
    error InsufficientMilesBalance();
    error InvalidVersion();
    /// @notice withdrawHouse requested more than the safely withdrawable amount.
    error WithdrawExceedsHouseBalance(uint256 requested, uint256 available);
    /// @notice rescueERC20 may not be used to remove USDT from the contract.
    error USDTRescueBlocked();
    /// @notice recordEntry is disabled for the USDT version; use enterGame().
    error USDTRecordEntryBlocked();
    /// @notice The two-argument openCycle is deprecated; pass a secretCommitment.
    error CommitmentRequired();

    // ── Modifiers ────────────────────────────────────────────────────

    modifier onlyRelayer() {
        if (msg.sender != relayer && msg.sender != owner()) revert NotRelayer();
        _;
    }

    // ── Initializer ──────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _milesToken,
        address _usdtToken,
        address _relayer,
        address _treasury
    ) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        if (_milesToken == address(0) || _usdtToken == address(0) ||
            _relayer == address(0) || _treasury == address(0)) revert ZeroAddress();

        milesToken   = IAkibaMiles(_milesToken);
        usdtToken    = IERC20(_usdtToken);
        relayer      = _relayer;
        treasury     = _treasury;
        nextCycleId  = 1;

        // Default economics — owner can reconfigure before launch
        milesEntryFee    = 10e18;
        milesPotSeed     = 200e18;
        milesPotCap      = 10_000e18;

        usdtEntryFee     = 100_000;       // $0.10
        usdtPotSeed      = 2_000_000;     // $2.00
        usdtPotCap       = 50_000_000;    // $50.00
        usdtHouseRakeBps = 5_000;         // 50%
    }

    // ── Relayer: cycle lifecycle ──────────────────────────────────────

    /**
     * @notice Deprecated. Reverts with CommitmentRequired().
     *         Use openCycle(version, expiresAt, secretCommitment) instead.
     *         Preserved so ABIs that only see the old signature get a clear error
     *         rather than a silent no-op or wrong selector match.
     */
    function openCycle(Version /* version */, uint64 /* expiresAt */) external pure {
        revert CommitmentRequired();
    }

    /**
     * @notice Open a new cycle with a fairness commitment.
     *
     *         The `secretCommitment` must be nonzero and is computed server-side as:
     *           keccak256(abi.encodePacked(
     *             "CRACKPOT_SECRET_V1", chainid, address(this), uint8(version),
     *             expiresAt, salt (bytes32), codeBytes (bytes4)
     *           ))
     *         After the cycle ends the server publishes the preimage so players
     *         can independently verify the secret was fixed before entries started.
     *
     *         MILES: contract mints the seed directly to itself (pot accounting).
     *         USDT:  the contract must already hold enough free USDT
     *                (balance minus already-reserved and house-withdrawable amounts)
     *                to cover usdtPotSeed. usdtReservedPot is incremented by usdtPotSeed.
     *
     * @param version           0 = MILES, 1 = USDT
     * @param expiresAt         Unix timestamp when this cycle expires.
     * @param secretCommitment  keccak256 precommitment of the secret code (must be nonzero).
     */
    function openCycle(
        Version version,
        uint64  expiresAt,
        bytes32 secretCommitment
    ) external onlyRelayer nonReentrant {
        require(secretCommitment != bytes32(0), "CrackPot: zero commitment");
        if (activeCycleId[version] != 0) revert CycleAlreadyActive(version);
        require(expiresAt > block.timestamp, "CrackPot: expiry in the past");

        uint256 cycleId = nextCycleId++;
        Cycle storage c = _cycles[cycleId];
        c.id               = cycleId;
        c.version          = version;
        c.status           = CycleStatus.ACTIVE;
        c.openedAt         = uint64(block.timestamp);
        c.expiresAt        = expiresAt;
        c.secretCommitment = secretCommitment;

        if (version == Version.MILES) {
            c.potBalance = milesPotSeed;
            c.potCap     = milesPotCap;
            c.seedAmount = milesPotSeed;
            // Seed is purely accounting — Miles are minted on payout, not held.
        } else {
            c.potBalance = usdtPotSeed;
            c.potCap     = usdtPotCap;
            c.seedAmount = usdtPotSeed;
            // Require enough free USDT (excluding already reserved and house-claimable amounts).
            uint256 freeBal = usdtToken.balanceOf(address(this)) - usdtReservedPot - usdtHouseWithdrawable;
            require(freeBal >= usdtPotSeed, "CrackPot: insufficient free USDT for seed");
            usdtReservedPot += usdtPotSeed;
        }

        activeCycleId[version] = cycleId;
        emit CycleOpened(cycleId, version, c.potBalance, expiresAt, secretCommitment);
    }

    /**
     * @notice Player calls this directly to enter the active cycle.
     *
     *   Miles version: burns milesEntryFee from msg.sender's wallet on-chain,
     *                  credits the pot. No server involvement needed for payment.
     *
     *   USDT version:  pulls usdtEntryFee via transferFrom (player must approve
     *                  this contract first). Rake goes to usdtHouseWithdrawable.
     *                  Only the non-overflow pot contribution is added to the pot
     *                  and usdtReservedPot. Any overflow above potCap is routed to
     *                  usdtHouseWithdrawable and emits USDTPotCapOverflow.
     *
     * The server listens for EntryRecorded, then opens a 2-minute attempt session.
     */
    function enterGame(Version version) external nonReentrant {
        uint256 cycleId = activeCycleId[version];
        if (cycleId == 0) revert NoCycleActive(version);
        Cycle storage c = _cycles[cycleId];
        if (c.status != CycleStatus.ACTIVE) revert CycleNotActive(cycleId);
        require(block.timestamp < c.expiresAt, "CrackPot: cycle expired");

        uint256 entryAmount;

        if (version == Version.MILES) {
            entryAmount = milesEntryFee;
            milesToken.burn(msg.sender, entryAmount);
            uint256 newBal = c.potBalance + entryAmount;
            c.potBalance = newBal > c.potCap ? c.potCap : newBal;
        } else {
            entryAmount = usdtEntryFee;
            usdtToken.safeTransferFrom(msg.sender, address(this), entryAmount);

            uint256 rake   = (entryAmount * usdtHouseRakeBps) / 10_000;
            uint256 toPot  = entryAmount - rake;
            c.houseAccrued         += rake;
            usdtHouseWithdrawable  += rake;

            // Cap the pot contribution; route overflow to house.
            uint256 space      = c.potCap - c.potBalance;
            uint256 potContrib = toPot > space ? space : toPot;
            uint256 overflow   = toPot - potContrib;

            c.potBalance    += potContrib;
            usdtReservedPot += potContrib;

            if (overflow > 0) {
                usdtHouseWithdrawable += overflow;
                emit USDTPotCapOverflow(cycleId, overflow);
            }
        }

        emit EntryRecorded(cycleId, msg.sender, entryAmount, c.potBalance);
    }

    /**
     * @notice Relayer-only accounting sync for Miles entries recorded off-chain.
     *         USDT version is permanently disabled here — all USDT entries must
     *         come through enterGame() so funds are actually collected on-chain.
     */
    function recordEntry(Version version, address player) external onlyRelayer {
        if (version == Version.USDT) revert USDTRecordEntryBlocked();

        uint256 cycleId = activeCycleId[version];
        if (cycleId == 0) revert NoCycleActive(version);
        Cycle storage c = _cycles[cycleId];
        if (c.status != CycleStatus.ACTIVE) revert CycleNotActive(cycleId);
        require(block.timestamp < c.expiresAt, "CrackPot: cycle expired");

        uint256 entryAmount = milesEntryFee;
        uint256 newBal = c.potBalance + entryAmount;
        c.potBalance = newBal > c.potCap ? c.potCap : newBal;
        emit EntryRecorded(cycleId, player, entryAmount, c.potBalance);
    }

    /**
     * @notice Declare a winner. Pays out the full pot to the winner.
     *         MILES: mints potBalance Miles to winner.
     *         USDT:  decrements usdtReservedPot then transfers potBalance USDT
     *                (checks-effects-interactions order preserved).
     */
    function declareWinner(
        Version version,
        address winner,
        uint256 guesses
    ) external onlyRelayer nonReentrant {
        if (winner == address(0)) revert ZeroAddress();
        uint256 cycleId = activeCycleId[version];
        if (cycleId == 0) revert NoCycleActive(version);
        Cycle storage c = _cycles[cycleId];
        if (c.status != CycleStatus.ACTIVE) revert CycleNotActive(cycleId);

        uint256 payout = c.potBalance;
        c.status        = CycleStatus.CRACKED;
        c.winner        = winner;
        c.winnerGuesses = guesses;
        c.potBalance    = 0;
        activeCycleId[version] = 0;

        if (version == Version.MILES) {
            milesToken.mint(winner, payout);
        } else {
            // Effects before interaction (CEI).
            usdtReservedPot -= payout;
            usdtToken.safeTransfer(winner, payout);
        }

        emit CycleCracked(cycleId, winner, payout, guesses);
    }

    /**
     * @notice Expire a cycle that has passed its timer with no winner.
     *         MILES: pot is simply retired (accounting reset).
     *         USDT:  usdtReservedPot is decremented by the dead pot. The USDT
     *                stays in the contract as unreserved seed float for future
     *                cycles — it is NOT credited to usdtHouseWithdrawable.
     */
    function expireCycle(Version version) external onlyRelayer nonReentrant {
        uint256 cycleId = activeCycleId[version];
        if (cycleId == 0) revert NoCycleActive(version);
        Cycle storage c = _cycles[cycleId];
        if (c.status != CycleStatus.ACTIVE) revert CycleNotActive(cycleId);
        require(block.timestamp >= c.expiresAt, "CrackPot: cycle not expired yet");

        uint256 deadPot  = c.potBalance;
        c.status         = CycleStatus.DEAD;
        c.potBalance     = 0;
        activeCycleId[version] = 0;

        if (version == Version.USDT) {
            // Release the reservation; funds remain in contract as seed float.
            usdtReservedPot -= deadPot;
        }

        emit CycleExpired(cycleId, version, deadPot);
    }

    // ── House revenue ─────────────────────────────────────────────────

    /**
     * @notice Withdraw accumulated USDT house rake to the treasury.
     *         Amount must not exceed usdtHouseWithdrawable to ensure reserved
     *         pot funds are never touched.
     */
    function withdrawHouse(uint256 amount) external onlyRelayer nonReentrant {
        require(amount > 0, "CrackPot: zero amount");
        if (amount > usdtHouseWithdrawable)
            revert WithdrawExceedsHouseBalance(amount, usdtHouseWithdrawable);
        // Effects before interaction.
        usdtHouseWithdrawable -= amount;
        usdtToken.safeTransfer(treasury, amount);
        emit HouseWithdrawn(amount, treasury);
    }

    // ── Views ─────────────────────────────────────────────────────────

    function getCycle(uint256 cycleId) external view returns (Cycle memory) {
        return _cycles[cycleId];
    }

    function getActiveCycle(Version version) external view returns (Cycle memory) {
        uint256 cycleId = activeCycleId[version];
        require(cycleId != 0, "CrackPot: no active cycle");
        return _cycles[cycleId];
    }

    function potBalance(Version version) external view returns (uint256) {
        uint256 cycleId = activeCycleId[version];
        if (cycleId == 0) return 0;
        return _cycles[cycleId].potBalance;
    }

    /**
     * @notice Returns a snapshot of the USDT accounting state.
     *         Reverts (underflow) if the invariant balance >= reserved + house is broken.
     */
    function usdtAccounting() external view returns (
        uint256 balance,
        uint256 reservedPot,
        uint256 houseWithdrawable,
        uint256 freeBalance
    ) {
        balance           = usdtToken.balanceOf(address(this));
        reservedPot       = usdtReservedPot;
        houseWithdrawable = usdtHouseWithdrawable;
        freeBalance       = balance - reservedPot - houseWithdrawable;
    }

    // ── Owner config ──────────────────────────────────────────────────

    function setRelayer(address _relayer) external onlyOwner {
        if (_relayer == address(0)) revert ZeroAddress();
        relayer = _relayer;
        emit RelayerUpdated(_relayer);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setMilesEconomics(
        uint256 _entryFee,
        uint256 _potSeed,
        uint256 _potCap
    ) external onlyOwner {
        require(_potSeed <= _potCap, "CrackPot: seed > cap");
        milesEntryFee = _entryFee;
        milesPotSeed  = _potSeed;
        milesPotCap   = _potCap;
    }

    function setUsdtEconomics(
        uint256 _entryFee,
        uint256 _potSeed,
        uint256 _potCap,
        uint256 _houseRakeBps
    ) external onlyOwner {
        require(_potSeed <= _potCap, "CrackPot: seed > cap");
        require(_houseRakeBps <= 10_000, "CrackPot: rake > 100%");
        usdtEntryFee     = _entryFee;
        usdtPotSeed      = _potSeed;
        usdtPotCap       = _potCap;
        usdtHouseRakeBps = _houseRakeBps;
    }

    /**
     * @notice Recover stuck ERC-20 tokens (never USDT — use withdrawHouse instead).
     */
    function rescueERC20(address token, uint256 amount, address to) external onlyOwner {
        if (token == address(usdtToken)) revert USDTRescueBlocked();
        IERC20(token).safeTransfer(to, amount);
    }

    // ── UUPS ──────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
