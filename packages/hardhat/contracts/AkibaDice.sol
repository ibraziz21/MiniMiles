// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MiniPoints.sol"; // IMiniPoints
import "witnet-solidity-bridge/contracts/interfaces/IWitnetRandomness.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

/// @title Akiba Dice Game
/// @notice 6-player pots. Each player picks a unique number 1-6 for a given tier.
///         When the pot fills, randomness is requested and one number wins the full pot.
contract AkibaDiceGame is UUPSUpgradeable, ReentrancyGuardUpgradeable {
    /* ────────────────────────────────────────────────────────────── */
    /* Types & storage                                                */
    /* ────────────────────────────────────────────────────────────── */

    struct DiceRound {
        uint256 id;             // round id
        uint256 tier;           // entry cost in MiniPoints for this pot (e.g. 10, 20, 30)
        uint8   filledSlots;    // 0–6
        bool    winnerSelected; // true once resolved
        uint8   winningNumber;  // 1–6 when drawn
        uint256 randomBlock;    // Witnet randomization block (kept as-is for now)
        address winner;         // winner address
        // mapping: chosen number => player
        mapping(uint8 => address) playerByNumber;
    }

    /// @notice owner (same pattern as AkibaRaffle)
    address public owner;

    /// @notice Akiba MiniPoints (same token used across the app)
    IMiniPoints public miniPoints;

    /// @notice Witnet Randomness provider (kept as-is for now)
    IWitnetRandomness public constant RNG =
        IWitnetRandomness(0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB);

    /// @notice Next round id to use when creating new pots
    uint256 public nextRoundId;

    /// @notice All dice rounds (id => round)
    mapping(uint256 => DiceRound) private _rounds;

    /// @notice The currently open round per tier (entry cost)
    ///         e.g. activeRoundByTier[10] = roundId
    mapping(uint256 => uint256) public activeRoundByTier;

    /// @notice Allowed tiers (e.g. 10, 20, 30). Only these can be used in joinTier.
    mapping(uint256 => bool) public allowedTier;

    /// @notice Tracks whether an address has already joined a specific round.
    ///         Enforces "one entry per address per round".
    mapping(uint256 => mapping(address => bool)) public hasJoinedRound;

    /* ────────────────────────────────────────────────────────────── */
    /* Events                                                        */
    /* ────────────────────────────────────────────────────────────── */

    event RoundOpened(uint256 indexed roundId, uint256 indexed tier);
    event Joined(
        uint256 indexed roundId,
        uint8 indexed number,
        address indexed player
    );
    event RandomnessRequested(uint256 indexed roundId, uint256 randomBlock);
    event RoundResolved(
        uint256 indexed roundId,
        uint8 indexed winningNumber,
        address indexed winner,
        uint256 payout
    );
    event RoundCancelled(uint256 indexed roundId);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event AllowedTierSet(uint256 indexed tier, bool allowed);

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
    /* Initializer & UUPS                                             */
    /* ────────────────────────────────────────────────────────────── */

    /// @notice Initialize upgradeable contract
    /// @param _miniPoints address of the MiniPoints token
    /// @param _owner      owner (admin) address
    function initialize(address _miniPoints, address _owner) public initializer {
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        require(_miniPoints != address(0), "Dice: invalid MiniPoints");
        require(_owner != address(0), "Dice: invalid owner");

        miniPoints = IMiniPoints(_miniPoints);
        owner = _owner;
        nextRoundId = 1;

        // Default tiers used by Akiba UI (10, 20, 30)
        allowedTier[10] = true;
        allowedTier[20] = true;
        allowedTier[30] = true;

        emit OwnershipTransferred(address(0), _owner);
        emit AllowedTierSet(10, true);
        emit AllowedTierSet(20, true);
        emit AllowedTierSet(30, true);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    /* ────────────────────────────────────────────────────────────── */
    /* Core game logic                                               */
    /* ────────────────────────────────────────────────────────────── */

    /// @notice Join a pot for a given tier by picking a number 1–6.
    ///         If there is no active round for this tier, a new one is opened.
    ///         If the current round is full or already resolved, a new one is opened.
    /// @param tier         Entry cost in MiniPoints (must be an allowed tier)
    /// @param chosenNumber Number between 1 and 6 (inclusive)
  function joinTier(uint256 tier, uint8 chosenNumber) external nonReentrant {
    require(allowedTier[tier], "Dice: tier not allowed");
    require(chosenNumber >= 1 && chosenNumber <= 6, "Dice: bad number");

    // Find or open the active round for this tier
    uint256 roundId = activeRoundByTier[tier];
    DiceRound storage round = _rounds[roundId];

    if (
        roundId == 0 ||
        round.filledSlots == 6 ||
        round.winnerSelected
    ) {
        // open new round
        roundId = nextRoundId++;
        round = _rounds[roundId];
        round.id = roundId;
        round.tier = tier;
        round.filledSlots = 0;
        round.winnerSelected = false;
        round.winningNumber = 0;
        round.randomBlock = 0;
        round.winner = address(0);

        activeRoundByTier[tier] = roundId;
        emit RoundOpened(roundId, tier);
    }

    // Enforce one entry per address per round
    require(
        !hasJoinedRound[roundId][msg.sender],
        "Dice: already joined"
    );

    // Slot must be free
    require(
        round.playerByNumber[chosenNumber] == address(0),
        "Dice: number taken"
    );

    // ✅ Burn the player's entry cost in MiniPoints (matches MiniRaffle)
    miniPoints.burn(msg.sender, tier);

    // Assign the slot
    round.playerByNumber[chosenNumber] = msg.sender;
    round.filledSlots += 1;
    hasJoinedRound[roundId][msg.sender] = true;

    emit Joined(roundId, chosenNumber, msg.sender);
}

    /// @notice Request randomness for a full pot.
    /// @dev Anyone can call this once the pot has 6 players.
    ///      `msg.value` is forwarded to Witnet; any leftover is refunded.
    /// @dev Randomness pattern kept as-is for now.
    function requestRoundRandomness(
        uint256 roundId
    ) external payable nonReentrant roundExists(roundId) {
        DiceRound storage round = _rounds[roundId];
        require(round.filledSlots == 6, "Dice: pot not full");
        require(!round.winnerSelected, "Dice: already resolved");
        require(round.randomBlock == 0, "Dice: randomness requested");

        uint256 usedFee = RNG.randomize{value: msg.value}();
        round.randomBlock = block.number;

        if (usedFee < msg.value) {
            payable(msg.sender).transfer(msg.value - usedFee);
        }

        emit RandomnessRequested(roundId, round.randomBlock);
    }

    /// @notice Draw the winner for a pot once randomness is available,
    ///         and pay out the full pot in MiniPoints.
    /// @dev Randomness pattern kept as-is for now.
    function drawRound(
        uint256 roundId
    ) external nonReentrant roundExists(roundId) {
        DiceRound storage round = _rounds[roundId];
        require(round.filledSlots == 6, "Dice: pot not full");
        require(!round.winnerSelected, "Dice: already resolved");
        require(round.randomBlock != 0, "Dice: randomness not requested");
        require(
            RNG.isRandomized(round.randomBlock),
            "Dice: randomness pending"
        );

        // Draw a number in [0,5], then map to [1,6]
        uint256 pick = RNG.random(6, 0, round.randomBlock);
        uint8 winningNumber = uint8(pick + 1);

        address winner = round.playerByNumber[winningNumber];
        require(winner != address(0), "Dice: empty winner slot");

        uint256 payout = round.tier * 6;

        round.winnerSelected = true;
        round.winningNumber = winningNumber;
        round.winner = winner;

        // Mint the full pot in MiniPoints to winner
        miniPoints.mint(winner, payout);

        emit RoundResolved(roundId, winningNumber, winner, payout);
    }

    /// @notice Owner can cancel an unresolved *not-full* round and refund players in MiniPoints.
    /// @dev Safety valve in case a pot gets stuck / never fills.
    ///      Cannot cancel a full pot or one where randomness has been requested.
    function cancelRound(
        uint256 roundId
    ) external nonReentrant onlyOwner roundExists(roundId) {
        DiceRound storage round = _rounds[roundId];
        require(!round.winnerSelected, "Dice: already resolved");
        require(round.filledSlots < 6, "Dice: full pot");
        require(round.randomBlock == 0, "Dice: randomness requested");

        // Refund each occupied slot and clear hasJoinedRound
        for (uint8 n = 1; n <= 6; n++) {
            address player = round.playerByNumber[n];
            if (player != address(0)) {
                miniPoints.mint(player, round.tier);
                round.playerByNumber[n] = address(0);
                hasJoinedRound[roundId][player] = false;
            }
        }

        round.filledSlots = 0;
        round.winnerSelected = true; // mark as closed to prevent reuse

        emit RoundCancelled(roundId);
    }

    /* ────────────────────────────────────────────────────────────── */
    /* View helpers                                                  */
    /* ────────────────────────────────────────────────────────────── */

    /// @notice Returns basic info about a round (no slot mappings).
    function getRoundInfo(
        uint256 roundId
    )
        external
        view
        roundExists(roundId)
        returns (
            uint256 tier,
            uint8 filledSlots,
            bool winnerSelected,
            uint8 winningNumber,
            uint256 randomBlock,
            address winner
        )
    {
        DiceRound storage round = _rounds[roundId];
        return (
            round.tier,
            round.filledSlots,
            round.winnerSelected,
            round.winningNumber,
            round.randomBlock,
            round.winner
        );
    }

    /// @notice Returns the player who picked a given number in a round.
    function getRoundSlotPlayer(
        uint256 roundId,
        uint8 number
    ) external view roundExists(roundId) returns (address) {
        require(number >= 1 && number <= 6, "Dice: bad number");
        return _rounds[roundId].playerByNumber[number];
    }

    /// @notice Returns the active round id for a given tier (0 if none yet).
    function getActiveRoundId(uint256 tier) external view returns (uint256) {
        return activeRoundByTier[tier];
    }

    /* ────────────────────────────────────────────────────────────── */
    /* Admin                                                         */
    /* ────────────────────────────────────────────────────────────── */

    /// @notice Set whether a tier is allowed for new rounds.
    ///         E.g. keep 10/20/30, or add/remove others.
    function setAllowedTier(uint256 tier, bool allowed) external onlyOwner {
        allowedTier[tier] = allowed;
        emit AllowedTierSet(tier, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Owner: zero addr");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    uint256[48] private __gap; // adjusted for new storage vars
}
