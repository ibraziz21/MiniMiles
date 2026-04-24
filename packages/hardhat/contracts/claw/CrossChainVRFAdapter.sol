// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OApp, Origin, MessagingFee} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";
import {OptionsBuilder} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OptionsBuilder.sol";
import {IClawRng} from "./IClawRng.sol";

interface IClawGame {
    function settleGame(uint256 sessionId) external;
}

/// @title CrossChainVRFAdapter
/// @notice Deployed on Celo. Implements IClawRng by forwarding requests to
///         ClawVRFBridge on OP Mainnet via LayerZero v2, then receiving the
///         result back.
///
///         Flow:
///           1. AkibaClawGame calls requestRandom(sessionId){value: fee}
///           2. This contract sends an LZ message to OP: abi.encode(sessionId)
///           3. ClawVRFBridge on OP requests Chainlink VRF, stores result
///           4. Keeper calls ClawVRFBridge.relay(sessionId) on OP
///           5. OP bridge sends LZ message back: abi.encode(sessionId, randomWord)
///           6. _lzReceive stores randomWord — isReady() → true
///           7. AkibaClawGame calls settleGame(), which calls getRandom()
///
///         Fund this contract with CELO to cover LZ outbound fees.
///         Only the authorised game contract may call requestRandom().
contract CrossChainVRFAdapter is OApp, IClawRng {
    using OptionsBuilder for bytes;

    /* ─────────────────────────── State ─────────────────────────────────────── */

    /// @notice LayerZero endpoint ID for OP Mainnet (LZ v2 = 30111).
    uint32 public opEid;

    /// @notice Gas forwarded to lzReceive on OP (covers VRF sub-call).
    uint128 public lzReceiveGasLimit;

    /// @notice Stored random words keyed by sessionId (set to 1 as sentinel when 0 is drawn).
    mapping(uint256 sessionId => uint256 word) public randomWords;

    /// @notice The only address allowed to call requestRandom (the game contract).
    IClawGame public game;

    /* ─────────────────────────── Events ────────────────────────────────────── */

    event RandomnessRequested(uint256 indexed sessionId);
    event RandomnessReceived(uint256 indexed sessionId, uint256 randomWord);
    event AutoSettleFailed(uint256 indexed sessionId, bytes reason);

    /* ─────────────────────────── Constructor ───────────────────────────────── */

    constructor(
        address _lzEndpoint,
        address _owner,
        uint32  _opEid,
        uint128 _lzReceiveGasLimit
    ) OApp(_lzEndpoint, _owner) {
        opEid             = _opEid;
        lzReceiveGasLimit = _lzReceiveGasLimit;
    }

    /* ─────────────────────────── IClawRng ──────────────────────────────────── */

    /// @inheritdoc IClawRng
    function estimateFee() external view returns (uint256) {
        (MessagingFee memory fee,) = _quoteSend(0);
        return fee.nativeFee;
    }

    /// @inheritdoc IClawRng
    /// @dev Only callable by the authorised game contract.
    function requestRandom(uint256 sessionId) external payable {
        require(msg.sender == address(game), "VRFAdapter: not game");
        require(randomWords[sessionId] == 0, "VRFAdapter: already requested");

        (MessagingFee memory fee, bytes memory options) = _quoteSend(0);
        require(msg.value >= fee.nativeFee, "VRFAdapter: insufficient fee");

        bytes memory payload = abi.encode(sessionId);
        _lzSend(opEid, payload, options, MessagingFee(msg.value, 0), payable(msg.sender));

        emit RandomnessRequested(sessionId);
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
        require(word != 0, "VRFAdapter: not ready");
        // Decode the sentinel: stored word is (raw ^ 1) when raw == 0.
        uint256 raw  = word == 1 ? 0 : word;
        return uint32(uint256(keccak256(abi.encode(raw, sessionId))) % range);
    }

    /* ─────────────────────────── LZ receive ────────────────────────────────── */

    /// @dev Called by the LZ endpoint when ClawVRFBridge sends a result back.
    ///      Payload: abi.encode(uint256 sessionId, uint256 randomWord)
    function _lzReceive(
        Origin calldata origin,
        bytes32, /*guid*/
        bytes calldata payload,
        address, /*executor*/
        bytes calldata /*extraData*/
    ) internal override {
        // OApp enforces that origin.srcEid + origin.sender match the peer set by setPeer().
        // No additional auth needed here.
        require(origin.srcEid == opEid, "VRFAdapter: wrong srcEid");

        (uint256 sessionId, uint256 word) = abi.decode(payload, (uint256, uint256));

        // Sentinel: store 1 if the raw word is 0 (so isReady() can distinguish "not set" from zero).
        randomWords[sessionId] = (word == 0) ? 1 : word;

        emit RandomnessReceived(sessionId, word);

        // Auto-settle immediately so no keeper is needed on the Celo side.
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

    function setOpEid(uint32 _eid) external onlyOwner {
        opEid = _eid;
    }

    function setLzReceiveGasLimit(uint128 gas) external onlyOwner {
        lzReceiveGasLimit = gas;
    }

    /// @notice Withdraw excess CELO. Normally the contract should hold just
    ///         enough for pending requests.
    function withdrawCelo(address payable to, uint256 amount) external onlyOwner {
        to.transfer(amount);
    }

    receive() external payable {}

    /* ─────────────────────────── Internal ──────────────────────────────────── */

    function _quoteSend(uint128 extraNative)
        internal
        view
        returns (MessagingFee memory fee, bytes memory options)
    {
        options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(lzReceiveGasLimit, extraNative);
        // Dummy payload for quoting (sessionId = 0).
        fee = _quote(opEid, abi.encode(uint256(0)), options, false);
    }
}
