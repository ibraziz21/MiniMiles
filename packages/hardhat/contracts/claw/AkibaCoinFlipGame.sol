// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable}             from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable}           from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable}        from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable}       from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {IClawRng}                  from "./IClawRng.sol";
import {IMiniPoints}               from "../MiniPoints.sol";

/// @title AkibaCoinFlipGame
/// @notice Single-player coin flip game using AkibaMiles as stake.
///
///         Flow:
///           flip(choice, stake)    — burn stake, request randomness, open session
///           settle(sessionId)      — permissionless; resolves once RNG is ready
///           claim(sessionId)       — player claims payout on a win
///
///         House edge: houseEdgeBps (default 500 = 5%).
///         Win:  player receives stake * 2 * (10_000 - houseEdgeBps) / 10_000 minted Miles.
///         Loss: stake already burned on flip; nothing additional happens.
///
///         One active session per address enforced at flip time.
///         Settlement is permissionless; a backend keeper monitors pending sessions.
contract AkibaCoinFlipGame is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    /* ─────────────────── Constants ─────────────────────────────────────────── */

    uint16 public constant MAX_HOUSE_EDGE_BPS = 2000; // 20% cap
    uint8  public constant HEADS = 0;
    uint8  public constant TAILS = 1;

    /* ─────────────────── Enums ──────────────────────────────────────────────── */

    enum FlipStatus {
        None,     // 0 — slot unused
        Pending,  // 1 — randomness requested
        Settled,  // 2 — outcome known, awaiting claim
        Claimed,  // 3 — won and claimed (or loss acknowledged)
        Refunded  // 4 — emergency refund
    }

    /* ─────────────────── Structs ────────────────────────────────────────────── */

    struct FlipSession {
        uint256    sessionId;
        address    player;
        uint8      choice;     // HEADS (0) or TAILS (1)
        uint256    stake;      // Miles burned on flip (18 dec)
        uint8      outcome;    // HEADS or TAILS once settled; 255 = pending
        bool       playerWon;
        FlipStatus status;
        uint64     createdAt;
        uint64     settledAt;
    }

    /* ─────────────────── State ──────────────────────────────────────────────── */

    IClawRng    public rng;
    IMiniPoints public miles;
    uint16      public houseEdgeBps;

    uint256 public nextSessionId;

    mapping(uint256 => FlipSession) internal _sessions;
    mapping(address => uint256)     public   activeSession; // 0 = none

    /* ─────────────────── Events ─────────────────────────────────────────────── */

    event FlipCommitted(
        uint256 indexed sessionId,
        address indexed player,
        uint8           choice,
        uint256         stake
    );

    event FlipSettled(
        uint256 indexed sessionId,
        address indexed player,
        uint8           outcome,
        bool            playerWon,
        uint256         payout
    );

    event FlipClaimed(
        uint256 indexed sessionId,
        address indexed player,
        uint256         payout
    );

    event EmergencyRefund(uint256 indexed sessionId, address indexed player);

    /* ─────────────────── Errors ─────────────────────────────────────────────── */

    error InvalidChoice(uint8 choice);
    error InvalidStake(uint256 stake);
    error ActiveSessionExists(address player, uint256 sessionId);
    error SessionNotFound(uint256 sessionId);
    error WrongStatus(FlipStatus current);
    error RandomnessNotReady(uint256 sessionId);
    error NotPlayer(address caller);
    error HouseEdgeTooHigh(uint16 bps);
    error InsufficientCeloReserve(uint256 required, uint256 available);

    /* ─────────────────── Initializer ────────────────────────────────────────── */

    function initialize(
        address _miles,
        address _rng,
        uint16  _houseEdgeBps,
        address _owner
    ) external initializer {
        require(_miles  != address(0), "zero miles");
        require(_rng    != address(0), "zero rng");
        require(_owner  != address(0), "zero owner");
        if (_houseEdgeBps > MAX_HOUSE_EDGE_BPS) revert HouseEdgeTooHigh(_houseEdgeBps);

        __Ownable_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        miles        = IMiniPoints(_miles);
        rng          = IClawRng(_rng);
        houseEdgeBps = _houseEdgeBps;
        nextSessionId = 1;

        _transferOwnership(_owner);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /* ─────────────────── User: flip ─────────────────────────────────────────── */

    /// @notice Wager Miles on a coin flip.
    /// @param  choice  HEADS (0) or TAILS (1)
    /// @param  stake   Miles to wager (must be one of the allowed tiers: 50/100/250/500 × 1e18)
    function flip(uint8 choice, uint256 stake)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 sessionId)
    {
        if (choice != HEADS && choice != TAILS) revert InvalidChoice(choice);
        if (!_isValidStake(stake)) revert InvalidStake(stake);

        // One active session per player
        uint256 existing = activeSession[msg.sender];
        if (existing != 0) {
            FlipSession storage ex = _sessions[existing];
            if (ex.status == FlipStatus.Pending || ex.status == FlipStatus.Settled) {
                revert ActiveSessionExists(msg.sender, existing);
            }
        }

        // Burn the stake
        miles.burn(msg.sender, stake);

        // Create session
        sessionId = nextSessionId++;
        _sessions[sessionId] = FlipSession({
            sessionId: sessionId,
            player:    msg.sender,
            choice:    choice,
            stake:     stake,
            outcome:   255,        // pending sentinel
            playerWon: false,
            status:    FlipStatus.Pending,
            createdAt: uint64(block.timestamp),
            settledAt: 0
        });
        activeSession[msg.sender] = sessionId;

        // Request randomness (contract's CELO reserve covers fee)
        uint256 fee = rng.estimateFee();
        if (address(this).balance < fee)
            revert InsufficientCeloReserve(fee, address(this).balance);
        rng.requestRandom{value: fee}(sessionId);

        emit FlipCommitted(sessionId, msg.sender, choice, stake);
    }

    /* ─────────────────── Permissionless: settle ─────────────────────────────── */

    /// @notice Settle a pending flip once randomness is available.
    ///         Callable by anyone (relayer, player, or third party).
    function settle(uint256 sessionId) external nonReentrant {
        FlipSession storage session = _sessions[sessionId];
        if (session.sessionId == 0)                 revert SessionNotFound(sessionId);
        if (session.status != FlipStatus.Pending)   revert WrongStatus(session.status);
        if (!rng.isReady(sessionId))                revert RandomnessNotReady(sessionId);

        // getRandom(sessionId, 2) → 0 or 1
        uint8 outcome   = uint8(rng.getRandom(sessionId, 2));
        bool  playerWon = (outcome == session.choice);

        uint256 payout = 0;
        if (playerWon) {
            payout = (session.stake * 2 * (10_000 - houseEdgeBps)) / 10_000;
        }

        session.outcome   = outcome;
        session.playerWon = playerWon;
        session.status    = FlipStatus.Settled;
        session.settledAt = uint64(block.timestamp);

        emit FlipSettled(sessionId, session.player, outcome, playerWon, payout);
    }

    /* ─────────────────── User: claim ────────────────────────────────────────── */

    /// @notice Claim the payout for a settled session.
    ///         - Win:  mints the payout to the player.
    ///         - Loss: no-op (stake already burned; clears active session slot).
    function claim(uint256 sessionId) external nonReentrant whenNotPaused {
        FlipSession storage session = _sessions[sessionId];
        if (session.sessionId == 0)               revert SessionNotFound(sessionId);
        if (session.status != FlipStatus.Settled) revert WrongStatus(session.status);
        if (session.player != msg.sender)         revert NotPlayer(msg.sender);

        session.status = FlipStatus.Claimed;
        activeSession[msg.sender] = 0;

        uint256 payout = 0;
        if (session.playerWon) {
            payout = (session.stake * 2 * (10_000 - houseEdgeBps)) / 10_000;
            miles.mint(session.player, payout);
        }

        emit FlipClaimed(sessionId, session.player, payout);
    }

    /* ─────────────────── Views ──────────────────────────────────────────────── */

    function getSession(uint256 sessionId) external view returns (FlipSession memory) {
        return _sessions[sessionId];
    }

    function canSettle(uint256 sessionId) external view returns (bool) {
        FlipSession storage s = _sessions[sessionId];
        return s.sessionId != 0
            && s.status == FlipStatus.Pending
            && rng.isReady(sessionId);
    }

    function computePayout(uint256 stake) external view returns (uint256) {
        return (stake * 2 * (10_000 - houseEdgeBps)) / 10_000;
    }

    /* ─────────────────── Admin ──────────────────────────────────────────────── */

    function setRng(address _rng) external onlyOwner {
        require(_rng != address(0), "zero addr");
        rng = IClawRng(_rng);
    }

    function setHouseEdge(uint16 _bps) external onlyOwner {
        if (_bps > MAX_HOUSE_EDGE_BPS) revert HouseEdgeTooHigh(_bps);
        houseEdgeBps = _bps;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Accept CELO top-ups for the RNG fee reserve.
    receive() external payable {}

    /// @notice Withdraw CELO from the reserve.
    function withdrawCelo(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero addr");
        require(address(this).balance >= amount, "insufficient balance");
        to.transfer(amount);
    }

    /// @notice Emergency refund for a session stuck in Pending beyond a reasonable timeout.
    function emergencyRefund(uint256 sessionId) external onlyOwner nonReentrant {
        FlipSession storage session = _sessions[sessionId];
        if (session.sessionId == 0)               revert SessionNotFound(sessionId);
        if (session.status != FlipStatus.Pending) revert WrongStatus(session.status);

        session.status = FlipStatus.Refunded;
        activeSession[session.player] = 0;

        // Refund stake
        miles.mint(session.player, session.stake);

        emit EmergencyRefund(sessionId, session.player);
    }

    /* ─────────────────── Internal ───────────────────────────────────────────── */

    /// @dev Allowed stake tiers: 50 / 100 / 250 / 500 Miles (18 decimals).
    function _isValidStake(uint256 stake) internal pure returns (bool) {
        return stake == 50e18
            || stake == 100e18
            || stake == 250e18
            || stake == 500e18;
    }

    /* ─────────────────── Storage Gap ────────────────────────────────────────── */

    uint256[48] private __gap;
}
