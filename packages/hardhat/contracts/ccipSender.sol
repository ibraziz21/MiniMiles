// SPDX‑License‑Identifier: MIT
pragma solidity ^0.8.24;

/* ────── VRF v2.5‑plus ─────────────────────────────────────────────── */
import {VRFConsumerBaseV2Plus} from
  "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from
  "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/* ────── CCIP (separate NPM package) ───────────────────────────────── */
import {IRouterClient} from
  "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from
  "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";

/* ────── utils ─────────────────────────────────────────────────────── */
import {LinkTokenInterface} from
  "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";


/// @notice  Deploy on **OP Sepolia**.
///          After VRF fulfils, a CCIP message is sent to Celo (Alfajores).
contract VRFSenderCCIP is VRFConsumerBaseV2Plus {
    /* ───── configurable immutables ───── */
    uint256 public immutable subId;          // VRF sub
    bytes32 public immutable keyHash;        // 30 gwei lane on OP Sepolia
    address public immutable celoReceiver;   // raffle on Celo
    LinkTokenInterface public immutable link;

    /* routers / coordinators */
    IRouterClient public immutable router;   // CCIP router (OP chain)
    address constant COORD =
        0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B;        // VRF coord (OP Sepolia)

    uint64  constant CELO_SELECTOR = 3552045678561919002;  // Alfajores selector

    /* gas / conf settings */
    uint32  constant CALLBACK_GAS = 600_000;
    uint16  constant CONFIRMS     = 3;

    /* map VRF request → raffle round */
    mapping(uint256 reqId => uint256 roundId) public roundOf;
    event RandomReady(uint256 indexed roundId, uint256 word);

struct PendingWord {
    uint256 word;
    bool    set;
}
mapping(uint256 => PendingWord) public pending; // roundId => word+flag

    /* ───── ctor ───── */
    constructor(
        uint256 _subId,
        bytes32 _keyHash,
        address _link,
        address _celoReceiver
    ) VRFConsumerBaseV2Plus(COORD)
    {
        subId        = _subId;
        keyHash      = _keyHash;
        router       = IRouterClient(0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59);
        link         = LinkTokenInterface(_link);
        celoReceiver = _celoReceiver;
    }

    /* ───── public: trigger VRF request ───── */
    function requestRandom(uint256 roundId) external onlyOwner returns (uint256) {
        uint256 id = s_vrfCoordinator.requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest({
                keyHash:            keyHash,
                subId:              subId,
                requestConfirmations: CONFIRMS,
                callbackGasLimit:   CALLBACK_GAS,
                numWords:           1,
                extraArgs:          ""            // pay LINK, not native
            })
        );
        roundOf[id] = roundId;
        return id;
    }

    /* ───── VRF callback ───── */
  function fulfillRandomWords(uint256 reqId, uint256[] calldata words)
    internal override
{
    uint256 roundId = roundOf[reqId];
    pending[roundId] = PendingWord({ word: words[0], set: true });
    emit RandomReady(roundId, words[0]);       // < 90 k gas total
}

function sendToCelo(uint256 roundId) external {
    PendingWord memory p = pending[roundId];
    require(p.set, "word not ready");

    Client.EVM2AnyMessage memory msgOut = Client.EVM2AnyMessage({
        receiver:     abi.encode(celoReceiver),
        data:         abi.encode(roundId, p.word),
        tokenAmounts: new Client.EVMTokenAmount[](0),
        extraArgs:    "",
        feeToken:     address(link)
    });

    uint256 fee = router.getFee(CELO_SELECTOR, msgOut);
    link.transferFrom(msg.sender, address(this), fee); // user/bot pays
    link.approve(address(router), fee);

    router.ccipSend(CELO_SELECTOR, msgOut);

    delete pending[roundId];               // prevent re‑use
}

}
