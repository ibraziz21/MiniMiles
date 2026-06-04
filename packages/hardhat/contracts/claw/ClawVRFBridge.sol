// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {ILayerZeroReceiver, Origin} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroReceiver.sol";
import {ILayerZeroEndpointV2, MessagingParams, MessagingFee} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {OptionsBuilder} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OptionsBuilder.sol";

/// @title ClawVRFBridge
/// @notice Deployed on OP Mainnet. Receives randomness requests from Celo via
///         LayerZero, fulfils them with Chainlink VRF v2.5, then relays the
///         result back to Celo.
///
///         Inherits Chainlink's ConfirmedOwner (via VRFConsumerBaseV2Plus) for
///         access control. Implements ILayerZeroReceiver directly to avoid the
///         OZ Ownable conflict that would arise from inheriting OApp.
///
///         Two-step relay pattern:
///           fulfillRandomWords() — stores result (cheap, safe from Chainlink callback)
///           relay(sessionId)     — sends LZ message back; called by keeper / anyone
///
///         Fund this contract with ETH (for LZ return fees) and add it as a
///         consumer on the Chainlink VRF subscription (for LINK fees).
contract ClawVRFBridge is VRFConsumerBaseV2Plus, ILayerZeroReceiver {
    using OptionsBuilder for bytes;

    /* ─────────────────────────── State ─────────────────────────────────────── */

    IVRFCoordinatorV2Plus    public coordinator;
    ILayerZeroEndpointV2     public endpoint;

    bytes32  public keyHash;
    uint256  public subscriptionId;
    uint16   public requestConfirmations;
    uint32   public callbackGasLimit;

    /// @notice LayerZero EID for Celo mainnet (LZ v2 = 30125).
    uint32   public celoEid;
    /// @notice Trusted peer on Celo (CrossChainVRFAdapter address, as bytes32).
    bytes32  public celoPeer;
    /// @notice Gas forwarded to lzReceive on Celo when relaying the result back.
    uint128  public lzReceiveGasLimit;

    /// @notice VRF request ID → sessionId.
    mapping(uint256 => uint256) public vrfToSession;

    /// @notice Fulfilled random words waiting to be relayed (sessionId → word).
    ///         Deleted after relay().
    mapping(uint256 => uint256) public pendingResults;

    /* ─────────────────────────── Events ────────────────────────────────────── */

    event VRFRequested(uint256 indexed sessionId, uint256 vrfRequestId);
    event VRFFulfilled(uint256 indexed sessionId, uint256 randomWord);
    event Relayed(uint256 indexed sessionId);

    /* ─────────────────────────── Constructor ───────────────────────────────── */

    constructor(
        address _vrfCoordinator,
        address _lzEndpoint,
        bytes32 _keyHash,
        uint256 _subscriptionId,
        uint16  _requestConfirmations,
        uint32  _callbackGasLimit,
        uint32  _celoEid,
        uint128 _lzReceiveGasLimit
    ) VRFConsumerBaseV2Plus(_vrfCoordinator) {
        coordinator          = IVRFCoordinatorV2Plus(_vrfCoordinator);
        endpoint             = ILayerZeroEndpointV2(_lzEndpoint);
        keyHash              = _keyHash;
        subscriptionId       = _subscriptionId;
        requestConfirmations = _requestConfirmations;
        callbackGasLimit     = _callbackGasLimit;
        celoEid              = _celoEid;
        lzReceiveGasLimit    = _lzReceiveGasLimit;
    }

    /* ─────────────────────────── ILayerZeroReceiver ────────────────────────── */

    /// @dev Called by the LZ endpoint when CrossChainVRFAdapter sends a request.
    ///      Payload: abi.encode(uint256 sessionId)
    function lzReceive(
        Origin calldata origin,
        bytes32, /*guid*/
        bytes calldata message,
        address, /*executor*/
        bytes calldata /*extraData*/
    ) external payable override {
        require(msg.sender == address(endpoint),    "Bridge: not endpoint");
        require(origin.srcEid == celoEid,           "Bridge: wrong srcEid");
        require(origin.sender == celoPeer,          "Bridge: untrusted peer");

        uint256 sessionId = abi.decode(message, (uint256));

        uint256 vrfRequestId = coordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash:              keyHash,
                subId:                subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit:     callbackGasLimit,
                numWords:             1,
                extraArgs:            VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );

        vrfToSession[vrfRequestId] = sessionId;
        emit VRFRequested(sessionId, vrfRequestId);
    }

    /// @dev OApp-style path init — allow inbound from trusted Celo peer only.
    function allowInitializePath(Origin calldata origin) external view override returns (bool) {
        return origin.srcEid == celoEid && origin.sender == celoPeer;
    }

    /// @dev Unordered messaging (nonce = 0 for all).
    function nextNonce(uint32, bytes32) external pure override returns (uint64) {
        return 0;
    }

    /* ─────────────────────────── Chainlink callback ────────────────────────── */

    /// @dev Step 1 of two-step relay: store the result only (very cheap).
    ///      Keeping this lean ensures Chainlink can always deliver the callback.
    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords_)
        internal
        override
    {
        uint256 sessionId = vrfToSession[requestId];
        require(sessionId != 0, "Bridge: unknown request");
        delete vrfToSession[requestId];

        pendingResults[sessionId] = randomWords_[0];
        emit VRFFulfilled(sessionId, randomWords_[0]);
    }

    /* ─────────────────────────── Relay (keeper / anyone) ───────────────────── */

    /// @notice Send the stored random word back to Celo. ETH fee comes from the
    ///         contract's balance, topped up by the owner periodically.
    ///         Callable by any address — the result is already public on-chain.
    function relay(uint256 sessionId) external {
        uint256 word = pendingResults[sessionId];
        require(word != 0, "Bridge: no pending result");
        delete pendingResults[sessionId];

        bytes memory payload = abi.encode(sessionId, word);
        bytes memory options = OptionsBuilder.newOptions()
            .addExecutorLzReceiveOption(lzReceiveGasLimit, 0);

        MessagingFee memory fee = endpoint.quote(
            MessagingParams({
                dstEid:       celoEid,
                receiver:     celoPeer,
                message:      payload,
                options:      options,
                payInLzToken: false
            }),
            address(this)
        );

        require(address(this).balance >= fee.nativeFee, "Bridge: insufficient ETH");

        endpoint.send{value: fee.nativeFee}(
            MessagingParams({
                dstEid:       celoEid,
                receiver:     celoPeer,
                message:      payload,
                options:      options,
                payInLzToken: false
            }),
            address(this) // refund to self
        );

        emit Relayed(sessionId);
    }

    /// @notice Quote the ETH cost of relaying a session result back to Celo.
    function quoteRelay(uint256 sessionId) external view returns (uint256 nativeFee) {
        bytes memory payload = abi.encode(sessionId, pendingResults[sessionId]);
        bytes memory options = OptionsBuilder.newOptions()
            .addExecutorLzReceiveOption(lzReceiveGasLimit, 0);
        MessagingFee memory fee = endpoint.quote(
            MessagingParams({
                dstEid:       celoEid,
                receiver:     celoPeer,
                message:      payload,
                options:      options,
                payInLzToken: false
            }),
            address(this)
        );
        nativeFee = fee.nativeFee;
    }

    /* ─────────────────────────── Admin (Chainlink ConfirmedOwner) ───────────── */

    function setCeloPeer(bytes32 _peer) external onlyOwner { celoPeer = _peer; }
    function setCeloEid(uint32 _eid) external onlyOwner { celoEid = _eid; }
    function setKeyHash(bytes32 _kh) external onlyOwner { keyHash = _kh; }
    function setSubscriptionId(uint256 _sid) external onlyOwner { subscriptionId = _sid; }
    function setRequestConfirmations(uint16 _c) external onlyOwner { requestConfirmations = _c; }
    function setCallbackGasLimit(uint32 _g) external onlyOwner { callbackGasLimit = _g; }
    function setLzReceiveGasLimit(uint128 _g) external onlyOwner { lzReceiveGasLimit = _g; }

    /// @notice Fund the contract with ETH for LZ return fees.
    receive() external payable {}

    function withdrawEth(address payable to, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "insufficient balance");
        to.transfer(amount);
    }
}
