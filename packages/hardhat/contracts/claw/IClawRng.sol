// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IClawRng
/// @notice Randomness interface for AkibaClawGame.
///
///         Two settlement modes are supported:
///
///         Mode A — VRF-based (Pyth / Chainlink cross-chain):
///           requestRandom() → async → isReady() → getRandom() → _mapRoll() in game
///
///         Mode B — Batch/raffle (MerkleBatchRng):
///           requestRandom() assigns a play slot (zero fee)
///           operator calls commitOutcome() off-chain → isReady() → getCommittedClass()
///           game skips _mapRoll() and uses the class directly
///
///         VRF adapters return 0 from getCommittedClass().
///         MerkleBatchRng returns 0 from getRandom() (unused in batch mode).
interface IClawRng {
    /// @notice Native-token fee to request randomness. 0 for batch mode.
    function estimateFee() external view returns (uint256 nativeFee);

    /// @notice Initiate a randomness request keyed to `sessionId`.
    function requestRandom(uint256 sessionId) external payable;

    /// @notice True once the outcome for `sessionId` is available.
    function isReady(uint256 sessionId) external view returns (bool);

    /// @notice VRF mode: draw a number in [0, range). Returns 0 in batch mode.
    function getRandom(uint256 sessionId, uint32 range) external view returns (uint32);

    /// @notice Batch mode: return the pre-committed RewardClass (1–5).
    ///         Returns 0 in VRF mode (game falls back to getRandom + _mapRoll).
    function getCommittedClass(uint256 sessionId) external view returns (uint8);
}
