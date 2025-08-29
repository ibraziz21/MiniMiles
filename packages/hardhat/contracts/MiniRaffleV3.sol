// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MiniPoints.sol";
import './physicalNFT.sol';
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "witnet-solidity-bridge/contracts/interfaces/IWitnetRandomness.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract AkibaRaffle is UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;


    address public owner;
    address public prizeNFT;
    IMiniPoints public miniPoints;
    IWitnetRandomness public constant RNG =
        IWitnetRandomness(0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB);

    IERC20 public cUSD;
    IERC20 public usdt;
    IERC20 public miles;

  struct RaffleRound {
    // --- MUST MATCH V1/V2 EXACTLY (order & types) ---
    uint256 id;
    uint256 startTime;
    uint256 endTime;
    uint32  maxTickets;
    IERC20  rewardToken;
    uint256 rewardPool;
    uint256 ticketCostPoints;
    address[] participants;
    bool    isActive;
    bool    winnerSelected;
    mapping(address => uint32) tickets;
    uint32  totalTickets;
    address winner;        // <-- keep legacy slot!
    uint256 randomBlock;   // <-- keep legacy slot!

    // --- V3 APPENDS ONLY (safe) ---
    address[] winners;     // new
    uint8     raffleType;  // new
    string rewardURI;
}


    uint256 public roundIdCounter;
    mapping(uint256 => RaffleRound) private rounds;
    mapping(address => uint256) private _reserved; // token => reserved amount

    event Withdraw(address indexed token, address indexed to, uint256 amount);
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    event RoundCreated(
        uint256 indexed roundId,
        uint256 startTime,
        uint256 endTime,
        uint256 rewardPool,
        IERC20 rewardToken,
        uint256 maxTickets,
        uint256 ticketCostPoints,
        uint8 roundType
    );
    event ParticipantJoined(
        uint256 indexed roundId,
        address indexed participant,
        uint256 tickets
    );
    event RandomnessRequested(uint256 indexed roundId, uint256 witnetBlock);
    event WinnerSelected(
        uint256 indexed roundId,
        address winner,
        uint256 reward
    );

    event MultiWinnersSelected(
        uint256 indexed roundId,
        address[] winners,
        uint256[] amounts
    );
    event RaffleClosed(uint256 indexed roundId);

    error Unauthorized();
    mapping(address => bool) public minters;

    modifier onlyOwner() {
        require(msg.sender == owner, "Raffle: not owner");
        _;
    }
    modifier onlyAllowed() {
        if (msg.sender != owner && !minters[msg.sender]) revert Unauthorized();
        _;
    }
    modifier roundExists(uint256 _roundId) {
        require(rounds[_roundId].id != 0, "Raffle: round does not exist");
        _;
    }

    function initialize(
        address _miniPoints,
        address _cUSD,
        address _usdt,
        address _owner
    ) public initializer {
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        require(_miniPoints != address(0), "invalid MiniPoints");
        miniPoints = IMiniPoints(_miniPoints);
        miles = IERC20(_miniPoints);
        cUSD = IERC20(_cUSD);
        usdt = IERC20(_usdt);
        owner = _owner;
    }

    function setMinter(address who, bool enabled) external onlyOwner {
        require(who != address(0), "Zero addr");
        minters[who] = enabled;
    }

    function createRaffleRound(
        uint256 _startTime,
        uint256 _duration,
        uint32 _maxTickets,
        IERC20 _token,
        uint8 _raffleType,
        uint256 _rewardPool,
        uint256 _ticketCostPoints, 
        string memory _rewardURI
    ) external onlyAllowed {
        require(_duration > 0 && _maxTickets > 0, "Raffle: bad params");
        require(_startTime >= block.timestamp, "Raffle: start in past");
        require(address(_token) != address(0), "Raffle: zero token");
        // Only 0/1/2 supported unless you implement physical path:
        require(_raffleType <= 3, "Raffle: type unsupported");
        if (_raffleType != 3 && _rewardPool == 0)
            revert("Raffle: 0 Rewards for Digital Cash/Miles Raffle");
      

        if (_token != miles) {
            _token.safeTransferFrom(msg.sender, address(this), _rewardPool);
            _reserved[address(_token)] += _rewardPool;
        }
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
        r.raffleType = _raffleType;
        r.rewardURI = _rewardURI;

        emit RoundCreated(
            r.id,
            r.startTime,
            r.endTime,
            r.rewardPool,
            r.rewardToken,
            r.maxTickets,
            r.ticketCostPoints,
            r.raffleType
        );
    }

    function joinRaffle(
        uint256 _roundId,
        uint32 _ticketCount
    ) external roundExists(_roundId) nonReentrant {
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

        emit ParticipantJoined(_roundId, msg.sender, _ticketCount);
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
    ) external virtual nonReentrant roundExists(_roundId) {
        RaffleRound storage r = rounds[_roundId];
        require(r.isActive, "Raffle: inactive round");
        require(!r.winnerSelected, "Raffle: already drawn");
        require(
            block.timestamp > r.endTime || r.totalTickets == r.maxTickets,
            "Raffle: unfinished"
        );
        uint256 threshold = (uint256(r.maxTickets) * 20) / 100;
        require(r.totalTickets >= threshold, "Raffle: threshold not met");
        require(
            r.randomBlock != 0 && RNG.isRandomized(r.randomBlock),
            "Raffle: randomness pending"
        );

        if (address(r.rewardToken) != address(miles)) {
            _reserved[address(r.rewardToken)] -= r.rewardPool;
        }

        if (r.raffleType == 0 /*single Winner */) {
            _singleWinner(_roundId, r);
        } else if (r.raffleType == 1 || r.raffleType == 2 /*3 winners */) {
            _multipleWinners(_roundId, r);
        } else {
            _physicalWinner(_roundId, r);
        }
    }

    /// @notice Close an under-subscribed raffle after its endTime and refund all MiniPoints.
    /// @dev Anyone can call once time has passed; requires <20% tickets sold.
    function closeRaffle(
        uint256 _roundId
    ) external virtual nonReentrant roundExists(_roundId) {
        RaffleRound storage round = rounds[_roundId];
        require(round.isActive, "Raffle: inactive");
        require(block.timestamp > round.endTime, "Raffle: not ended");

        // must be below 20% of maxTickets
        require(
            round.totalTickets * 100 < uint256(round.maxTickets) * 20,
            "Raffle: threshold met"
        );

        // refund each participant their spent points
        round.isActive = false;
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

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Owner: zero addr");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _singleWinner(uint roundId, RaffleRound storage r) internal {
        uint256 pick = RNG.random(r.totalTickets, 0, r.randomBlock);
        address winner = _selectByIndex(r, pick);
        r.winners.push(winner);
        r.isActive = false;
        r.winnerSelected = true;
        if (address(r.rewardToken) == address(miles)) {
            miniPoints.mint(winner, r.rewardPool);
        } else {
            r.rewardToken.safeTransfer(winner, r.rewardPool);
        }

        emit WinnerSelected(roundId, winner, r.rewardPool);
    }

 function _physicalWinner(uint roundId, RaffleRound storage r) internal {
    uint256 pick = RNG.random(r.totalTickets, 0, r.randomBlock);
    address winner = _selectByIndex(r, pick);

    // finalize draw
    r.winners.push(winner);
    r.isActive = false;
    r.winnerSelected = true;

    // mint voucher NFT with default 30d (or pass custom seconds & URI)
    PhysicalPrizeNFT(prizeNFT).mintTo(winner, uint64(roundId), 0, r.rewardURI);

    emit WinnerSelected(roundId, winner, 1); // “1” to signal a 1-of-1 physical voucher
}


    function _multipleWinners(uint roundId, RaffleRound storage r) internal {
        uint16[] memory split;
        if (r.raffleType == 1) {
            // triple: 50/30/20
            split = new uint16[](3);
            split[0] = 50;
            split[1] = 30;
            split[2] = 20;
        } else if (r.raffleType == 2) {
            // quintuple: 50/25/15/10/10
            split = new uint16[](5);
            split[0] = 50;
            split[1] = 25;
            split[2] = 15;
            split[3] = 10;
            split[4] = 10;
        } else {
            revert("Raffle: invalid raffleType");
        }

        // draw unique winners
        address[] memory winnersArr = new address[](split.length);
        uint256 count = 0;
        uint256 attempts = 0;
        while (count < split.length && attempts < split.length * 16) {
            // generous cap to avoid long loops
            // vary the salt so RNG changes each attempt
            uint256 pick = RNG.random(
                r.totalTickets,
                attempts + 1,
                r.randomBlock
            );
            address w = _selectByIndex(r, pick);

            // ensure uniqueness among already-picked winners
            bool dup = false;
            for (uint256 j = 0; j < count; j++) {
                if (winnersArr[j] == w) {
                    dup = true;
                    break;
                }
            }
            if (!dup) {
                winnersArr[count] = w;
                r.winners.push(w); // persist to storage
                count++;
            }
            attempts++;
        }
        require(count > 0, "Raffle: no unique winners");

        // compute amounts using (possibly truncated) split and re-normalize;
        uint16 sumPerc = 0;
        for (uint256 i = 0; i < count; i++) sumPerc += split[i];

        uint256[] memory amounts = new uint256[](count);
        uint256 running = 0;
        if (count == 1) {
            amounts[0] = r.rewardPool; // single unique winner fallback
        } else {
            for (uint256 i = 0; i < count - 1; i++) {
                // round down each amount; leftover goes to last winner
                amounts[i] =
                    (r.rewardPool * uint256(split[i])) /
                    uint256(sumPerc);
                running += amounts[i];
            }
            amounts[count - 1] = r.rewardPool - running; // give remainder to the last
        }

        // payout

        // finalize round
        r.isActive = false;
        r.winnerSelected = true;

        if (address(r.rewardToken) == address(miles)) {
            for (uint256 i = 0; i < count; i++) {
                miniPoints.mint(winnersArr[i], amounts[i]);
            }
        } else {
            for (uint256 i = 0; i < count; i++) {
                r.rewardToken.safeTransfer(winnersArr[i], amounts[i]);
            }
        }

        address[] memory winnersTrim = new address[](count);
        for (uint256 i; i < count; i++) winnersTrim[i] = winnersArr[i];
        emit MultiWinnersSelected(roundId, winnersTrim, amounts);
    }

    function setPrizeNft(address _prizeNft) external onlyOwner { 
        prizeNFT = _prizeNft; }


    /// @notice Owner withdraws stuck tokens (USDT, cUSD, etc.) from contract
    function withdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "Withdraw: zero addr");
        require(amount > 0, "Withdraw: zero amount");
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 reserved = _reserved[token];
        require(
            bal > reserved && amount <= bal - reserved,
            "Withdraw: reserved"
        );
        IERC20(token).safeTransfer(to, amount);
        emit Withdraw(token, to, amount);
    }

    function ticketsOf(
        uint256 _roundId,
        address user
    ) external view returns (uint32) {
        return rounds[_roundId].tickets[user];
    }

    function participantsOf(
        uint256 _roundId
    ) external view returns (address[] memory) {
        return rounds[_roundId].participants;
    }

    function winnersOf(
        uint256 _roundId
    ) external view returns (address[] memory) {
        return rounds[_roundId].winners;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    uint256[50] private __gap;
}
