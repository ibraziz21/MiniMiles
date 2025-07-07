import { newMockEvent } from "matchstick-as"
import { ethereum, BigInt, Address } from "@graphprotocol/graph-ts"
import {
  ParticipantJoined,
  RaffleClosed,
  RandomnessRequested,
  RoundCreated,
  WinnerSelected
} from "../generated/MiniRaffle/MiniRaffle"

export function createParticipantJoinedEvent(
  roundId: BigInt,
  participant: Address
): ParticipantJoined {
  let participantJoinedEvent = changetype<ParticipantJoined>(newMockEvent())

  participantJoinedEvent.parameters = new Array()

  participantJoinedEvent.parameters.push(
    new ethereum.EventParam(
      "roundId",
      ethereum.Value.fromUnsignedBigInt(roundId)
    )
  )
  participantJoinedEvent.parameters.push(
    new ethereum.EventParam(
      "participant",
      ethereum.Value.fromAddress(participant)
    )
  )

  return participantJoinedEvent
}

export function createRaffleClosedEvent(roundId: BigInt): RaffleClosed {
  let raffleClosedEvent = changetype<RaffleClosed>(newMockEvent())

  raffleClosedEvent.parameters = new Array()

  raffleClosedEvent.parameters.push(
    new ethereum.EventParam(
      "roundId",
      ethereum.Value.fromUnsignedBigInt(roundId)
    )
  )

  return raffleClosedEvent
}

export function createRandomnessRequestedEvent(
  roundId: BigInt,
  witnetBlock: BigInt
): RandomnessRequested {
  let randomnessRequestedEvent = changetype<RandomnessRequested>(newMockEvent())

  randomnessRequestedEvent.parameters = new Array()

  randomnessRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "roundId",
      ethereum.Value.fromUnsignedBigInt(roundId)
    )
  )
  randomnessRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "witnetBlock",
      ethereum.Value.fromUnsignedBigInt(witnetBlock)
    )
  )

  return randomnessRequestedEvent
}

export function createRoundCreatedEvent(
  roundId: BigInt,
  startTime: BigInt,
  endTime: BigInt,
  rewardPool: BigInt,
  rewardToken: Address,
  maxTickets: BigInt,
  ticketCostPoints: BigInt
): RoundCreated {
  let roundCreatedEvent = changetype<RoundCreated>(newMockEvent())

  roundCreatedEvent.parameters = new Array()

  roundCreatedEvent.parameters.push(
    new ethereum.EventParam(
      "roundId",
      ethereum.Value.fromUnsignedBigInt(roundId)
    )
  )
  roundCreatedEvent.parameters.push(
    new ethereum.EventParam(
      "startTime",
      ethereum.Value.fromUnsignedBigInt(startTime)
    )
  )
  roundCreatedEvent.parameters.push(
    new ethereum.EventParam(
      "endTime",
      ethereum.Value.fromUnsignedBigInt(endTime)
    )
  )
  roundCreatedEvent.parameters.push(
    new ethereum.EventParam(
      "rewardPool",
      ethereum.Value.fromUnsignedBigInt(rewardPool)
    )
  )
  roundCreatedEvent.parameters.push(
    new ethereum.EventParam(
      "rewardToken",
      ethereum.Value.fromAddress(rewardToken)
    )
  )
  roundCreatedEvent.parameters.push(
    new ethereum.EventParam(
      "maxTickets",
      ethereum.Value.fromUnsignedBigInt(maxTickets)
    )
  )
  roundCreatedEvent.parameters.push(
    new ethereum.EventParam(
      "ticketCostPoints",
      ethereum.Value.fromUnsignedBigInt(ticketCostPoints)
    )
  )

  return roundCreatedEvent
}

export function createWinnerSelectedEvent(
  roundId: BigInt,
  winner: Address
): WinnerSelected {
  let winnerSelectedEvent = changetype<WinnerSelected>(newMockEvent())

  winnerSelectedEvent.parameters = new Array()

  winnerSelectedEvent.parameters.push(
    new ethereum.EventParam(
      "roundId",
      ethereum.Value.fromUnsignedBigInt(roundId)
    )
  )
  winnerSelectedEvent.parameters.push(
    new ethereum.EventParam("winner", ethereum.Value.fromAddress(winner))
  )

  return winnerSelectedEvent
}
