// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IGameRegistry {
    function isModeActive(bytes32 modeId) external view returns (bool);
    function isGameActive(bytes32 gameId) external view returns (bool);
}

interface ITicketManager {
    function debitTickets(address user, uint256 amount, bytes32 reason) external;
}

interface ICreditVault {
    function debitGameCredits(address user, uint256 amount, bytes32 reason) external;
    function creditRewardCredits(address user, uint256 amount, bytes32 reason) external;
}

interface IRewardTreasury {
    function grantAkibaMilesReward(address user, uint256 amount, bytes32 reason) external;
}

/// @title GameSettlementManager
/// @notice Generic match settlement for all multiplayer games.
///         Game logic lives off-chain. This contract handles:
///           · Entry debit (tickets or credits)
///           · Miles + reward-credit distribution
///           · Result anchoring (replayHash, resultHash)
///           · Replay protection (one settlement per matchId)
///
///         Settlement is authorized via EIP-712 signed SettlementInput from an
///         authorized resolver (the AkibaMiles backend signer key).
/// @dev UUPS upgradeable.
contract GameSettlementManager is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    UUPSUpgradeable
{
    using ECDSA for bytes32;

    // ── Types ─────────────────────────────────────────────────────────────────

    enum MatchStatus {
        None, Created, Funded, InProgress, Completed, Settled, Cancelled, Disputed
    }

    struct MatchConfig {
        bytes32     matchId;
        bytes32     gameId;
        bytes32     modeId;
        address[]   players;
        uint256     createdAt;
        MatchStatus status;
    }

    struct SettlementInput {
        bytes32 matchId;
        bytes32 gameId;
        bytes32 modeId;
        address winner;
        address loser;
        uint256 winnerScore;
        uint256 loserScore;
        uint256 winnerMilesReward;        // 1e18 units
        uint256 loserMilesReward;         // 1e18 units
        uint256 winnerRewardCreditUsdt;   // USDT base units; 0 for Quick Duel
        bytes32 replayHash;
        bytes32 resultHash;
    }

    // ── EIP-712 typehash ──────────────────────────────────────────────────────

    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "SettlementInput(bytes32 matchId,bytes32 gameId,bytes32 modeId,"
        "address winner,address loser,uint256 winnerScore,uint256 loserScore,"
        "uint256 winnerMilesReward,uint256 loserMilesReward,"
        "uint256 winnerRewardCreditUsdt,bytes32 replayHash,bytes32 resultHash)"
    );

    // ── State ─────────────────────────────────────────────────────────────────

    IGameRegistry   public registry;
    ITicketManager  public ticketManager;
    ICreditVault    public creditVault;
    IRewardTreasury public rewardTreasury;

    mapping(bytes32 => MatchConfig) public matches;
    mapping(bytes32 => bool)        public settledMatches;
    mapping(address => bool)        public authorizedResolvers;

    // ── Events ────────────────────────────────────────────────────────────────

    event MatchCreated(
        bytes32 indexed matchId,
        bytes32 indexed gameId,
        bytes32 indexed modeId,
        address[] players
    );
    event MatchFunded(bytes32 indexed matchId);
    event MatchSettled(
        bytes32 indexed matchId,
        bytes32 indexed gameId,
        bytes32 indexed modeId,
        address winner,
        address loser,
        uint256 winnerScore,
        uint256 loserScore,
        bytes32 replayHash,
        bytes32 resultHash
    );
    event MatchCancelled(bytes32 indexed matchId, string reason);
    event ResolverUpdated(address indexed resolver, bool authorized);
    event ContractsUpdated(address ticketManager, address creditVault, address rewardTreasury);

    // ── Errors ────────────────────────────────────────────────────────────────

    error Unauthorized();
    error MatchAlreadyExists();
    error MatchNotFound();
    error AlreadySettled();
    error InvalidSignature();
    error GameOrModeInactive();
    error InvalidPlayers();
    error ZeroAddress();

    modifier onlyResolver() {
        if (!authorizedResolvers[msg.sender]) revert Unauthorized();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _registry) external initializer {
        if (_registry == address(0)) revert ZeroAddress();
        __Ownable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __EIP712_init("GameSettlementManager", "1");
        __UUPSUpgradeable_init();

        registry = IGameRegistry(_registry);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Match lifecycle ───────────────────────────────────────────────────────

    /// @notice Backend resolver creates a match after pairing players.
    function createMatch(
        bytes32   matchId,
        bytes32   gameId,
        bytes32   modeId,
        address[] calldata players
    ) external onlyResolver whenNotPaused {
        if (matches[matchId].createdAt != 0)        revert MatchAlreadyExists();
        if (!registry.isGameActive(gameId))          revert GameOrModeInactive();
        if (!registry.isModeActive(modeId))          revert GameOrModeInactive();
        if (players.length < 2)                      revert InvalidPlayers();

        matches[matchId] = MatchConfig(
            matchId, gameId, modeId, players, block.timestamp, MatchStatus.Created
        );
        emit MatchCreated(matchId, gameId, modeId, players);
    }

    /// @notice Resolver marks match funded after entry debits are confirmed.
    function fundMatch(bytes32 matchId) external onlyResolver {
        MatchConfig storage m = _requireMatch(matchId);
        m.status = MatchStatus.Funded;
        emit MatchFunded(matchId);
    }

    /// @notice Settle a completed match using an EIP-712 signature from an authorized resolver.
    ///         Anyone may call; the resolver's signature is the authorization.
    function settleMatch(
        SettlementInput calldata input,
        bytes calldata resolverSignature
    ) external nonReentrant whenNotPaused {
        if (settledMatches[input.matchId]) revert AlreadySettled();

        // Verify EIP-712 signature
        bytes32 structHash = keccak256(abi.encode(
            SETTLEMENT_TYPEHASH,
            input.matchId,
            input.gameId,
            input.modeId,
            input.winner,
            input.loser,
            input.winnerScore,
            input.loserScore,
            input.winnerMilesReward,
            input.loserMilesReward,
            input.winnerRewardCreditUsdt,
            input.replayHash,
            input.resultHash
        ));
        address signer = _hashTypedDataV4(structHash).recover(resolverSignature);
        if (!authorizedResolvers[signer]) revert InvalidSignature();

        // Mark settled before external calls (CEI)
        settledMatches[input.matchId] = true;
        if (matches[input.matchId].createdAt != 0) {
            matches[input.matchId].status = MatchStatus.Settled;
        }

        bytes32 matchReason = input.matchId;

        // AkibaMiles rewards
        if (input.winnerMilesReward > 0) {
            rewardTreasury.grantAkibaMilesReward(input.winner, input.winnerMilesReward, matchReason);
        }
        if (input.loserMilesReward > 0) {
            rewardTreasury.grantAkibaMilesReward(input.loser, input.loserMilesReward, matchReason);
        }

        // Reward credit (USDT) for winner — Reward Duel only
        if (input.winnerRewardCreditUsdt > 0) {
            creditVault.creditRewardCredits(input.winner, input.winnerRewardCreditUsdt, matchReason);
        }

        emit MatchSettled(
            input.matchId,
            input.gameId,
            input.modeId,
            input.winner,
            input.loser,
            input.winnerScore,
            input.loserScore,
            input.replayHash,
            input.resultHash
        );
    }

    function cancelMatch(bytes32 matchId, string calldata reason) external onlyResolver {
        MatchConfig storage m = _requireMatch(matchId);
        m.status = MatchStatus.Cancelled;
        emit MatchCancelled(matchId, reason);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setAuthorizedResolver(address resolver, bool authorized) external onlyOwner {
        authorizedResolvers[resolver] = authorized;
        emit ResolverUpdated(resolver, authorized);
    }

    function setContracts(
        address _ticketManager,
        address _creditVault,
        address _rewardTreasury
    ) external onlyOwner {
        ticketManager  = ITicketManager(_ticketManager);
        creditVault    = ICreditVault(_creditVault);
        rewardTreasury = IRewardTreasury(_rewardTreasury);
        emit ContractsUpdated(_ticketManager, _creditVault, _rewardTreasury);
    }

    function setRegistry(address _registry) external onlyOwner {
        if (_registry == address(0)) revert ZeroAddress();
        registry = IGameRegistry(_registry);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _requireMatch(bytes32 matchId) internal view returns (MatchConfig storage m) {
        m = matches[matchId];
        if (m.createdAt == 0) revert MatchNotFound();
    }

    // ── Storage gap ───────────────────────────────────────────────────────────
    uint256[50] private __gap;
}
