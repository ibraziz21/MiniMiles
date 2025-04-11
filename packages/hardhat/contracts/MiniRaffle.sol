// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.17;
import "./MiniPoints.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Raffle {
    // ------------------------- STRUCTS -------------------------
    struct RaffleRound {
        uint256 id;
        uint256 startTime; // block timestamp when this round starts
        uint256 endTime; // block timestamp when this round ends
        uint256 maxTickets;
        IERC20 rewardToken; // cap on number of participants
        uint256 rewardPool; // amount of tokens for winner
        address beneficiary; // potential beneficiary or partner
        uint256 ticketCostPoints; // cost in "MiniPoints" per participant
        address[] participants; // addresses who joined
        bool isActive; // indicates if raffle is still active
        bool winnersSelected; // to prevent repeated draws
        // New fields:
        mapping(address => uint256) tickets;
        uint256 totalTickets;
        address[] winners;
    }

    // ------------------------- STATE VARIABLES -------------------------
    address public owner;
    IMiniPoints public miniPoints;

    // IERC20 private constant cUSD = IERC20(0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1);
    // IERC20 private constant cKES = IERC20(0x1E0433C1769271ECcF4CFF9FDdD515eefE6CdF92);
    IERC20 cUSD;
    IERC20 cKES;

    uint256 public roundIdCounter;
    mapping(uint256 => RaffleRound) public rounds;
    mapping(uint256 => uint256) public currentTickets;

    // ------------------------- MODIFIERS -------------------------
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier roundExists(uint256 _roundId) {
        require(rounds[_roundId].id != 0, "Round does not exist");
        _;
    }

    // ------------------------- EVENTS -------------------------
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

    event ParticipantJoined(
        uint256 indexed roundId,
        address indexed participant
    );

    event WinnersSelected(uint256 indexed roundId, address[3] winners);

    constructor(address _miniPoints, address _cUSD, address _cKES) {
        require(_miniPoints != address(0), "Invalid MiniPoints address");
        miniPoints = IMiniPoints(_miniPoints);
        cUSD = IERC20(_cUSD);
        cKES = IERC20(_cKES);

        owner = msg.sender;
    }

    function createRaffleRound(
        uint256 _startTime,
        uint256 _duration,
        uint256 _maxTickets,
        IERC20 _token,
        uint256 _rewardpool,
        uint256 _ticketCostPoints,
        address _beneficiary
    ) external onlyOwner {
        require(_duration > 0, "Duration must be > 0");
        require(_maxTickets > 0, "Max tickets must be > 0");
        require(
            _token == cUSD || _token == cKES,
            "Not a supported token in the raffle"
        );

        require(
            _token.allowance(msg.sender, address(this)) >= _rewardpool,
            "Insufficient Allowance"
        );
        _token.transferFrom(msg.sender, address(this), _rewardpool);

        roundIdCounter++;
        RaffleRound storage round = rounds[roundIdCounter];
        round.id = roundIdCounter;
        round.startTime = _startTime;
        round.endTime = _startTime + _duration;
        round.maxTickets = _maxTickets;
        round.rewardToken = _token;
        round.rewardPool = _rewardpool;
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

    /**
     * @notice Let the owner top up the prize pool for a round with additional funds.
     * @param _roundId Which round to fund
     */
    function fundRaffleRound(
        uint256 _roundId,
        IERC20 _token,
        uint256 _amount
    ) external payable onlyOwner roundExists(_roundId) {
        require(
            _token == cUSD || _token == cKES,
            "Not a supported token in the raffle"
        );
        require(_amount != 0, "Invalid Amount");
        RaffleRound storage round = rounds[_roundId];
        require(round.isActive, "Round not active");
        require(
            _token.allowance(msg.sender, address(this)) >= _amount,
            "Insufficient Allowance"
        );
        _token.transferFrom(msg.sender, address(this), _amount);
        round.rewardPool += _amount;
    }

    function joinRaffle(
        uint256 _roundId,
        uint256 _ticketCount
    ) external roundExists(_roundId) {
        RaffleRound storage round = rounds[_roundId];
        require(round.isActive, "Round not active");
        require(
            block.timestamp >= round.startTime &&
                block.timestamp <= round.endTime,
            "Not within the round timeframe"
        );
        require(
            round.totalTickets + _ticketCount <= round.maxTickets,
            "Max tickets reached"
        );

        uint ticketCost = round.ticketCostPoints * _ticketCount;
        // Burn points from participant
        require(
            miniPoints.balanceOf(msg.sender) >= ticketCost,
            "Not enough MiniPoints"
        );
        miniPoints.burn(msg.sender, ticketCost);

        if (round.tickets[msg.sender] == 0) {
            round.participants.push(msg.sender);
        }

        round.tickets[msg.sender] += _ticketCount;
        round.totalTickets += _ticketCount;

        emit ParticipantJoined(_roundId, msg.sender);
    }

    function drawWinner(uint256 _roundId) external roundExists(_roundId) {
        RaffleRound storage round = rounds[_roundId];
        require(round.isActive, "Round not active");
        require(!round.winnersSelected, "Winners already selected");
        require(
            block.timestamp > round.endTime ||
                round.totalTickets == round.maxTickets,
            "Round not finished yet"
        );



        // For 3 winners:
        uint256 firstPrize = (round.rewardPool * 50) / 100;
        uint256 secondPrize = (round.rewardPool * 30) / 100;
        uint256 thirdPrize = (round.rewardPool * 20) / 100;

        // 1) First winner
        address winner1 = _pickWinner(round, round.totalTickets);
        round.rewardToken.transfer(winner1, firstPrize);

    
        round.totalTickets -= round.tickets[winner1];
        round.tickets[winner1] = 0;

        // 3) Second winner
        address winner2 = _pickWinner(round, round.totalTickets);
        round.rewardToken.transfer(winner2, secondPrize);

        // 4) Adjust again
        round.totalTickets -= round.tickets[winner2];
        round.tickets[winner2] = 0;

        // 5) Third winner
        address winner3 = _pickWinner(round, round.totalTickets);
        round.rewardToken.transfer(winner3, thirdPrize);

        // Mark round done
        round.isActive = false;
        round.winnersSelected = true;

        // Save them for reference
        round.winners.push(winner1);
        round.winners.push(winner2);
        round.winners.push(winner3);

        emit WinnersSelected(_roundId, [winner1, winner2, winner3]);
    }

    function _pickWinner(
        RaffleRound storage round,
        uint256 ticketSupply
    ) internal view returns (address) {
        if (ticketSupply == 0) {
            return address(0); // or revert if no tickets
        }

        // For demonstration, "random" with blockhash
        uint256 rand = uint256(block.prevrandao) % ticketSupply;

        // Now find which user owns that ticket index via cumulative sum
        uint256 cumulative = 0;
        address selected;

        for (uint256 i = 0; i < round.participants.length; i++) {
            address p = round.participants[i];
            uint256 count = round.tickets[p];
            if (count == 0) continue;
            if (rand < cumulative + count) {
                selected = p;
                break;
            }
            cumulative += count;
        }

        return selected;
    }

    // ------------------------- VIEW FUNCTIONS -------------------------
    /**
     * @notice Return current number of participants in a round.
     */
    function getParticipantCount(
        uint256 _roundId
    ) external view returns (uint256) {
        return rounds[_roundId].participants.length;
    }

    /**
     * @notice Return an array of all participants.
     * @dev For large arrays, be mindful of gas if used on-chain. Off-chain calls are usually fine.
     */
    function getParticipants(
        uint256 _roundId
    ) external view returns (address[] memory) {
        return rounds[_roundId].participants;
    }
}
