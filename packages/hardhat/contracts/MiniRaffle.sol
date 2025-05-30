// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MiniPoints.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "witnet-solidity-bridge/contracts/interfaces/IWitnetRandomness.sol";

/**
 * @title Minimiles Raffle – Witnet‑powered randomness version for Celo
 */
contract MiniRaffle is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable owner;
    IMiniPoints public immutable miniPoints;
    IWitnetRandomness public constant RNG =
        IWitnetRandomness(0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB);
    IERC20 public immutable cUSD;
    IERC20 public immutable cKES;
    IERC20 public immutable miles;

    struct RaffleRound {
        uint256 id;
        uint256 startTime;
        uint256 endTime;
        uint32 maxTickets;
        IERC20 rewardToken;
        uint256 rewardPool;
        uint256 ticketCostPoints;
        address[] participants;
        bool isActive;
        bool winnerSelected;
        mapping(address => uint32) tickets;
        uint32 totalTickets;
        address winner;
        uint256 randomBlock;
    }

    uint256 public roundIdCounter;
    mapping(uint256 => RaffleRound) private rounds;

    event RoundCreated(
        uint256 indexed roundId,
        uint256 startTime,
        uint256 endTime,
        uint256 rewardPool,
        IERC20 rewardToken,
        uint256 maxTickets,
        uint256 ticketCostPoints
    );
    event ParticipantJoined(
        uint256 indexed roundId,
        address indexed participant
    );
    event RandomnessRequested(uint256 indexed roundId, uint256 witnetBlock);
    event WinnerSelected(uint256 indexed roundId, address winner);
    event RaffleClosed(uint256 indexed roundId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Raffle: not owner");
        _;
    }
    modifier roundExists(uint256 _roundId) {
        require(rounds[_roundId].id != 0, "Raffle: round does not exist");
        _;
    }

    constructor(address _miniPoints, address _cUSD) {
        require(_miniPoints != address(0), "invalid MiniPoints");
        miniPoints = IMiniPoints(_miniPoints);
        miles = IERC20(_miniPoints);
        cUSD = IERC20(_cUSD);
        // cKES = IERC20(_cKES);
        owner = msg.sender;
    }

    function createRaffleRound(
        uint256 _startTime,
        uint256 _duration,
        uint32 _maxTickets,
        IERC20 _token,
        uint256 _rewardPool,
        uint256 _ticketCostPoints
    ) external onlyOwner {
        require(_duration > 0 && _maxTickets > 0, "Raffle: bad params");
        require(_token == cUSD || _token == cKES || _token == miles, "Raffle: unsupported token");

        _token.safeTransferFrom(msg.sender, address(this), _rewardPool);
        roundIdCounter++;
        RaffleRound storage r = rounds[roundIdCounter];
        r.id = roundIdCounter;
        r.startTime = _startTime;
        r.endTime = _startTime + _duration;
        r.maxTickets = _maxTickets;
        r.rewardToken = _token;
        r.rewardPool = _rewardPool;
        r.ticketCostPoints = _ticketCostPoints;
        r.isActive = true;

        emit RoundCreated(
            r.id,
            r.startTime,
            r.endTime,
            r.rewardPool,
            r.rewardToken,
            r.maxTickets,
            r.ticketCostPoints
        );
    }

    function joinRaffle(
        uint256 _roundId,
        uint32 _ticketCount
    ) external roundExists(_roundId) {
        RaffleRound storage r = rounds[_roundId];
        require(r.isActive, "Raffle: inactive round");
        require(
            block.timestamp >= r.startTime && block.timestamp <= r.endTime,
            "Raffle: not in timeframe"
        );
        require(
            r.totalTickets + _ticketCount <= r.maxTickets,
            "Raffle: max tickets reached"
        );

        uint256 cost = r.ticketCostPoints * _ticketCount;
        require(
            miniPoints.balanceOf(msg.sender) >= cost,
            "Raffle: insufficient points"
        );
        miniPoints.burn(msg.sender, cost);

        if (r.tickets[msg.sender] == 0) {
            r.participants.push(msg.sender);
        }
        r.tickets[msg.sender] += _ticketCount;
        r.totalTickets += _ticketCount;

        emit ParticipantJoined(_roundId, msg.sender);
    }

    function requestRoundRandomness(
        uint256 _roundId
    ) external payable roundExists(_roundId) {
        RaffleRound storage r = rounds[_roundId];
        require(r.randomBlock == 0, "Raffle: randomness requested");
        uint256 usedFee = RNG.randomize{value: msg.value}();
        r.randomBlock = block.number;
        if (usedFee < msg.value) {
            payable(msg.sender).transfer(msg.value - usedFee);
        }
        emit RandomnessRequested(_roundId, r.randomBlock);
    }

    function drawWinner(
        uint256 _roundId
    ) external nonReentrant roundExists(_roundId) {
        RaffleRound storage r = rounds[_roundId];
        require(r.isActive, "Raffle: inactive round");
        require(!r.winnerSelected, "Raffle: already drawn");
        require(
            block.timestamp > r.endTime || r.totalTickets == r.maxTickets,
            "Raffle: unfinished"
        );
        uint256 threshold = (uint256(r.maxTickets) * 60) / 100;
        require(r.totalTickets >= threshold, "Raffle: threshold not met");
        require(
            r.randomBlock != 0 && RNG.isRandomized(r.randomBlock),
            "Raffle: randomness pending"
        );

        uint256 pick = RNG.random(r.totalTickets, 0, r.randomBlock);
        r.winner = _selectByIndex(r, pick);
        r.rewardToken.safeTransfer(r.winner, r.rewardPool);
        r.isActive = false;
        r.winnerSelected = true;

        emit WinnerSelected(_roundId, r.winner);
    }

    /// @notice Close an under-subscribed raffle after its endTime and refund all MiniPoints.
    /// @dev Anyone can call once time has passed; requires <60% tickets sold.
    function closeRaffle(
        uint256 _roundId
    ) external nonReentrant roundExists(_roundId) {
        RaffleRound storage round = rounds[_roundId];
        require(round.isActive, "Raffle: inactive");
        require(block.timestamp > round.endTime, "Raffle: not ended");

        // must be below 60% of maxTickets
        require(
            round.totalTickets * 100 < uint256(round.maxTickets) * 60,
            "Raffle: threshold met"
        );

        // refund each participant their spent points
        for (uint256 i = 0; i < round.participants.length; i++) {
            address player = round.participants[i];
            uint32 bought = round.tickets[player];
            if (bought > 0) {
                uint256 refundAmount = uint256(bought) * round.ticketCostPoints;
                // mint the same amount back
                miniPoints.mint(player, refundAmount);
                // zero out tickets to avoid re-entry
                round.tickets[player] = 0;
            }
        }

        // mark closed
        round.isActive = false;

        emit RaffleClosed(_roundId);
    }

    function _selectByIndex(
        RaffleRound storage r,
        uint256 index
    ) internal view returns (address) {
        uint256 cum;
        for (uint i; i < r.participants.length; i++) {
            address p = r.participants[i];
            uint32 t = r.tickets[p];
            if (index < cum + t) return p;
            cum += t;
        }
        revert("Raffle: index overflow");
    }

    function getActiveRound(
        uint256 _roundId
    )
        external
        view
        returns (
            uint256 roundId,
            uint256 startTime,
            uint256 endTime,
            uint32 maxTickets,
            uint32 totalTickets,
            IERC20 rewardToken,
            uint256 rewardPool,
            uint256 ticketCostPoints,
            bool winnerSelected
        )
    {
        RaffleRound storage r = rounds[_roundId];
        require(r.isActive, "Raffle: inactive");
        return (
            _roundId,
            r.startTime,
            r.endTime,
            r.maxTickets,
            r.totalTickets,
            r.rewardToken,
            r.rewardPool,
            r.ticketCostPoints,
            r.winnerSelected
        );
    }
}
