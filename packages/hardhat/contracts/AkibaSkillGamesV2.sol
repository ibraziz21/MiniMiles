// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IAkibaMilesBurnable {
    function burn(address account, uint256 amount) external;
}

interface IGameTreasury {
    function payout(address player, uint256 milesAmount, uint256 stableAmount) external;
}

/// @title AkibaSkillGamesV2
/// @notice Extends V1 with:
///   - Prepaid credit bundles (buyCredits) so users burn once, play multiple times
///   - On-chain daily play cap (MAX_DAILY_PLAYS per game type per player per UTC day)
///   - Backend-sponsored startGameFor so players with credits never send a startGame tx
///   - Backend can call settleGame as verifier (already supported in V1)
contract AkibaSkillGamesV2 is Ownable, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;

    // ─── constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_DAILY_PLAYS   = 20;
    uint256 public constant MAX_CREDIT_BALANCE = 50;

    // ─── types ────────────────────────────────────────────────────────────────

    enum SessionStatus { None, Started, Settled, Rejected }

    struct GameConfig {
        bool     isEnabled;
        uint256  entryCostMiles;
        uint256  maxRewardMiles;
        uint256  maxRewardStable;
        uint256  settlementWindow;
    }

    struct Session {
        uint256       sessionId;
        address       player;
        uint8         gameType;
        uint256       entryCost;
        uint64        createdAt;
        bytes32       seedCommitment;
        bool          settled;
        uint256       score;
        uint256       rewardMiles;
        uint256       rewardStable;
        SessionStatus status;
    }

    // ─── errors ───────────────────────────────────────────────────────────────

    error NullAddress();
    error GameDisabled();
    error UnknownSession();
    error AlreadySettled();
    error BadPlayer();
    error ExpiredSettlement();
    error UnauthorizedSettlement();
    error RewardExceedsConfig();
    error DailyCapReached();
    error CreditBalanceFull();
    error InsufficientCredits();
    error InvalidCount();
    error BadNonce();
    error BadStartSignature();

    // ─── state ────────────────────────────────────────────────────────────────

    IAkibaMilesBurnable public immutable milesToken;
    IGameTreasury       public treasury;
    address             public verifier;
    uint256             public nextSessionId = 1;

    mapping(uint8   => GameConfig)                               public gameConfigs;
    mapping(uint256 => Session)                                  public sessions;

    /// prepaid credit balances: player → gameType → count
    mapping(address => mapping(uint8 => uint256))                public playCredits;

    /// daily play tracking: player → gameType → UTC-day → count
    mapping(address => mapping(uint8 => mapping(uint256 => uint256))) public dailyPlayCount;

    /// nonce for startGameFor intent signatures: player → nonce
    mapping(address => uint256) public startNonces;

    // ─── events ───────────────────────────────────────────────────────────────

    event GameStarted(
        uint256 indexed sessionId,
        address indexed player,
        uint8   indexed gameType,
        uint256         entryCost,
        bytes32         seedCommitment
    );
    event GameSettled(
        uint256 indexed sessionId,
        address indexed player,
        uint8   indexed gameType,
        uint256         score,
        uint256         rewardMiles,
        uint256         rewardStable
    );
    event CreditsPurchased(
        address indexed player,
        uint8   indexed gameType,
        uint256         count,
        uint256         totalCost
    );
    event CreditConsumed(
        address indexed player,
        uint8   indexed gameType,
        uint256         remaining
    );
    event DailyPlayRecorded(
        address indexed player,
        uint8   indexed gameType,
        uint256         day,
        uint256         count
    );
    event SponsoredStartUsed(
        address indexed player,
        uint8   indexed gameType,
        uint256 indexed sessionId
    );
    event VerifierUpdated(address indexed verifier);
    event TreasuryUpdated(address indexed treasury);
    event GameConfigUpdated(
        uint8   indexed gameType,
        bool            isEnabled,
        uint256         entryCostMiles,
        uint256         maxRewardMiles,
        uint256         maxRewardStable,
        uint256         settlementWindow
    );

    // ─── constructor ──────────────────────────────────────────────────────────

    constructor(address _milesToken, address _treasury, address _verifier) {
        if (_milesToken == address(0) || _treasury == address(0) || _verifier == address(0)) {
            revert NullAddress();
        }
        milesToken = IAkibaMilesBurnable(_milesToken);
        treasury   = IGameTreasury(_treasury);
        verifier   = _verifier;
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    /// @notice UTC day number for use as the daily-play map key.
    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @dev Shared pre-flight and session-creation logic for both start paths.
    function _createSession(
        address  player,
        uint8    gameType,
        bytes32  seedCommitment,
        bool     consumeCredit
    ) internal returns (uint256 sessionId) {
        GameConfig memory config = gameConfigs[gameType];
        if (!config.isEnabled) revert GameDisabled();

        // ── daily cap ──────────────────────────────────────────────────────
        uint256 day   = currentDay();
        uint256 plays = dailyPlayCount[player][gameType][day];
        if (plays >= MAX_DAILY_PLAYS) revert DailyCapReached();
        dailyPlayCount[player][gameType][day] = plays + 1;
        emit DailyPlayRecorded(player, gameType, day, plays + 1);

        // ── entry cost ─────────────────────────────────────────────────────
        if (consumeCredit) {
            // use a prepaid credit — no burn at play time
            uint256 bal = playCredits[player][gameType];
            if (bal == 0) revert InsufficientCredits();
            playCredits[player][gameType] = bal - 1;
            emit CreditConsumed(player, gameType, bal - 1);
        } else if (config.entryCostMiles > 0) {
            milesToken.burn(player, config.entryCostMiles);
        }

        // ── session ────────────────────────────────────────────────────────
        sessionId = nextSessionId++;
        sessions[sessionId] = Session({
            sessionId:      sessionId,
            player:         player,
            gameType:       gameType,
            entryCost:      config.entryCostMiles,
            createdAt:      uint64(block.timestamp),
            seedCommitment: seedCommitment,
            settled:        false,
            score:          0,
            rewardMiles:    0,
            rewardStable:   0,
            status:         SessionStatus.Started
        });

        emit GameStarted(sessionId, player, gameType, config.entryCostMiles, seedCommitment);
    }

    // ─── credit purchase ──────────────────────────────────────────────────────

    /// @notice Buy `count` prepaid plays for `gameType`, burning the entry cost upfront.
    /// @dev    Tokens are burned now; each play later consumes one credit without a burn.
    function buyCredits(uint8 gameType, uint256 count) external whenNotPaused nonReentrant {
        if (count == 0) revert InvalidCount();
        GameConfig memory config = gameConfigs[gameType];
        if (!config.isEnabled) revert GameDisabled();

        uint256 newBal = playCredits[msg.sender][gameType] + count;
        if (newBal > MAX_CREDIT_BALANCE) revert CreditBalanceFull();

        uint256 totalCost = config.entryCostMiles * count;
        if (totalCost > 0) {
            milesToken.burn(msg.sender, totalCost);
        }

        playCredits[msg.sender][gameType] = newBal;
        emit CreditsPurchased(msg.sender, gameType, count, totalCost);
    }

    // ─── self-start (player pays gas, uses credit or burns inline) ────────────

    /// @notice Player starts a game themselves. Uses a prepaid credit if available;
    ///         otherwise burns the per-game entry cost inline.
    function startGame(uint8 gameType, bytes32 seedCommitment)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 sessionId)
    {
        bool hasCredit = playCredits[msg.sender][gameType] > 0;
        sessionId = _createSession(msg.sender, gameType, seedCommitment, hasCredit);
    }

    // ─── sponsored start (backend wallet pays gas) ────────────────────────────

    /// @notice Backend calls this on behalf of a player who has prepaid credits.
    ///         The player signs an intent off-chain so the backend cannot replay it.
    ///
    /// @param player          Wallet that will own the session.
    /// @param gameType        Game identifier.
    /// @param seedCommitment  Seed hash chosen client-side.
    /// @param nonce           Must equal startNonces[player]; prevents replay.
    /// @param expiry          Unix timestamp after which the signature is invalid.
    /// @param playerSignature ECDSA sig over
    ///                        keccak256(abi.encode("AkibaStartIntent", player, gameType,
    ///                                             seedCommitment, nonce, expiry,
    ///                                             address(this), chainId))
    function startGameFor(
        address  player,
        uint8    gameType,
        bytes32  seedCommitment,
        uint256  nonce,
        uint256  expiry,
        bytes calldata playerSignature
    )
        external
        whenNotPaused
        nonReentrant
        returns (uint256 sessionId)
    {
        if (msg.sender != verifier) revert UnauthorizedSettlement();
        if (block.timestamp > expiry)  revert ExpiredSettlement();
        if (nonce != startNonces[player]) revert BadNonce();

        // ── verify player intent sig ───────────────────────────────────────
        bytes32 intentDigest = keccak256(
            abi.encode(
                keccak256("AkibaStartIntent(address player,uint8 gameType,bytes32 seedCommitment,uint256 nonce,uint256 expiry,address verifyingContract,uint256 chainId)"),
                player,
                gameType,
                seedCommitment,
                nonce,
                expiry,
                address(this),
                block.chainid
            )
        );
        if (intentDigest.toEthSignedMessageHash().recover(playerSignature) != player) {
            revert BadStartSignature();
        }

        // consume nonce
        startNonces[player] = nonce + 1;

        // always consumes a credit (sponsored path requires prepaid)
        sessionId = _createSession(player, gameType, seedCommitment, true);
        emit SponsoredStartUsed(player, gameType, sessionId);
    }

    // ─── settlement ───────────────────────────────────────────────────────────

    /// @notice Settle a game session. Callable by the player OR the verifier/backend.
    ///         Backend settlement removes a user transaction entirely.
    function settleGame(
        uint256 sessionId,
        uint256 score,
        uint256 rewardMiles,
        uint256 rewardStable,
        uint256 expiry,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        Session storage session = sessions[sessionId];
        if (session.player == address(0)) revert UnknownSession();
        if (session.settled) revert AlreadySettled();
        if (msg.sender != session.player && msg.sender != verifier) revert BadPlayer();
        if (block.timestamp > expiry) revert ExpiredSettlement();

        GameConfig memory config = gameConfigs[session.gameType];
        if (rewardMiles > config.maxRewardMiles || rewardStable > config.maxRewardStable) {
            revert RewardExceedsConfig();
        }
        if (config.settlementWindow > 0 && block.timestamp > session.createdAt + config.settlementWindow) {
            revert ExpiredSettlement();
        }

        bytes32 digest = settlementDigest(
            sessionId,
            session.player,
            session.gameType,
            score,
            rewardMiles,
            rewardStable,
            expiry,
            address(this),
            block.chainid
        );
        if (digest.toEthSignedMessageHash().recover(signature) != verifier) {
            revert UnauthorizedSettlement();
        }

        session.settled      = true;
        session.score        = score;
        session.rewardMiles  = rewardMiles;
        session.rewardStable = rewardStable;
        session.status       = SessionStatus.Settled;

        treasury.payout(session.player, rewardMiles, rewardStable);

        emit GameSettled(sessionId, session.player, session.gameType, score, rewardMiles, rewardStable);
    }

    // ─── view helpers ─────────────────────────────────────────────────────────

    function settlementDigest(
        uint256 sessionId,
        address player,
        uint8   gameType,
        uint256 score,
        uint256 rewardMiles,
        uint256 rewardStable,
        uint256 expiry,
        address verifyingContract,
        uint256 chainId
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "AkibaSkillGameSettlement(uint256 sessionId,address player,uint8 gameType,uint256 score,uint256 rewardMiles,uint256 rewardStable,uint256 expiry,address verifyingContract,uint256 chainId)"
                ),
                sessionId, player, gameType, score,
                rewardMiles, rewardStable, expiry,
                verifyingContract, chainId
            )
        );
    }

    /// @notice Returns a player's credit balance and today's play count for a game type.
    function playerStatus(address player, uint8 gameType)
        external
        view
        returns (uint256 credits, uint256 playsToday, uint256 playsRemaining)
    {
        credits       = playCredits[player][gameType];
        playsToday    = dailyPlayCount[player][gameType][currentDay()];
        playsRemaining = playsToday >= MAX_DAILY_PLAYS ? 0 : MAX_DAILY_PLAYS - playsToday;
    }

    // ─── admin ────────────────────────────────────────────────────────────────

    function setVerifier(address _verifier) external onlyOwner {
        if (_verifier == address(0)) revert NullAddress();
        verifier = _verifier;
        emit VerifierUpdated(_verifier);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert NullAddress();
        treasury = IGameTreasury(_treasury);
        emit TreasuryUpdated(_treasury);
    }

    function setSupportedGameConfig(
        uint8   gameType,
        bool    isEnabled,
        uint256 entryCostMiles,
        uint256 maxRewardMiles,
        uint256 maxRewardStable,
        uint256 settlementWindow
    ) external onlyOwner {
        gameConfigs[gameType] = GameConfig({
            isEnabled:        isEnabled,
            entryCostMiles:   entryCostMiles,
            maxRewardMiles:   maxRewardMiles,
            maxRewardStable:  maxRewardStable,
            settlementWindow: settlementWindow
        });
        emit GameConfigUpdated(gameType, isEnabled, entryCostMiles, maxRewardMiles, maxRewardStable, settlementWindow);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
