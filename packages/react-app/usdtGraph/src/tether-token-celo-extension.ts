import {
  Approval as ApprovalEvent,
  AuthorizationCanceled as AuthorizationCanceledEvent,
  AuthorizationUsed as AuthorizationUsedEvent,
  BlockPlaced as BlockPlacedEvent,
  BlockReleased as BlockReleasedEvent,
  DestroyedBlockedFunds as DestroyedBlockedFundsEvent,
  LogSetFeeCurrencyWrapper as LogSetFeeCurrencyWrapperEvent,
  Mint as MintEvent,
  OwnershipTransferred as OwnershipTransferredEvent,
  Redeem as RedeemEvent,
  Transfer as TransferEvent
} from "../generated/TetherTokenCeloExtension/TetherTokenCeloExtension"
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

export function handleBlockPlaced(event: BlockPlacedEvent): void {
  let entity = new BlockPlaced(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity._user = event.params._user

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleBlockReleased(event: BlockReleasedEvent): void {
  let entity = new BlockReleased(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity._user = event.params._user

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleDestroyedBlockedFunds(
  event: DestroyedBlockedFundsEvent
): void {
  let entity = new DestroyedBlockedFunds(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity._blockedUser = event.params._blockedUser
  entity._balance = event.params._balance

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleLogSetFeeCurrencyWrapper(
  event: LogSetFeeCurrencyWrapperEvent
): void {
  let entity = new LogSetFeeCurrencyWrapper(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.feeCurrencyWrapper = event.params.feeCurrencyWrapper

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleMint(event: MintEvent): void {
  let entity = new Mint(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity._destination = event.params._destination
  entity._amount = event.params._amount

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

export function handleRedeem(event: RedeemEvent): void {
  let entity = new Redeem(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity._amount = event.params._amount

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
