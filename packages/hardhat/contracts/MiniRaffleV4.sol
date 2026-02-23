// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MiniPoints.sol";
import "./physicalNFT.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@witnet/solidity/contracts/interfaces/legacy/IWitRandomnessLegacy.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract AkibaRaffleV4 is UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ---- MUST MATCH V1/V2/V3 ORDER EXACTLY ----
    address public owner;
    IMiniPoints public miniPoints;
    IWitRandomnessLegacy public constant RNG =
        IWitRandomnessLegacy(0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB);

    // V4: upper bound where direct linear scan is still acceptable
    uint256 public constant MAX_DIRECT_TICKETS = 25_000;

    IERC20 public cUSD;
    IERC20 public usdt;
    IERC20 public miles;

    struct RaffleRound {
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
        address winner;
        uint256 randomBlock;

        // V3 appends (OK)
        address[] winners;
        uint8     raffleType;
        string    rewardURI;
    }

    uint256 public roundIdCounter;
    mapping(uint256 => RaffleRound) private rounds;   // visibility change is OK
    mapping(address => bool) public minters;

    // ---- V3 NEW STATE (append-only, AFTER the gap originally) ----
    // These were already live in V3:
    address public prizeNFT;
    mapping(address => uint256) private _reserved;

    // ---- V4 NEW STATE (append-only, consuming 2 slots from __gap) ----

    struct RoundChunk {
        uint32 first;          // index into r.participants
        uint32 last;           // inclusive
        uint32 ticketsInChunk; // sum of tickets in [first, last]
    }

    // roundId => chunks covering participants[first..last]
    mapping(uint256 => RoundChunk[]) private _roundChunks;
    // roundId => whether chunks are finalized & consistent
    mapping(uint256 => bool) private _chunksFinalized;

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
        address prize,
        address _owner
    ) public initializer {
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        require(_miniPoints != address(0), "invalid MiniPoints");
        miniPoints = IMiniPoints(_miniPoints);
        miles = IERC20(_miniPoints);
        cUSD = IERC20(_cUSD);
        usdt = IERC20(_usdt);
        prizeNFT = prize;
        owner = _owner;
    }

    // kept for backwards compatibility — already live in V3
    function initializeV3(address _prizeNft) external reinitializer(3) {
        prizeNFT = _prizeNft;
    }

    function setMinter(address who, bool enabled) external onlyOwner {
        require(who != address(0), "Zero addr");
        minters[who] = enabled;
    }

    function createRaffleRound(
        uint256 _startTime,
        uint256 _duration,
        uint32 _maxTickets,
        address _token,
        uint8 _raffleType,
        uint256 _rewardPool,
        uint256 _ticketCostPoints, 
        string memory _rewardURI
    ) external onlyAllowed {
        require(_duration > 0 && _maxTickets > 0, "Raffle: bad params");
        require(_startTime >= block.timestamp, "Raffle: start in past");
        require(address(_token) != address(0), "Raffle: zero token");
        // 0 = single, 1 = top-3, 2 = top-5, 3 = physical
        require(_raffleType <= 3, "Raffle: type unsupported");
        if (_raffleType != 3 && _rewardPool == 0) {
            revert("Raffle: 0 Rewards for Digital Cash/Miles Raffle");
        }

        if (_token != address(miles) && _token != prizeNFT) {
            IERC20(_token).safeTransferFrom(msg.sender, address(this), _rewardPool);
            _reserved[address(_token)] += _rewardPool;
        }

        roundIdCounter++;
        RaffleRound storage r = rounds[roundIdCounter];
        r.id = roundIdCounter;
        r.startTime = _startTime;
        r.endTime = _startTime + _duration;
        r.maxTickets = _maxTickets;

        if (_token != prizeNFT) {
            r.rewardToken = IERC20(_token);
        } else {
            // dummy placeholder for physical prize
            r.rewardToken = IERC20(address(0));
        }

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

        // Only adjust reserved for real ERC20 reward pools (not miles, not physical)
        if (
            address(r.rewardToken) != address(miles) &&
            address(r.rewardToken) != address(0)
        ) {
            _reserved[address(r.rewardToken)] -= r.rewardPool;
        }

        if (r.raffleType == 0 /* single winner */) {
            _singleWinner(_roundId, r);
        } else if (r.raffleType == 1 || r.raffleType == 2 /* multi */) {
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
                miniPoints.mint(player, refundAmount);
                round.tickets[player] = 0;
            }
        }

        emit RaffleClosed(_roundId);
    }

    function _selectByIndex(
        RaffleRound storage r,
        uint256 index
    ) internal view returns (address) {
        uint256 cum;
        for (uint256 i; i < r.participants.length; i++) {
            address p = r.participants[i];
            uint32 t = r.tickets[p];
            if (index < cum + t) return p;
            cum += t;
        }
        revert("Raffle: index overflow");
    }

    /// @dev V4 helper: select a winner address using chunking when needed.
    ///  - If chunks are not finalized and totalTickets <= MAX_DIRECT_TICKETS:
    ///      fall back to _selectByIndex (original behavior).
    ///  - If chunks are not finalized and totalTickets > MAX_DIRECT_TICKETS:
    ///      revert and require chunk building.
    ///  - If chunks are finalized:
    ///      use 2-level selection: chunk -> participant within chunk.
    function _pickTicketWinner(
        uint256 roundId,
        RaffleRound storage r,
        uint256 salt
    ) internal view returns (address) {
        require(r.totalTickets > 0, "Raffle: no tickets");

        uint256 pick = RNG.random(r.totalTickets, salt, r.randomBlock);

        if (!_chunksFinalized[roundId]) {
            if (r.totalTickets <= MAX_DIRECT_TICKETS) {
                // Small round: original behavior
                return _selectByIndex(r, pick);
            } else {
                // Large round: force chunk building
                revert("Raffle: chunks required");
            }
        }

        RoundChunk[] storage chunks = _roundChunks[roundId];
        require(chunks.length > 0, "Raffle: no chunks");

        uint256 cum = 0;
        uint256 chunkIdx = 0;

        // Determine which chunk the global index falls into
        for (; chunkIdx < chunks.length; chunkIdx++) {
            uint256 nextCum = cum + chunks[chunkIdx].ticketsInChunk;
            if (pick < nextCum) {
                break;
            }
            cum = nextCum;
        }
        require(chunkIdx < chunks.length, "Raffle: chunk overflow");

        // Offset within this chunk
        uint256 offset = pick - cum;
        RoundChunk storage c = chunks[chunkIdx];

        uint256 localCum = 0;
        for (uint256 i = c.first; i <= c.last; i++) {
            address p = r.participants[i];
            uint32 t = r.tickets[p];
            if (offset < localCum + t) {
                return p;
            }
            localCum += t;
        }

        revert("Raffle: local index overflow");
    }

    /// @notice V4: build ticket chunks for a round in batches.
    /// @dev Call multiple times until it reverts with "Raffle: all participants chunked".
    ///      `batchSize` should be chosen to fit comfortably within gas (e.g. 200–500).
    function buildChunks(
        uint256 roundId,
        uint32 batchSize
    ) external onlyAllowed roundExists(roundId) {
        require(batchSize > 0, "Raffle: batchSize=0");

        RaffleRound storage r = rounds[roundId];
        require(block.timestamp > r.endTime, "Raffle: not ended");
        require(!r.winnerSelected, "Raffle: already drawn");
        require(!_chunksFinalized[roundId], "Raffle: chunks finalized");

        RoundChunk[] storage chunks = _roundChunks[roundId];

        // Determine starting index in participants[]
        uint32 start = 0;
        if (chunks.length > 0) {
            start = chunks[chunks.length - 1].last + 1;
        }

        uint32 pLen = uint32(r.participants.length);
        require(start < pLen, "Raffle: all participants chunked");

        uint32 end = start + batchSize - 1;
        if (end >= pLen) {
            end = pLen - 1;
        }

        uint32 ticketsInChunk = 0;
        for (uint32 i = start; i <= end; i++) {
            address p = r.participants[i];
            ticketsInChunk += r.tickets[p];
        }

        chunks.push(
            RoundChunk({
                first: start,
                last: end,
                ticketsInChunk: ticketsInChunk
            })
        );
    }

    /// @notice V4: finalize chunks for a round, ensuring coverage of all tickets.
    /// @dev Must be called after `buildChunks` has fully covered participants[].
    function finalizeChunks(
        uint256 roundId
    ) external onlyAllowed roundExists(roundId) {
        RaffleRound storage r = rounds[roundId];
        RoundChunk[] storage chunks = _roundChunks[roundId];

        require(chunks.length > 0, "Raffle: no chunks");
        require(!_chunksFinalized[roundId], "Raffle: chunks already finalized");
        require(!r.winnerSelected, "Raffle: already drawn");

        uint256 sum;
        for (uint256 i = 0; i < chunks.length; i++) {
            sum += chunks[i].ticketsInChunk;
        }
        require(sum == r.totalTickets, "Raffle: ticket sum mismatch");

        _chunksFinalized[roundId] = true;
    }

    /// @notice Optional helper for off-chain inspection of chunks.
    function getChunks(
        uint256 roundId
    ) external view returns (RoundChunk[] memory) {
        return _roundChunks[roundId];
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

    function _singleWinner(
        uint256 roundId,
        RaffleRound storage r
    ) internal {
        address winner = _pickTicketWinner(roundId, r, 0);

        r.winners.push(winner);
        r.isActive = false;
        r.winnerSelected = true;

        if (address(r.rewardToken) == address(miles)) {
            miniPoints.mint(winner, r.rewardPool);
        } else if (address(r.rewardToken) != address(0)) {
            r.rewardToken.safeTransfer(winner, r.rewardPool);
        }

        emit WinnerSelected(roundId, winner, r.rewardPool);
    }

    function _physicalWinner(
        uint256 roundId,
        RaffleRound storage r
    ) internal {
        address winner = _pickTicketWinner(roundId, r, 0);

        r.winners.push(winner);
        r.isActive = false;
        r.winnerSelected = true;

        PhysicalPrizeNFT(prizeNFT).mintTo(
            winner,
            uint64(roundId),
            0, // default expiry or handled at NFT level
            r.rewardURI
        );

        // “1” to signal a 1-of-1 physical voucher in the event
        emit WinnerSelected(roundId, winner, 1);
    }

    function _multipleWinners(
        uint256 roundId,
        RaffleRound storage r
    ) internal {
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
            split[3] = 5;
            split[4] = 5;
        } else {
            revert("Raffle: invalid raffleType");
        }

        address[] memory winnersArr = new address[](split.length);
        uint256 count = 0;
        uint256 attempts = 0;

        while (count < split.length && attempts < split.length * 16) {
            // vary the salt so RNG changes each attempt
            address w = _pickTicketWinner(roundId, r, attempts + 1);

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

        // finalize round
        r.isActive = false;
        r.winnerSelected = true;

        if (address(r.rewardToken) == address(miles)) {
            for (uint256 i = 0; i < count; i++) {
                miniPoints.mint(winnersArr[i], amounts[i]);
            }
        } else if (address(r.rewardToken) != address(0)) {
            for (uint256 i = 0; i < count; i++) {
                r.rewardToken.safeTransfer(winnersArr[i], amounts[i]);
            }
        }

        address[] memory winnersTrim = new address[](count);
        for (uint256 i; i < count; i++) winnersTrim[i] = winnersArr[i];

        emit MultiWinnersSelected(roundId, winnersTrim, amounts);
    }

    function setPrizeNft(address _prizeNft) external onlyOwner { 
        prizeNFT = _prizeNft;
    }

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

    // originally uint256[50] __gap; now we consume 2 slots for the new mappings
    uint256[48] private __gap;
}
