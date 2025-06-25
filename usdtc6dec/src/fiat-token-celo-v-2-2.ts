import {
  Approval as ApprovalEvent,
  AuthorizationCanceled as AuthorizationCanceledEvent,
  AuthorizationUsed as AuthorizationUsedEvent,
  Blacklisted as BlacklistedEvent,
  BlacklisterChanged as BlacklisterChangedEvent,
  Burn as BurnEvent,
  FeeCallerChanged as FeeCallerChangedEvent,
  MasterMinterChanged as MasterMinterChangedEvent,
  Mint as MintEvent,
  MinterConfigured as MinterConfiguredEvent,
  MinterRemoved as MinterRemovedEvent,
  OwnershipTransferred as OwnershipTransferredEvent,
  Pause as PauseEvent,
  PauserChanged as PauserChangedEvent,
  RescuerChanged as RescuerChangedEvent,
  Transfer as TransferEvent,
  UnBlacklisted as UnBlacklistedEvent,
  Unpause as UnpauseEvent
} from "../generated/FiatTokenCeloV2_2/FiatTokenCeloV2_2"
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
} from "../generated/schema"

export function handleApproval(event: ApprovalEvent): void {
  let entity = new Approval(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.owner = event.params.owner
  entity.spender = event.params.spender
  entity.value = event.params.value

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleAuthorizationCanceled(
  event: AuthorizationCanceledEvent
): void {
  let entity = new AuthorizationCanceled(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.authorizer = event.params.authorizer
  entity.nonce = event.params.nonce

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleAuthorizationUsed(event: AuthorizationUsedEvent): void {
  let entity = new AuthorizationUsed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.authorizer = event.params.authorizer
  entity.nonce = event.params.nonce

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleBlacklisted(event: BlacklistedEvent): void {
  let entity = new Blacklisted(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity._account = event.params._account

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleBlacklisterChanged(event: BlacklisterChangedEvent): void {
  let entity = new BlacklisterChanged(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.newBlacklister = event.params.newBlacklister

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleBurn(event: BurnEvent): void {
  let entity = new Burn(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.burner = event.params.burner
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleFeeCallerChanged(event: FeeCallerChangedEvent): void {
  let entity = new FeeCallerChanged(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.newAddress = event.params.newAddress

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleMasterMinterChanged(
  event: MasterMinterChangedEvent
): void {
  let entity = new MasterMinterChanged(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.newMasterMinter = event.params.newMasterMinter

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleMint(event: MintEvent): void {
  let entity = new Mint(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.minter = event.params.minter
  entity.to = event.params.to
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleMinterConfigured(event: MinterConfiguredEvent): void {
  let entity = new MinterConfigured(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.minter = event.params.minter
  entity.minterAllowedAmount = event.params.minterAllowedAmount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleMinterRemoved(event: MinterRemovedEvent): void {
  let entity = new MinterRemoved(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.oldMinter = event.params.oldMinter

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleOwnershipTransferred(
  event: OwnershipTransferredEvent
): void {
  let entity = new OwnershipTransferred(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.previousOwner = event.params.previousOwner
  entity.newOwner = event.params.newOwner

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handlePause(event: PauseEvent): void {
  let entity = new Pause(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handlePauserChanged(event: PauserChangedEvent): void {
  let entity = new PauserChanged(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.newAddress = event.params.newAddress

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleRescuerChanged(event: RescuerChangedEvent): void {
  let entity = new RescuerChanged(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.newRescuer = event.params.newRescuer

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleTransfer(event: TransferEvent): void {
  let entity = new Transfer(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.from = event.params.from
  entity.to = event.params.to
  entity.value = event.params.value

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleUnBlacklisted(event: UnBlacklistedEvent): void {
  let entity = new UnBlacklisted(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity._account = event.params._account

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleUnpause(event: UnpauseEvent): void {
  let entity = new Unpause(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
