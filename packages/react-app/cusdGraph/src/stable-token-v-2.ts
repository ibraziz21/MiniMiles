import {
  Approval as ApprovalEvent,
  BrokerUpdated as BrokerUpdatedEvent,
  ExchangeUpdated as ExchangeUpdatedEvent,
  Initialized as InitializedEvent,
  OwnershipTransferred as OwnershipTransferredEvent,
  Transfer as TransferEvent,
  TransferComment as TransferCommentEvent,
  ValidatorsUpdated as ValidatorsUpdatedEvent
} from "../generated/StableTokenV2/StableTokenV2"
import {
  Approval,
  BrokerUpdated,
  ExchangeUpdated,
  Initialized,
  OwnershipTransferred,
  Transfer,
  TransferComment,
  ValidatorsUpdated
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

export function handleBrokerUpdated(event: BrokerUpdatedEvent): void {
  let entity = new BrokerUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.broker = event.params.broker

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleExchangeUpdated(event: ExchangeUpdatedEvent): void {
  let entity = new ExchangeUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.exchange = event.params.exchange

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleInitialized(event: InitializedEvent): void {
  let entity = new Initialized(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.version = event.params.version

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

export function handleTransferComment(event: TransferCommentEvent): void {
  let entity = new TransferComment(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.comment = event.params.comment

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleValidatorsUpdated(event: ValidatorsUpdatedEvent): void {
  let entity = new ValidatorsUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.validators = event.params.validators

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
