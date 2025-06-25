import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  Approval,
  BrokerUpdated,
  ExchangeUpdated,
  Initialized,
  OwnershipTransferred,
  Transfer,
  TransferComment,
  ValidatorsUpdated
} from "../generated/StableTokenV2/StableTokenV2"

export function createApprovalEvent(
  owner: Address,
  spender: Address,
  value: BigInt
): Approval {
  let approvalEvent = changetype<Approval>(newMockEvent())

  approvalEvent.parameters = new Array()

  approvalEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  )
  approvalEvent.parameters.push(
    new ethereum.EventParam("spender", ethereum.Value.fromAddress(spender))
  )
  approvalEvent.parameters.push(
    new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(value))
  )

  return approvalEvent
}

export function createBrokerUpdatedEvent(broker: Address): BrokerUpdated {
  let brokerUpdatedEvent = changetype<BrokerUpdated>(newMockEvent())

  brokerUpdatedEvent.parameters = new Array()

  brokerUpdatedEvent.parameters.push(
    new ethereum.EventParam("broker", ethereum.Value.fromAddress(broker))
  )

  return brokerUpdatedEvent
}

export function createExchangeUpdatedEvent(exchange: Address): ExchangeUpdated {
  let exchangeUpdatedEvent = changetype<ExchangeUpdated>(newMockEvent())

  exchangeUpdatedEvent.parameters = new Array()

  exchangeUpdatedEvent.parameters.push(
    new ethereum.EventParam("exchange", ethereum.Value.fromAddress(exchange))
  )

  return exchangeUpdatedEvent
}

export function createInitializedEvent(version: i32): Initialized {
  let initializedEvent = changetype<Initialized>(newMockEvent())

  initializedEvent.parameters = new Array()

  initializedEvent.parameters.push(
    new ethereum.EventParam(
      "version",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(version))
    )
  )

  return initializedEvent
}

export function createOwnershipTransferredEvent(
  previousOwner: Address,
  newOwner: Address
): OwnershipTransferred {
  let ownershipTransferredEvent =
    changetype<OwnershipTransferred>(newMockEvent())

  ownershipTransferredEvent.parameters = new Array()

  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam(
      "previousOwner",
      ethereum.Value.fromAddress(previousOwner)
    )
  )
  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam("newOwner", ethereum.Value.fromAddress(newOwner))
  )

  return ownershipTransferredEvent
}

export function createTransferEvent(
  from: Address,
  to: Address,
  value: BigInt
): Transfer {
  let transferEvent = changetype<Transfer>(newMockEvent())

  transferEvent.parameters = new Array()

  transferEvent.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from))
  )
  transferEvent.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to))
  )
  transferEvent.parameters.push(
    new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(value))
  )

  return transferEvent
}

export function createTransferCommentEvent(comment: string): TransferComment {
  let transferCommentEvent = changetype<TransferComment>(newMockEvent())

  transferCommentEvent.parameters = new Array()

  transferCommentEvent.parameters.push(
    new ethereum.EventParam("comment", ethereum.Value.fromString(comment))
  )

  return transferCommentEvent
}

export function createValidatorsUpdatedEvent(
  validators: Address
): ValidatorsUpdated {
  let validatorsUpdatedEvent = changetype<ValidatorsUpdated>(newMockEvent())

  validatorsUpdatedEvent.parameters = new Array()

  validatorsUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "validators",
      ethereum.Value.fromAddress(validators)
    )
  )

  return validatorsUpdatedEvent
}
