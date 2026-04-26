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

contract AkibaSkillGames is Ownable, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;

    enum SessionStatus {
        None,
        Started,
        Settled,
        Rejected
    }

    struct GameConfig {
        bool isEnabled;
        uint256 entryCostMiles;
        uint256 maxRewardMiles;
        uint256 maxRewardStable;
        uint256 settlementWindow;
    }

    struct Session {
        uint256 sessionId;
        address player;
        uint8 gameType;
        uint256 entryCost;
        uint64 createdAt;
        bytes32 seedCommitment;
        bool settled;
        uint256 score;
        uint256 rewardMiles;
        uint256 rewardStable;
        SessionStatus status;
    }

    error NullAddress();
    error GameDisabled();
    error UnknownSession();
    error AlreadySettled();
    error BadPlayer();
    error ExpiredSettlement();
    error UnauthorizedSettlement();
    error RewardExceedsConfig();

    IAkibaMilesBurnable public immutable milesToken;
    IGameTreasury public treasury;
    address public verifier;
    uint256 public nextSessionId = 1;

    mapping(uint8 => GameConfig) public gameConfigs;
    mapping(uint256 => Session) public sessions;

    event GameStarted(
        uint256 indexed sessionId,
        address indexed player,
        uint8 indexed gameType,
        uint256 entryCost,
        bytes32 seedCommitment
    );
    event GameSettled(
        uint256 indexed sessionId,
        address indexed player,
        uint8 indexed gameType,
        uint256 score,
        uint256 rewardMiles,
        uint256 rewardStable
    );
    event VerifierUpdated(address indexed verifier);
    event TreasuryUpdated(address indexed treasury);
    event GameConfigUpdated(
        uint8 indexed gameType,
        bool isEnabled,
        uint256 entryCostMiles,
        uint256 maxRewardMiles,
        uint256 maxRewardStable,
        uint256 settlementWindow
    );

    constructor(address _milesToken, address _treasury, address _verifier) {
        if (_milesToken == address(0) || _treasury == address(0) || _verifier == address(0)) {
            revert NullAddress();
        }
        milesToken = IAkibaMilesBurnable(_milesToken);
        treasury = IGameTreasury(_treasury);
        verifier = _verifier;
    }

    function startGame(uint8 gameType, bytes32 seedCommitment)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 sessionId)
    {
        GameConfig memory config = gameConfigs[gameType];
        if (!config.isEnabled) revert GameDisabled();

        if (config.entryCostMiles > 0) {
            milesToken.burn(msg.sender, config.entryCostMiles);
        }

        sessionId = nextSessionId++;
        sessions[sessionId] = Session({
            sessionId: sessionId,
            player: msg.sender,
            gameType: gameType,
            entryCost: config.entryCostMiles,
            createdAt: uint64(block.timestamp),
            seedCommitment: seedCommitment,
            settled: false,
            score: 0,
            rewardMiles: 0,
            rewardStable: 0,
            status: SessionStatus.Started
        });

        emit GameStarted(sessionId, msg.sender, gameType, config.entryCostMiles, seedCommitment);
    }

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

        session.settled = true;
        session.score = score;
        session.rewardMiles = rewardMiles;
        session.rewardStable = rewardStable;
        session.status = SessionStatus.Settled;

        treasury.payout(session.player, rewardMiles, rewardStable);

        emit GameSettled(sessionId, session.player, session.gameType, score, rewardMiles, rewardStable);
    }

    function settlementDigest(
        uint256 sessionId,
        address player,
        uint8 gameType,
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
                sessionId,
                player,
                gameType,
                score,
                rewardMiles,
                rewardStable,
                expiry,
                verifyingContract,
                chainId
            )
        );
    }

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
        uint8 gameType,
        bool isEnabled,
        uint256 entryCostMiles,
        uint256 maxRewardMiles,
        uint256 maxRewardStable,
        uint256 settlementWindow
    ) external onlyOwner {
        gameConfigs[gameType] = GameConfig({
            isEnabled: isEnabled,
            entryCostMiles: entryCostMiles,
            maxRewardMiles: maxRewardMiles,
            maxRewardStable: maxRewardStable,
            settlementWindow: settlementWindow
        });
        emit GameConfigUpdated(
            gameType,
            isEnabled,
            entryCostMiles,
            maxRewardMiles,
            maxRewardStable,
            settlementWindow
        );
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
