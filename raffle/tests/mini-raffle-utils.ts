import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  AdminChanged,
  BeaconUpgraded,
  Initialized,
  ParticipantJoined,
  RaffleClosed,
  RandomnessRequested,
  RoundCreated,
  Upgraded,
  WinnerSelected
} from "../generated/MiniRaffle/MiniRaffle"

export function createAdminChangedEvent(
  previousAdmin: Address,
  newAdmin: Address
): AdminChanged {
  let adminChangedEvent = changetype<AdminChanged>(newMockEvent())

  adminChangedEvent.parameters = new Array()

  adminChangedEvent.parameters.push(
    new ethereum.EventParam(
      "previousAdmin",
      ethereum.Value.fromAddress(previousAdmin)
    )
  )
  adminChangedEvent.parameters.push(
    new ethereum.EventParam("newAdmin", ethereum.Value.fromAddress(newAdmin))
  )

  return adminChangedEvent
}

export function createBeaconUpgradedEvent(beacon: Address): BeaconUpgraded {
  let beaconUpgradedEvent = changetype<BeaconUpgraded>(newMockEvent())

  beaconUpgradedEvent.parameters = new Array()

  beaconUpgradedEvent.parameters.push(
    new ethereum.EventParam("beacon", ethereum.Value.fromAddress(beacon))
  )

  return beaconUpgradedEvent
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

export function createUpgradedEvent(implementation: Address): Upgraded {
  let upgradedEvent = changetype<Upgraded>(newMockEvent())

  upgradedEvent.parameters = new Array()

  upgradedEvent.parameters.push(
    new ethereum.EventParam(
      "implementation",
      ethereum.Value.fromAddress(implementation)
    )
  )

  return upgradedEvent
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
