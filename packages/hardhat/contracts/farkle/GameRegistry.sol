// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @title GameRegistry
/// @notice Registers games and modes. Pure configuration — no funds held.
/// @dev UUPS upgradeable.
contract GameRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {

    enum EntryCurrency { NONE, AKIBA_TICKET, GAME_CREDIT, USDT }
    enum RewardType    { NONE, AKIBAMILES, REWARD_CREDIT, MIXED }

    struct Game {
        bytes32 gameId;
        string  name;
        bool    active;
        address resolver;
        uint256 createdAt;
    }

    struct GameMode {
        bytes32        modeId;
        bytes32        gameId;
        string         name;
        uint8          playerCount;
        uint256        targetScore;
        EntryCurrency  entryCurrency;
        uint256        entryAmount;
        RewardType     rewardType;
        bool           active;
    }

    mapping(bytes32 => Game)     public games;
    mapping(bytes32 => GameMode) public gameModes;
    bytes32[] public gameIds;
    bytes32[] public modeIds;

    event GameRegistered(bytes32 indexed gameId, string name, address resolver);
    event GameModeRegistered(bytes32 indexed modeId, bytes32 indexed gameId, string name);
    event GameStatusUpdated(bytes32 indexed gameId, bool active);
    event GameModeStatusUpdated(bytes32 indexed modeId, bool active);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize() external initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Mutators ──────────────────────────────────────────────────────────────

    function registerGame(
        bytes32 gameId,
        string calldata name,
        address resolver
    ) external onlyOwner {
        require(games[gameId].createdAt == 0, "already registered");
        games[gameId] = Game(gameId, name, true, resolver, block.timestamp);
        gameIds.push(gameId);
        emit GameRegistered(gameId, name, resolver);
    }

    function setGameActive(bytes32 gameId, bool active) external onlyOwner {
        require(games[gameId].createdAt != 0, "unknown game");
        games[gameId].active = active;
        emit GameStatusUpdated(gameId, active);
    }

    function registerGameMode(
        bytes32        modeId,
        bytes32        gameId,
        string calldata name,
        uint8          playerCount,
        uint256        targetScore,
        EntryCurrency  entryCurrency,
        uint256        entryAmount,
        RewardType     rewardType
    ) external onlyOwner {
        require(games[gameId].createdAt != 0, "unknown game");
        require(gameModes[modeId].gameId == bytes32(0), "mode exists");
        gameModes[modeId] = GameMode(
            modeId, gameId, name, playerCount, targetScore,
            entryCurrency, entryAmount, rewardType, true
        );
        modeIds.push(modeId);
        emit GameModeRegistered(modeId, gameId, name);
    }

    function setGameModeActive(bytes32 modeId, bool active) external onlyOwner {
        require(gameModes[modeId].gameId != bytes32(0), "unknown mode");
        gameModes[modeId].active = active;
        emit GameModeStatusUpdated(modeId, active);
    }

    function setResolver(bytes32 gameId, address resolver) external onlyOwner {
        require(games[gameId].createdAt != 0, "unknown game");
        games[gameId].resolver = resolver;
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function isGameActive(bytes32 gameId) external view returns (bool) {
        return games[gameId].active;
    }

    function isModeActive(bytes32 modeId) external view returns (bool) {
        return gameModes[modeId].active;
    }

    function getGameCount() external view returns (uint256) { return gameIds.length; }
    function getModeCount() external view returns (uint256) { return modeIds.length; }

    // ── Storage gap ───────────────────────────────────────────────────────────
    uint256[50] private __gap;
}
