import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  Approval,
  AuthorizationCanceled,
  AuthorizationUsed,
  Blacklisted,
  BlacklisterChanged,
  Burn,
  FeeCallerChanged,
  MasterMinterChanged,
  Mint,
  MinterConfigured,
  MinterRemoved,
  OwnershipTransferred,
  Pause,
  PauserChanged,
  RescuerChanged,
  Transfer,
  UnBlacklisted,
  Unpause
} from "../generated/FiatTokenCeloV2_2/FiatTokenCeloV2_2"

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

export function createBlacklistedEvent(_account: Address): Blacklisted {
  let blacklistedEvent = changetype<Blacklisted>(newMockEvent())

  blacklistedEvent.parameters = new Array()

  blacklistedEvent.parameters.push(
    new ethereum.EventParam("_account", ethereum.Value.fromAddress(_account))
  )

  return blacklistedEvent
}

export function createBlacklisterChangedEvent(
  newBlacklister: Address
): BlacklisterChanged {
  let blacklisterChangedEvent = changetype<BlacklisterChanged>(newMockEvent())

  blacklisterChangedEvent.parameters = new Array()

  blacklisterChangedEvent.parameters.push(
    new ethereum.EventParam(
      "newBlacklister",
      ethereum.Value.fromAddress(newBlacklister)
    )
  )

  return blacklisterChangedEvent
}

export function createBurnEvent(burner: Address, amount: BigInt): Burn {
  let burnEvent = changetype<Burn>(newMockEvent())

  burnEvent.parameters = new Array()

  burnEvent.parameters.push(
    new ethereum.EventParam("burner", ethereum.Value.fromAddress(burner))
  )
  burnEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return burnEvent
}

export function createFeeCallerChangedEvent(
  newAddress: Address
): FeeCallerChanged {
  let feeCallerChangedEvent = changetype<FeeCallerChanged>(newMockEvent())

  feeCallerChangedEvent.parameters = new Array()

  feeCallerChangedEvent.parameters.push(
    new ethereum.EventParam(
      "newAddress",
      ethereum.Value.fromAddress(newAddress)
    )
  )

  return feeCallerChangedEvent
}

export function createMasterMinterChangedEvent(
  newMasterMinter: Address
): MasterMinterChanged {
  let masterMinterChangedEvent = changetype<MasterMinterChanged>(newMockEvent())

  masterMinterChangedEvent.parameters = new Array()

  masterMinterChangedEvent.parameters.push(
    new ethereum.EventParam(
      "newMasterMinter",
      ethereum.Value.fromAddress(newMasterMinter)
    )
  )

  return masterMinterChangedEvent
}

export function createMintEvent(
  minter: Address,
  to: Address,
  amount: BigInt
): Mint {
  let mintEvent = changetype<Mint>(newMockEvent())

  mintEvent.parameters = new Array()

  mintEvent.parameters.push(
    new ethereum.EventParam("minter", ethereum.Value.fromAddress(minter))
  )
  mintEvent.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to))
  )
  mintEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return mintEvent
}

export function createMinterConfiguredEvent(
  minter: Address,
  minterAllowedAmount: BigInt
): MinterConfigured {
  let minterConfiguredEvent = changetype<MinterConfigured>(newMockEvent())

  minterConfiguredEvent.parameters = new Array()

  minterConfiguredEvent.parameters.push(
    new ethereum.EventParam("minter", ethereum.Value.fromAddress(minter))
  )
  minterConfiguredEvent.parameters.push(
    new ethereum.EventParam(
      "minterAllowedAmount",
      ethereum.Value.fromUnsignedBigInt(minterAllowedAmount)
    )
  )

  return minterConfiguredEvent
}

export function createMinterRemovedEvent(oldMinter: Address): MinterRemoved {
  let minterRemovedEvent = changetype<MinterRemoved>(newMockEvent())

  minterRemovedEvent.parameters = new Array()

  minterRemovedEvent.parameters.push(
    new ethereum.EventParam("oldMinter", ethereum.Value.fromAddress(oldMinter))
  )

  return minterRemovedEvent
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

export function createPauseEvent(): Pause {
  let pauseEvent = changetype<Pause>(newMockEvent())

  pauseEvent.parameters = new Array()

  return pauseEvent
}

export function createPauserChangedEvent(newAddress: Address): PauserChanged {
  let pauserChangedEvent = changetype<PauserChanged>(newMockEvent())

  pauserChangedEvent.parameters = new Array()

  pauserChangedEvent.parameters.push(
    new ethereum.EventParam(
      "newAddress",
      ethereum.Value.fromAddress(newAddress)
    )
  )

  return pauserChangedEvent
}

export function createRescuerChangedEvent(newRescuer: Address): RescuerChanged {
  let rescuerChangedEvent = changetype<RescuerChanged>(newMockEvent())

  rescuerChangedEvent.parameters = new Array()

  rescuerChangedEvent.parameters.push(
    new ethereum.EventParam(
      "newRescuer",
      ethereum.Value.fromAddress(newRescuer)
    )
  )

  return rescuerChangedEvent
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

export function createUnBlacklistedEvent(_account: Address): UnBlacklisted {
  let unBlacklistedEvent = changetype<UnBlacklisted>(newMockEvent())

  unBlacklistedEvent.parameters = new Array()

  unBlacklistedEvent.parameters.push(
    new ethereum.EventParam("_account", ethereum.Value.fromAddress(_account))
  )

  return unBlacklistedEvent
}

export function createUnpauseEvent(): Unpause {
  let unpauseEvent = changetype<Unpause>(newMockEvent())

  unpauseEvent.parameters = new Array()

  return unpauseEvent
}
