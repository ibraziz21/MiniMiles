import {
  AdminChanged as AdminChangedEvent,
  BeaconUpgraded as BeaconUpgradedEvent,
  Initialized as InitializedEvent,
  MultiWinnersSelected as MultiWinnersSelectedEvent,
  OwnershipTransferred as OwnershipTransferredEvent,
  ParticipantJoined as ParticipantJoinedEvent,
  RaffleClosed as RaffleClosedEvent,
  RandomnessRequested as RandomnessRequestedEvent,
  RoundCreated as RoundCreatedEvent,
  Upgraded as UpgradedEvent,
  WinnerSelected as WinnerSelectedEvent,
  Withdraw as WithdrawEvent
} from "../generated/AkibaRaffleV3/AkibaRaffleV3"
import {
  AdminChanged,
  BeaconUpgraded,
  Initialized,
  MultiWinnersSelected,
  OwnershipTransferred,
  ParticipantJoined,
  RaffleClosed,
  RandomnessRequested,
  RoundCreated,
  Upgraded,
  WinnerSelected,
  Withdraw
} from "../generated/schema"
import { Bytes } from "@graphprotocol/graph-ts"

export function handleAdminChanged(event: AdminChangedEvent): void {
  let entity = new AdminChanged(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.previousAdmin = event.params.previousAdmin
  entity.newAdmin = event.params.newAdmin

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleBeaconUpgraded(event: BeaconUpgradedEvent): void {
  let entity = new BeaconUpgraded(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.beacon = event.params.beacon

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

export function handleMultiWinnersSelected(
  event: MultiWinnersSelectedEvent
): void {
  let entity = new MultiWinnersSelected(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.roundId = event.params.roundId
  entity.winners = changetype<Bytes[]>(event.params.winners)
  entity.amounts = event.params.amounts

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

export function handleParticipantJoined(event: ParticipantJoinedEvent): void {
  let entity = new ParticipantJoined(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.roundId = event.params.roundId
  entity.participant = event.params.participant
  entity.tickets = event.params.tickets

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleRaffleClosed(event: RaffleClosedEvent): void {
  let entity = new RaffleClosed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.roundId = event.params.roundId

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleRandomnessRequested(
  event: RandomnessRequestedEvent
): void {
  let entity = new RandomnessRequested(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.roundId = event.params.roundId
  entity.witnetBlock = event.params.witnetBlock

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleRoundCreated(event: RoundCreatedEvent): void {
  let entity = new RoundCreated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.roundId = event.params.roundId
  entity.startTime = event.params.startTime
  entity.endTime = event.params.endTime
  entity.rewardPool = event.params.rewardPool
  entity.rewardToken = event.params.rewardToken
  entity.maxTickets = event.params.maxTickets
  entity.ticketCostPoints = event.params.ticketCostPoints
  entity.roundType = event.params.roundType

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleUpgraded(event: UpgradedEvent): void {
  let entity = new Upgraded(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.implementation = event.params.implementation

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleWinnerSelected(event: WinnerSelectedEvent): void {
  let entity = new WinnerSelected(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.roundId = event.params.roundId
  entity.winner = event.params.winner
  entity.reward = event.params.reward

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleWithdraw(event: WithdrawEvent): void {
  let entity = new Withdraw(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.token = event.params.token
  entity.to = event.params.to
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
