import {
  ParticipantJoined as ParticipantJoinedEvent,
  RaffleClosed as RaffleClosedEvent,
  RandomnessRequested as RandomnessRequestedEvent,
  RoundCreated as RoundCreatedEvent,
  WinnerSelected as WinnerSelectedEvent,
} from "../generated/MiniRaffle/MiniRaffle"
import {
  ParticipantJoined,
  RaffleClosed,
  RandomnessRequested,
  RoundCreated,
  WinnerSelected,
} from "../generated/schema"

export function handleParticipantJoined(event: ParticipantJoinedEvent): void {
  let entity = new ParticipantJoined(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.roundId = event.params.roundId
  entity.participant = event.params.participant

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleRaffleClosed(event: RaffleClosedEvent): void {
  let entity = new RaffleClosed(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.roundId = event.params.roundId

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleRandomnessRequested(
  event: RandomnessRequestedEvent,
): void {
  let entity = new RandomnessRequested(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
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
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.roundId = event.params.roundId
  entity.startTime = event.params.startTime
  entity.endTime = event.params.endTime
  entity.rewardPool = event.params.rewardPool
  entity.rewardToken = event.params.rewardToken
  entity.maxTickets = event.params.maxTickets
  entity.ticketCostPoints = event.params.ticketCostPoints

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleWinnerSelected(event: WinnerSelectedEvent): void {
  let entity = new WinnerSelected(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.roundId = event.params.roundId
  entity.winner = event.params.winner

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
