// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IClawRng} from "./IClawRng.sol";

interface IClawGame {
    function settleGame(uint256 sessionId) external;
}

/// @title MerkleBatchRng
/// @notice Implements IClawRng using a pre-committed, shuffled batch of outcomes —
///         a provably fair raffle drum.
///
///         Design:
///           • Admin generates N outcomes off-chain that match the exact prize
///             distribution (e.g. 600 Lose, 320 Common, 60 Rare, 18 Epic, 2 Legendary
///             per 1000 plays). Outcomes are Fisher-Yates shuffled with a secret seed.
///           • The shuffle is committed as a Merkle root. Leaf format:
///               keccak256(abi.encode(batchId, playIndex, rewardClass))
///             double-hashed per OZ standard to prevent second-preimage attacks.
///           • When a player calls startGame(), they are assigned the next playIndex
///             in the active batch.
///           • The operator immediately calls commitOutcome(sessionId, rewardClass, proof).
///             One Merkle-proof verification on-chain proves the outcome was
///             predetermined — settlement is instant.
///           • Prize inventory (prizes remaining by type) is tracked on-chain.
///             The frontend can show "X Legendary / Y Epic / Z Rare... left in this machine".
///           • When all plays are assigned the batch closes; admin opens a new one.
///           • After batch completion, operator publishes the seed. Anyone can
///             re-derive the full shuffle and verify all outcomes were fair.
///
///         Profitability guarantee:
///           Each batch has EXACTLY the configured number of each prize type.
///           No streak of lucky VRF results can produce more winners than planned.
///
///         Settlement latency: ~0 s (same block as startGame in most cases).
contract MerkleBatchRng is Ownable, IClawRng {

    /* ─────────────────────────── Structs ───────────────────────────────────── */

    struct Batch {
        bytes32 merkleRoot;
        uint256 totalPlays;
        uint256 playsAssigned;   // how many sessions have claimed a play slot

        // Prize inventory — decremented as operator commits outcomes.
        // Lets the frontend display "X prizes remaining".
        uint256 losesLeft;
        uint256 commonsLeft;
        uint256 raresLeft;
        uint256 epicsLeft;
        uint256 legendarysLeft;

        bool active;
    }

    struct SessionPlay {
        uint256 batchId;
        uint256 playIndex;
        uint8   committedClass;  // 0 = not yet committed
    }

    /* ─────────────────────────── State ─────────────────────────────────────── */

    IClawGame public game;

    uint256 public activeBatchId;
    mapping(uint256 batchId => Batch) public batches;
    mapping(uint256 sessionId => SessionPlay) public sessionPlays;

    /* ─────────────────────────── Events ────────────────────────────────────── */

    event BatchOpened(uint256 indexed batchId, bytes32 merkleRoot, uint256 totalPlays);
    event BatchClosed(uint256 indexed batchId);
    event PlayAssigned(uint256 indexed sessionId, uint256 indexed batchId, uint256 playIndex);
    event OutcomeCommitted(uint256 indexed sessionId, uint256 indexed batchId, uint256 playIndex, uint8 rewardClass);
    event AutoSettleFailed(uint256 indexed sessionId, bytes reason);

    /* ─────────────────────────── Constructor ───────────────────────────────── */

    constructor(address _owner) {
        _transferOwnership(_owner);
    }

    /* ─────────────────────────── IClawRng ──────────────────────────────────── */

    /// @inheritdoc IClawRng
    /// @dev Batch mode has no on-chain fee.
    function estimateFee() external pure returns (uint256) {
        return 0;
    }

    /// @inheritdoc IClawRng
    /// @dev Claims the next play slot in the active batch. Called by startGame().
    ///      No ETH required (fee = 0).
    function requestRandom(uint256 sessionId) external payable {
        require(msg.sender == address(game), "Batch: not game");

        Batch storage batch = batches[activeBatchId];
        require(batch.active,                              "Batch: no active batch");
        require(batch.playsAssigned < batch.totalPlays,   "Batch: full");

        uint256 playIndex = batch.playsAssigned++;

        sessionPlays[sessionId] = SessionPlay({
            batchId:        activeBatchId,
            playIndex:      playIndex,
            committedClass: 0
        });

        emit PlayAssigned(sessionId, activeBatchId, playIndex);

        // Auto-close when all slots are assigned
        if (batch.playsAssigned == batch.totalPlays) {
            batch.active = false;
            emit BatchClosed(activeBatchId);
        }
    }

    /// @inheritdoc IClawRng
    /// @dev True once operator has committed the Merkle-proven outcome.
    function isReady(uint256 sessionId) external view returns (bool) {
        return sessionPlays[sessionId].committedClass != 0;
    }

    /// @inheritdoc IClawRng
    /// @dev Not used in batch mode. Returns 0. Game uses getCommittedClass() instead.
    function getRandom(uint256, uint32) external pure returns (uint32) {
        return 0;
    }

    /// @inheritdoc IClawRng
    function getCommittedClass(uint256 sessionId) external view returns (uint8) {
        return sessionPlays[sessionId].committedClass;
    }

    /* ─────────────────────────── Operator: commit outcome ──────────────────── */

    /// @notice Reveal and prove the predetermined outcome for a session.
    ///         Called by the backend immediately after observing GameStarted.
    ///         Verifies the Merkle proof, updates prize inventory, and auto-settles.
    ///
    /// @param sessionId   The game session ID.
    /// @param rewardClass The predetermined outcome (1=Lose 2=Common 3=Rare 4=Epic 5=Legendary).
    /// @param proof       Standard Merkle proof against the batch root.
    function commitOutcome(
        uint256 sessionId,
        uint8   rewardClass,
        bytes32[] calldata proof
    ) external {
        SessionPlay storage sp = sessionPlays[sessionId];
        require(sp.batchId != 0,          "Batch: session not registered");
        require(sp.committedClass == 0,   "Batch: already committed");
        require(rewardClass >= 1 && rewardClass <= 5, "Batch: invalid class");

        // Verify the Merkle proof (double-hashed OZ standard leaf)
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(sp.batchId, sp.playIndex, rewardClass)))
        );
        require(
            MerkleProof.verify(proof, batches[sp.batchId].merkleRoot, leaf),
            "Batch: invalid proof"
        );

        // Decrement prize inventory
        _decrementInventory(sp.batchId, rewardClass);

        sp.committedClass = rewardClass;

        emit OutcomeCommitted(sessionId, sp.batchId, sp.playIndex, rewardClass);

        // Auto-settle — one backend call handles everything.
        if (address(game) != address(0)) {
            try game.settleGame(sessionId) {} catch (bytes memory reason) {
                emit AutoSettleFailed(sessionId, reason);
            }
        }
    }

    /* ─────────────────────────── Views ─────────────────────────────────────── */

    /// @notice Returns the prize inventory for a batch — used by the frontend
    ///         to display "X Legendary / Y Epic / ... remaining".
    function getPrizeInventory(uint256 batchId)
        external
        view
        returns (
            uint256 loses,
            uint256 commons,
            uint256 rares,
            uint256 epics,
            uint256 legendarys,
            uint256 totalRemaining,
            uint256 totalPlays
        )
    {
        Batch storage b = batches[batchId];
        loses       = b.losesLeft;
        commons     = b.commonsLeft;
        rares       = b.raresLeft;
        epics       = b.epicsLeft;
        legendarys  = b.legendarysLeft;
        totalRemaining = loses + commons + rares + epics + legendarys;
        totalPlays  = b.totalPlays;
    }

    /// @notice Convenience: returns inventory for the active batch.
    function getActiveBatchInventory()
        external
        view
        returns (
            uint256 batchId,
            uint256 loses,
            uint256 commons,
            uint256 rares,
            uint256 epics,
            uint256 legendarys,
            uint256 totalRemaining,
            uint256 totalPlays,
            bool    active
        )
    {
        batchId = activeBatchId;
        Batch storage b = batches[batchId];
        loses       = b.losesLeft;
        commons     = b.commonsLeft;
        rares       = b.raresLeft;
        epics       = b.epicsLeft;
        legendarys  = b.legendarysLeft;
        totalRemaining = loses + commons + rares + epics + legendarys;
        totalPlays  = b.totalPlays;
        active      = b.active;
    }

    function getSessionPlay(uint256 sessionId) external view returns (SessionPlay memory) {
        return sessionPlays[sessionId];
    }

    /* ─────────────────────────── Admin ─────────────────────────────────────── */

    /// @notice Open a new batch. Only one batch can be active at a time.
    /// @dev    The prize inventory values must sum to totalPlays exactly.
    function openBatch(
        uint256 batchId,
        bytes32 merkleRoot,
        uint256 totalPlays,
        uint256 losesLeft,
        uint256 commonsLeft,
        uint256 raresLeft,
        uint256 epicsLeft,
        uint256 legendarysLeft
    ) external onlyOwner {
        require(!batches[activeBatchId].active, "Batch: previous still active");
        require(merkleRoot != bytes32(0),        "Batch: empty root");
        require(totalPlays > 0,                  "Batch: zero plays");
        require(
            losesLeft + commonsLeft + raresLeft + epicsLeft + legendarysLeft == totalPlays,
            "Batch: inventory != totalPlays"
        );
        require(!batches[batchId].active,        "Batch: id already used");

        batches[batchId] = Batch({
            merkleRoot:     merkleRoot,
            totalPlays:     totalPlays,
            playsAssigned:  0,
            losesLeft:      losesLeft,
            commonsLeft:    commonsLeft,
            raresLeft:      raresLeft,
            epicsLeft:      epicsLeft,
            legendarysLeft: legendarysLeft,
            active:         true
        });

        activeBatchId = batchId;

        emit BatchOpened(batchId, merkleRoot, totalPlays);
    }

    /// @notice Force-close the active batch (e.g. if a session was emergency-refunded
    ///         and a slot was orphaned). Opens space for a new batch to be started.
    function closeBatch(uint256 batchId) external onlyOwner {
        require(batches[batchId].active, "Batch: not active");
        batches[batchId].active = false;
        emit BatchClosed(batchId);
    }

    function setGame(address _game) external onlyOwner {
        require(_game != address(0), "zero addr");
        game = IClawGame(_game);
    }

    /* ─────────────────────────── Internal ──────────────────────────────────── */

    function _decrementInventory(uint256 batchId, uint8 rewardClass) internal {
        Batch storage b = batches[batchId];
        if      (rewardClass == 1) { require(b.losesLeft      > 0, "Batch: no loses left");      b.losesLeft--;      }
        else if (rewardClass == 2) { require(b.commonsLeft     > 0, "Batch: no commons left");    b.commonsLeft--;    }
        else if (rewardClass == 3) { require(b.raresLeft       > 0, "Batch: no rares left");      b.raresLeft--;      }
        else if (rewardClass == 4) { require(b.epicsLeft       > 0, "Batch: no epics left");      b.epicsLeft--;      }
        else if (rewardClass == 5) { require(b.legendarysLeft  > 0, "Batch: no legendarys left"); b.legendarysLeft--; }
    }
}
