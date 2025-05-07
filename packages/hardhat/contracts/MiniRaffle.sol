// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MiniPoints.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "witnet-solidity-bridge/contracts/interfaces/IWitnetRandomness.sol";

/**
 * @title Minimiles Raffle – Witnet‑powered randomness version for Celo
 * @dev Works on Celo Mainnet & Alfajores using the canonical WitnetRandomness
 *      contract deployed at 0x77703aE126B971c9946d562F41Dd47071dA00777.
 */
contract MiniRaffle is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────  CONSTANTS & IMMUTABLES  ─────────────────────────
    address public immutable owner;
    IMiniPoints public immutable miniPoints;
    IWitnetRandomness public constant RNG =
        IWitnetRandomness(0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB);
    IERC20 public immutable cUSD;
    IERC20 public immutable cKES;

    // ───────────────────────────────  STRUCTS  ──────────────────────────────────
    struct RaffleRound {
        uint256 id;
        uint256 startTime;
        uint256 endTime;
        uint32 maxTickets;
        IERC20 rewardToken;
        uint256 rewardPool;
        address beneficiary;
        uint256 ticketCostPoints;
        address[] participants;
        bool isActive;
        bool winnersSelected;
        mapping(address => uint32) tickets; // participant => ticket count
        uint32 totalTickets;
        address[3] winners;           // up to 3 winners stored here
        uint256 randomBlock;         // Witnet randomness beacon block id
    }

    // ─────────────────────────────  STORAGE  ────────────────────────────────────
    uint256 public roundIdCounter;
    mapping(uint256 => RaffleRound) private rounds;

    // ──────────────────────────────  EVENTS  ────────────────────────────────────
    event RoundCreated(
        uint256 indexed roundId,
        uint256 startTime,
        uint256 endTime,
        uint256 rewardPool,
        IERC20 rewardToken,
        uint256 maxTickets,
        address beneficiary,
        uint256 ticketCostPoints
    );
    event ParticipantJoined(uint256 indexed roundId, address indexed participant);
    event RandomnessRequested(uint256 indexed roundId, uint256 witnetBlock);
    event WinnersSelected(uint256 indexed roundId, address[3] winners);

    // ─────────────────────────────  MODIFIERS  ──────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Raffle: not owner");
        _;
    }

    modifier roundExists(uint256 _roundId) {
        require(rounds[_roundId].id != 0, "Raffle: round does not exist");
        _;
    }

    // ─────────────────────────────  CONSTRUCTOR  ────────────────────────────────
    constructor(address _miniPoints, address _cUSD, address _cKES) {
        require(_miniPoints != address(0), "invalid MiniPoints");
        miniPoints = IMiniPoints(_miniPoints);
        cUSD = IERC20(_cUSD);
        cKES = IERC20(_cKES);
        owner = msg.sender;
    }

    // ───────────────────────────  ROUND CREATION  ───────────────────────────────
    function createRaffleRound(
        uint256 _startTime,
        uint256 _duration,
        uint32 _maxTickets,
        IERC20 _token,
        uint256 _rewardPool,
        uint256 _ticketCostPoints,
        address _beneficiary
    ) external onlyOwner {
        require(_duration > 0 && _maxTickets > 0, "Raffle: bad params");
        require(_token == cUSD || _token == cKES, "Raffle: unsupported token");

        // Pull tokens after checks to avoid locking funds on revert
        _token.safeTransferFrom(msg.sender, address(this), _rewardPool);

        roundIdCounter++;
        RaffleRound storage round = rounds[roundIdCounter];
        round.id = roundIdCounter;
        round.startTime = _startTime;
        round.endTime = _startTime + _duration;
        round.maxTickets = _maxTickets;
        round.rewardToken = _token;
        round.rewardPool = _rewardPool;
        round.beneficiary = _beneficiary;
        round.ticketCostPoints = _ticketCostPoints;
        round.isActive = true;

        emit RoundCreated(
            round.id,
            round.startTime,
            round.endTime,
            round.rewardPool,
            round.rewardToken,
            round.maxTickets,
            _beneficiary,
            _ticketCostPoints
        );
    }

    // ────────────────────────────  FUND ROUND  ─────────────────────────────────
    function fundRaffleRound(
        uint256 _roundId,
        uint256 _amount
    ) external onlyOwner roundExists(_roundId) {
        RaffleRound storage round = rounds[_roundId];
        require(round.isActive, "Raffle: inactive round");
        round.rewardToken.safeTransferFrom(msg.sender, address(this), _amount);
        round.rewardPool += _amount;
    }

    // ───────────────────────────  JOIN RAFFLE  ─────────────────────────────────
    function joinRaffle(uint256 _roundId, uint32 _ticketCount)
        external
        roundExists(_roundId)
    {
        RaffleRound storage round = rounds[_roundId];
        require(round.isActive, "Raffle: inactive round");
        require(
            block.timestamp >= round.startTime && block.timestamp <= round.endTime,
            "Raffle: not in timeframe"
        );
        require(
            round.totalTickets + _ticketCount <= round.maxTickets,
            "Raffle: max tickets reached"
        );

        uint256 cost = round.ticketCostPoints * _ticketCount;

        // Validate first, then burn to avoid loss on revert
        require(miniPoints.balanceOf(msg.sender) >= cost, "Raffle: insufficient points");
        miniPoints.burn(msg.sender, cost);

        if (round.tickets[msg.sender] == 0) {
            round.participants.push(msg.sender);
        }
        round.tickets[msg.sender] += _ticketCount;
        round.totalTickets += _ticketCount;

        emit ParticipantJoined(_roundId, msg.sender);
    }

    // ────────────────────────  RANDOMNESS REQUEST  ─────────────────────────────
    /**
     * @notice Request Witnet randomness for a round. Anyone can pay the fee.
     * @dev Fee is dynamic; front‑end should query RNG.estimateRandomizeFee.
     */
    function requestRoundRandomness(uint256 _roundId)
        external
        payable
        roundExists(_roundId)
    {
        RaffleRound storage round = rounds[_roundId];
        require(round.randomBlock == 0, "Raffle: randomness already requested");
        round.randomBlock = RNG.randomize{value: msg.value}();
        emit RandomnessRequested(_roundId, round.randomBlock);
    }

    // ───────────────────────────  DRAW WINNERS  ────────────────────────────────
    function drawWinner(uint256 _roundId)
        external
        nonReentrant
        roundExists(_roundId)
    {
        RaffleRound storage round = rounds[_roundId];
        require(round.isActive, "Raffle: inactive round");
        require(!round.winnersSelected, "Raffle: winners picked");
        require(
            block.timestamp > round.endTime || round.totalTickets == round.maxTickets,
            "Raffle: round unfinished"
        );
           require(
        round.participants.length >= 3,
        "Raffle: need at least 3 distinct players"
    );
        require(round.randomBlock != 0, "Raffle: randomness not requested");
        require(RNG.isRandomized(round.randomBlock), "Raffle: randomness pending");

        uint256 firstPrize = (round.rewardPool * 50) / 100;
        uint256 secondPrize = (round.rewardPool * 30) / 100;
        uint256 thirdPrize = round.rewardPool - firstPrize - secondPrize;

        // Helper to sample & remove a winner
        address[3] memory winners;
        uint32 supply = round.totalTickets;

        for (uint8 i = 0; i < 3; i++) {
            uint256 rand = RNG.random(supply, i, round.randomBlock);
            address sel = _selectByIndex(round, rand);
            winners[i] = sel;

            uint32 ticketsOfSel = round.tickets[sel];
            supply -= ticketsOfSel;
            round.tickets[sel] = 0;
        }

        round.rewardToken.safeTransfer(winners[0], firstPrize);
        round.rewardToken.safeTransfer(winners[1], secondPrize);
        round.rewardToken.safeTransfer(winners[2], thirdPrize);

        round.isActive = false;
        round.winnersSelected = true;
        round.winners = [winners[0], winners[1], winners[2]];

        emit WinnersSelected(_roundId, winners);

        // implicit: leftover tickets array can be cleaned in a maintenance tx
    }

    // ───────────────────── INTERNAL UTILS  ──────────────────────────────────────
    function _selectByIndex(RaffleRound storage round, uint256 index) internal view returns (address) {
        uint256 cumulative;
        for (uint256 i = 0; i < round.participants.length; i++) {
            address p = round.participants[i];
            uint256 count = round.tickets[p];
            if (count == 0) continue;
            if (index < cumulative + count) {
                return p;
            }
            cumulative += count;
        }
        revert("Raffle: index overflow");
    }

    // ─────────────────────────────  VIEWS  ──────────────────────────────────────
    function getParticipantCount(uint256 _roundId) external view returns (uint256) {
        return rounds[_roundId].participants.length;
    }

    function getParticipants(uint256 _roundId) external view returns (address[] memory) {
        return rounds[_roundId].participants;
    }

    function getWinners(uint256 _roundId) external view returns (address[3] memory) {
        return rounds[_roundId].winners;
    }
}