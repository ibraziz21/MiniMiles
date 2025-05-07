// SPDX‑License‑Identifier: MIT
pragma solidity ^0.8.20;

/* ─────────────────────────  EXTERNAL DEPENDENCIES  ───────────────────────── */
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "@chainlink/contracts/src/v0.8/ccip/applications/CCIPReceiver.sol";
import "@chainlink/contracts/src/v0.8/ccip/libraries/Client.sol";

/* ─────────────────────────────  INTERFACES  ──────────────────────────────── */
interface IMiniPoints is IERC20 {
    function burn(address, uint256) external;
}

/* ─────────────────────────────  CONTRACT  ────────────────────────────────── */
contract CrossChainRaffle is CCIPReceiver, Ownable {
    /* ─────────── CONSTANTS & IMMUTABLES ─────────── */
    uint64 public immutable SOURCE_CHAIN;          // OP Sepolia selector
    IMiniPoints public immutable miniPoints;
    IERC20 public immutable cUSD;
    IERC20 public immutable cKES;

    /* ───────────────  DATA  ─────────────── */
    struct RaffleRound {
        /* existing */
        uint256  id;
        uint256  startTime;
        uint256  endTime;
        uint256  maxTickets;
        IERC20   rewardToken;
        uint256  rewardPool;
        address  beneficiary;
        uint256  ticketCostPoints;
        address[] participants;
        bool     isActive;
        bool     winnersSelected;
        mapping(address => uint256) tickets;
        uint256  totalTickets;
        address[] winners;

        /* new for cross‑chain VRF */
        uint256  randomValue;      // 0 until CCIP delivers
        bool     randReady;
    }

    uint256                       public roundIdCounter;
    mapping(uint256 => RaffleRound) private rounds;

    /* ───────────────  EVENTS  ─────────────── */
    event RoundCreated(uint256 indexed id, uint256 start, uint256 end);
    event ParticipantJoined(uint256 indexed id, address indexed account);
    event RandomnessArrived(uint256 indexed id, uint256 randomWord);
    event WinnersSelected(uint256 indexed id, address[3] winners);

    /* ───────────────  MODIFIERS  ─────────────── */
    modifier roundExists(uint256 id) {
        require(rounds[id].id != 0, "Raffle: round not found");
        _;
    }

    /* ───────────────  CONSTRUCTOR  ─────────────── */
    constructor(
        address _router,                  // CCIP router on Celo
        uint64  _sourceSelector,          // OP Sepolia selector
        address _miniPoints,
        address _cUSD,
        address _cKES
    )
        CCIPReceiver(_router)
    {
        SOURCE_CHAIN = _sourceSelector;
        miniPoints   = IMiniPoints(_miniPoints);
        cUSD         = IERC20(_cUSD);
        cKES         = IERC20(_cKES);
    }

    /* ───────────────  OWNER FUNCTIONS  ─────────────── */

    function createRaffleRound(
        uint256  _startTime,
        uint256  _duration,
        uint256  _maxTickets,
        IERC20   _token,
        uint256  _rewardPool,
        uint256  _ticketCostPoints,
        address  _beneficiary
    ) external onlyOwner {
        require(_duration   > 0, "duration");
        require(_maxTickets > 0, "maxTickets");
        require(
            _token == cUSD || _token == cKES,
            "unsupported reward token"
        );

        // pull reward tokens
        _token.transferFrom(msg.sender, address(this), _rewardPool);

        // init struct
        ++roundIdCounter;
        RaffleRound storage r = rounds[roundIdCounter];
        r.id              = roundIdCounter;
        r.startTime       = _startTime;
        r.endTime         = _startTime + _duration;
        r.maxTickets      = _maxTickets;
        r.rewardToken     = _token;
        r.rewardPool      = _rewardPool;
        r.beneficiary     = _beneficiary;
        r.ticketCostPoints= _ticketCostPoints;
        r.isActive        = true;

        emit RoundCreated(r.id, r.startTime, r.endTime);
    }

    /* ───────────────  PARTICIPATION  ─────────────── */

    function joinRaffle(uint256 id, uint256 quantity) external roundExists(id) {
        RaffleRound storage r = rounds[id];
        require(r.isActive, "inactive");
        require(
            block.timestamp >= r.startTime &&
            block.timestamp <= r.endTime,
            "outside timeframe"
        );
        require(
            r.totalTickets + quantity <= r.maxTickets,
            "sold out"
        );

        uint256 cost = r.ticketCostPoints * quantity;
        miniPoints.burn(msg.sender, cost);

        if (r.tickets[msg.sender] == 0) r.participants.push(msg.sender);

        r.tickets[msg.sender] += quantity;
        r.totalTickets        += quantity;

        emit ParticipantJoined(id, msg.sender);
    }

    /* ───────────────  RANDOMNESS DELIVERY (CCIP)  ─────────────── */

    /// @dev CCIP router on Celo calls this when VRF word is bridged.
    function _ccipReceive(
        Client.Any2EVMMessage memory m
    ) internal override {
        require(
            m.sourceChainSelector == SOURCE_CHAIN,
            "CCIP: wrong source"
        );

        (uint256 id, uint256 rand) = abi.decode(m.data, (uint256,uint256));
        RaffleRound storage r = rounds[id];
        require(r.id != 0,               "round not found");
        require(!r.randReady,            "already delivered");

        r.randomValue = rand;
        r.randReady   = true;

        emit RandomnessArrived(id, rand);
    }

    /* ───────────────  WINNER SELECTION  ─────────────── */

    function drawWinner(uint256 id) external roundExists(id) {
        RaffleRound storage r = rounds[id];
        require(r.isActive,          "inactive");
        require(r.randReady,         "rand not ready");
        require(!r.winnersSelected,  "already drawn");

        // split pot
        uint256 first  = (r.rewardPool * 50) / 100;
        uint256 second = (r.rewardPool * 30) / 100;
        uint256 third  = r.rewardPool - first - second;

        // 1) pick winners using randomValue
        uint256 supply = r.totalTickets;
        require(supply > 0, "no tickets");

        address w1 = _pick(r, r.randomValue % supply);
        supply    -= r.tickets[w1];

        address w2 = _pick(r, uint256(keccak256(abi.encode(r.randomValue,1))) % supply);
        supply    -= r.tickets[w2];

        address w3 = _pick(r, uint256(keccak256(abi.encode(r.randomValue,2))) % supply);

        // payout
        r.rewardToken.transfer(w1, first);
        r.rewardToken.transfer(w2, second);
        r.rewardToken.transfer(w3, third);

        r.winnersSelected = true;
        r.isActive        = false;
        r.winners.push(w1); r.winners.push(w2); r.winners.push(w3);

        emit WinnersSelected(id, [w1, w2, w3]);
    }

    /* ───────────────  INTERNAL HELPER  ─────────────── */

    function _pick(
        RaffleRound storage r,
        uint256 index
    ) internal view returns (address) {
        uint256 cumul = 0;
        for (uint256 i = 0; i < r.participants.length; ++i) {
            address p = r.participants[i];
            uint256 n = r.tickets[p];
            if (index < cumul + n) return p;
            cumul += n;
        }
        return address(0); // should never hit
    }

    /* ───────────────  VIEWS  ─────────────── */

    function getParticipants(uint256 id)
        external
        view
        roundExists(id)
        returns (address[] memory)
    {
        return rounds[id].participants;
    }

    function ticketsOf(uint256 id, address user)
        external
        view
        roundExists(id)
        returns (uint256)
    {
        return rounds[id].tickets[user];
    }
}
