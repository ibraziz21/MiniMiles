import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  Approval,
  AuthorizationCanceled,
  AuthorizationUsed,
  BlockPlaced,
  BlockReleased,
  DestroyedBlockedFunds,
  LogSetFeeCurrencyWrapper,
  Mint,
  OwnershipTransferred,
  Redeem,
  Transfer
} from "../generated/TetherTokenCeloExtension/TetherTokenCeloExtension"

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

export function createAuthorizationCanceledEvent(
  authorizer: Address,
  nonce: Bytes
): AuthorizationCanceled {
  let authorizationCanceledEvent =
    changetype<AuthorizationCanceled>(newMockEvent())

  authorizationCanceledEvent.parameters = new Array()

  authorizationCanceledEvent.parameters.push(
    new ethereum.EventParam(
      "authorizer",
      ethereum.Value.fromAddress(authorizer)
    )
  )
  authorizationCanceledEvent.parameters.push(
    new ethereum.EventParam("nonce", ethereum.Value.fromFixedBytes(nonce))
  )

  return authorizationCanceledEvent
}

export function createAuthorizationUsedEvent(
  authorizer: Address,
  nonce: Bytes
): AuthorizationUsed {
  let authorizationUsedEvent = changetype<AuthorizationUsed>(newMockEvent())

  authorizationUsedEvent.parameters = new Array()

  authorizationUsedEvent.parameters.push(
    new ethereum.EventParam(
      "authorizer",
      ethereum.Value.fromAddress(authorizer)
    )
  )
  authorizationUsedEvent.parameters.push(
    new ethereum.EventParam("nonce", ethereum.Value.fromFixedBytes(nonce))
  )

  return authorizationUsedEvent
}

export function createBlockPlacedEvent(_user: Address): BlockPlaced {
  let blockPlacedEvent = changetype<BlockPlaced>(newMockEvent())

  blockPlacedEvent.parameters = new Array()

  blockPlacedEvent.parameters.push(
    new ethereum.EventParam("_user", ethereum.Value.fromAddress(_user))
  )

  return blockPlacedEvent
}

export function createBlockReleasedEvent(_user: Address): BlockReleased {
  let blockReleasedEvent = changetype<BlockReleased>(newMockEvent())

  blockReleasedEvent.parameters = new Array()

  blockReleasedEvent.parameters.push(
    new ethereum.EventParam("_user", ethereum.Value.fromAddress(_user))
  )

  return blockReleasedEvent
}

export function createDestroyedBlockedFundsEvent(
  _blockedUser: Address,
  _balance: BigInt
): DestroyedBlockedFunds {
  let destroyedBlockedFundsEvent =
    changetype<DestroyedBlockedFunds>(newMockEvent())

  destroyedBlockedFundsEvent.parameters = new Array()

  destroyedBlockedFundsEvent.parameters.push(
    new ethereum.EventParam(
      "_blockedUser",
      ethereum.Value.fromAddress(_blockedUser)
    )
  )
  destroyedBlockedFundsEvent.parameters.push(
    new ethereum.EventParam(
      "_balance",
      ethereum.Value.fromUnsignedBigInt(_balance)
    )
  )

  return destroyedBlockedFundsEvent
}

export function createLogSetFeeCurrencyWrapperEvent(
  feeCurrencyWrapper: Address
): LogSetFeeCurrencyWrapper {
  let logSetFeeCurrencyWrapperEvent =
    changetype<LogSetFeeCurrencyWrapper>(newMockEvent())

  logSetFeeCurrencyWrapperEvent.parameters = new Array()

  logSetFeeCurrencyWrapperEvent.parameters.push(
    new ethereum.EventParam(
      "feeCurrencyWrapper",
      ethereum.Value.fromAddress(feeCurrencyWrapper)
    )
  )

  return logSetFeeCurrencyWrapperEvent
}

export function createMintEvent(_destination: Address, _amount: BigInt): Mint {
  let mintEvent = changetype<Mint>(newMockEvent())

  mintEvent.parameters = new Array()

  mintEvent.parameters.push(
    new ethereum.EventParam(
      "_destination",
      ethereum.Value.fromAddress(_destination)
    )
  )
  mintEvent.parameters.push(
    new ethereum.EventParam(
      "_amount",
      ethereum.Value.fromUnsignedBigInt(_amount)
    )
  )

  return mintEvent
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

export function createRedeemEvent(_amount: BigInt): Redeem {
  let redeemEvent = changetype<Redeem>(newMockEvent())

  redeemEvent.parameters = new Array()

  redeemEvent.parameters.push(
    new ethereum.EventParam(
      "_amount",
      ethereum.Value.fromUnsignedBigInt(_amount)
    )
  )

  return redeemEvent
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
