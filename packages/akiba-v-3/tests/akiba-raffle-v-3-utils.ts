import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
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
} from "../generated/AkibaRaffleV3/AkibaRaffleV3"

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

export function createMultiWinnersSelectedEvent(
  roundId: BigInt,
  winners: Array<Address>,
  amounts: Array<BigInt>
): MultiWinnersSelected {
  let multiWinnersSelectedEvent =
    changetype<MultiWinnersSelected>(newMockEvent())

  multiWinnersSelectedEvent.parameters = new Array()

  multiWinnersSelectedEvent.parameters.push(
    new ethereum.EventParam(
      "roundId",
      ethereum.Value.fromUnsignedBigInt(roundId)
    )
  )
  multiWinnersSelectedEvent.parameters.push(
    new ethereum.EventParam("winners", ethereum.Value.fromAddressArray(winners))
  )
  multiWinnersSelectedEvent.parameters.push(
    new ethereum.EventParam(
      "amounts",
      ethereum.Value.fromUnsignedBigIntArray(amounts)
    )
  )

  return multiWinnersSelectedEvent
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

export function createParticipantJoinedEvent(
  roundId: BigInt,
  participant: Address,
  tickets: BigInt
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
  participantJoinedEvent.parameters.push(
    new ethereum.EventParam(
      "tickets",
      ethereum.Value.fromUnsignedBigInt(tickets)
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
  ticketCostPoints: BigInt,
  roundType: i32
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
  roundCreatedEvent.parameters.push(
    new ethereum.EventParam(
      "roundType",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundType))
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
  winner: Address,
  reward: BigInt
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
  winnerSelectedEvent.parameters.push(
    new ethereum.EventParam("reward", ethereum.Value.fromUnsignedBigInt(reward))
  )

  return winnerSelectedEvent
}

export function createWithdrawEvent(
  token: Address,
  to: Address,
  amount: BigInt
): Withdraw {
  let withdrawEvent = changetype<Withdraw>(newMockEvent())

  withdrawEvent.parameters = new Array()

  withdrawEvent.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  )
  withdrawEvent.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to))
  )
  withdrawEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return withdrawEvent
}
