// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEntropy} from "@pythnetwork/entropy-sdk-solidity/IEntropy.sol";
import {IEntropyConsumer} from "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";
import {IClawRng} from "./IClawRng.sol";

interface IClawGame {
    function settleGame(uint256 sessionId) external;
}

/// @title PythEntropyAdapter
/// @notice Implements IClawRng using Pyth Entropy — the fastest path on Celo.
///
///         Flow (end-to-end ~10 s, i.e. 2 Celo blocks):
///           1. AkibaClawGame calls requestRandom(sessionId){value: fee}
///           2. We forward to entropy.requestWithCallback(provider, userRandom)
///           3. Pyth's Fortuna keeper calls _entropyCallback() within ~1-2 blocks
///           4. entropyCallback() stores randomWord and auto-calls game.settleGame()
///           5. Player sees their result immediately — no keeper poll needed
///
///         If auto-settle reverts (game paused, etc.) the word is still stored;
///         anyone can call settleGame() manually once the game is unpaused.
contract PythEntropyAdapter is Ownable, IEntropyConsumer, IClawRng {

    /* ─────────────────────────── State ─────────────────────────────────────── */

    IEntropy  public entropy;
    address   public provider;
    IClawGame public game;

    /// @dev sequence number → sessionId  (cleared after callback)
    mapping(uint64  => uint256) public seqToSession;
    /// @dev sessionId → sequence number  (used to detect duplicate requests)
    mapping(uint256 => uint64)  public sessionToSeq;
    /// @dev sessionId → stored randomWord  (0 = not yet received)
    ///      Stored as (word == 0 ? 1 : word) to distinguish "zero word" from "not set".
    mapping(uint256 => uint256) public randomWords;

    /* ─────────────────────────── Events ────────────────────────────────────── */

    event RandomnessRequested(uint256 indexed sessionId, uint64 sequence);
    event RandomnessReceived(uint256 indexed sessionId, bytes32 randomNumber);
    event AutoSettleFailed(uint256 indexed sessionId, bytes reason);

    /* ─────────────────────────── Constructor ───────────────────────────────── */

    constructor(
        address _entropy,
        address _provider,
        address _owner
    ) {
        entropy  = IEntropy(_entropy);
        provider = _provider;
        _transferOwnership(_owner);
    }

    /* ─────────────────────────── IClawRng ──────────────────────────────────── */

    /// @inheritdoc IClawRng
    function estimateFee() external view returns (uint256) {
        return entropy.getFee(provider);
    }

    /// @inheritdoc IClawRng
    /// @dev Only the authorised game contract may call this.
    function requestRandom(uint256 sessionId) external payable {
        require(msg.sender == address(game), "PythAdapter: not game");
        require(sessionToSeq[sessionId] == 0, "PythAdapter: already requested");

        uint256 fee = entropy.getFee(provider);
        require(msg.value >= fee, "PythAdapter: insufficient fee");

        // Mix in block data so sessions in the same block get independent seeds.
        bytes32 userRandom = keccak256(abi.encode(sessionId, block.prevrandao, block.number));

        uint64 seq = entropy.requestWithCallback{value: fee}(provider, userRandom);

        sessionToSeq[sessionId] = seq;
        seqToSession[seq]       = sessionId;

        // Refund any overpayment back to the game contract
        if (msg.value > fee) {
            (bool ok,) = msg.sender.call{value: msg.value - fee}("");
            require(ok, "PythAdapter: refund failed");
        }

        emit RandomnessRequested(sessionId, seq);
    }

    /// @inheritdoc IClawRng
    function isReady(uint256 sessionId) external view returns (bool) {
        return randomWords[sessionId] != 0;
    }

    /// @inheritdoc IClawRng
    /// @dev Not used in VRF mode — game uses getRandom() + _mapRoll() instead.
    function getCommittedClass(uint256) external pure returns (uint8) {
        return 0;
    }

    /// @inheritdoc IClawRng
    function getRandom(uint256 sessionId, uint32 range) external view returns (uint32) {
        uint256 word = randomWords[sessionId];
        require(word != 0, "PythAdapter: not ready");
        uint256 raw = (word == 1) ? 0 : word; // undo sentinel
        return uint32(uint256(keccak256(abi.encode(raw, sessionId))) % range);
    }

    /* ─────────────────────────── IEntropyConsumer ───────────────────────────── */

    /// @dev Required by IEntropyConsumer — Pyth uses this to verify the callback source.
    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    /// @dev Called by IEntropyConsumer._entropyCallback() after source verification.
    ///      Stores the randomWord and auto-settles the game session.
    function entropyCallback(
        uint64  sequence,
        address, /* provider */
        bytes32 randomNumber
    ) internal override {
        uint256 sessionId = seqToSession[sequence];
        require(sessionId != 0, "PythAdapter: unknown sequence");
        delete seqToSession[sequence];

        uint256 word = uint256(randomNumber);
        randomWords[sessionId] = (word == 0) ? 1 : word;

        emit RandomnessReceived(sessionId, randomNumber);

        // Auto-settle so the player sees their result the moment randomness arrives.
        // Wrapped in try/catch so a paused game doesn't brick the Pyth callback.
        if (address(game) != address(0)) {
            try game.settleGame(sessionId) {} catch (bytes memory reason) {
                emit AutoSettleFailed(sessionId, reason);
            }
        }
    }

    /* ─────────────────────────── Admin ─────────────────────────────────────── */

    function setGame(address _game) external onlyOwner {
        require(_game != address(0), "zero addr");
        game = IClawGame(_game);
    }

    function setProvider(address _provider) external onlyOwner {
        provider = _provider;
    }

    function setEntropy(address _entropy) external onlyOwner {
        entropy = IEntropy(_entropy);
    }

    function withdrawCelo(address payable to, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "insufficient balance");
        to.transfer(amount);
    }

    receive() external payable {}
}
