// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@witnet/solidity/contracts/interfaces/IWitRandomness.sol";
import "@witnet/solidity/contracts/interfaces/IWitRandomnessConsumer.sol";
import {Witnet} from "@witnet/solidity/contracts/libs/Witnet.sol";

contract WitRandomnessMock {
    IWitRandomnessConsumer public consumer;
    uint24 public callbackGasLimit;
    mapping(uint256 => bytes32) public delivered;

    function clone(address) external view returns (IWitRandomness) {
        return IWitRandomness(address(this));
    }

    function settleConsumer(address _consumer, uint24 _callbackGasLimit) external {
        consumer = IWitRandomnessConsumer(_consumer);
        callbackGasLimit = _callbackGasLimit;
    }

    function randomize() external payable returns (uint256) {
        return msg.value;
    }

    function isRandomized(uint256 blockNumber) external view returns (bool) {
        return delivered[blockNumber] != bytes32(0);
    }

    function fetchRandomnessAfter(uint256 blockNumber) external view returns (bytes32) {
        bytes32 randomness = delivered[blockNumber];
        require(randomness != bytes32(0), "MockWitnet: pending");
        return keccak256(abi.encode(blockNumber, bytes8(randomness)));
    }

    function deliver(uint256 blockNumber, bytes32 randomness) external {
        delivered[blockNumber] = randomness;
        consumer.reportRandomness(
            randomness,
            blockNumber,
            block.number,
            Witnet.Timestamp.wrap(uint64(block.timestamp)),
            Witnet.TransactionHash.wrap(bytes32(uint256(1)))
        );
    }

    function setRandomness(uint256 blockNumber, bytes32 randomness) external {
        delivered[blockNumber] = randomness;
    }
}
