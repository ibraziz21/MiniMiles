import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  AdminChanged,
  AllowedTierSet,
  BeaconUpgraded,
  Initialized,
  Joined,
  OwnershipTransferred,
  RandomnessRequested,
  RoundCancelled,
  RoundOpened,
  RoundResolved,
  Upgraded
} from "../generated/AkibaDiceGame/AkibaDiceGame"

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

export function createAllowedTierSetEvent(
  tier: BigInt,
  allowed: boolean
): AllowedTierSet {
  let allowedTierSetEvent = changetype<AllowedTierSet>(newMockEvent())

  allowedTierSetEvent.parameters = new Array()

  allowedTierSetEvent.parameters.push(
    new ethereum.EventParam("tier", ethereum.Value.fromUnsignedBigInt(tier))
  )
  allowedTierSetEvent.parameters.push(
    new ethereum.EventParam("allowed", ethereum.Value.fromBoolean(allowed))
  )

  return allowedTierSetEvent
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

export function createJoinedEvent(
  roundId: BigInt,
  number: i32,
  player: Address
): Joined {
  let joinedEvent = changetype<Joined>(newMockEvent())

  joinedEvent.parameters = new Array()

  joinedEvent.parameters.push(
    new ethereum.EventParam(
      "roundId",
      ethereum.Value.fromUnsignedBigInt(roundId)
    )
  )
  joinedEvent.parameters.push(
    new ethereum.EventParam(
      "number",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(number))
    )
  )
  joinedEvent.parameters.push(
    new ethereum.EventParam("player", ethereum.Value.fromAddress(player))
  )

  return joinedEvent
}

export function createOwnershipTransferredEvent(
  oldOwner: Address,
  newOwner: Address
): OwnershipTransferred {
  let ownershipTransferredEvent =
    changetype<OwnershipTransferred>(newMockEvent())

  ownershipTransferredEvent.parameters = new Array()

  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam("oldOwner", ethereum.Value.fromAddress(oldOwner))
  )
  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam("newOwner", ethereum.Value.fromAddress(newOwner))
  )

  return ownershipTransferredEvent
}

export function createRandomnessRequestedEvent(
  roundId: BigInt,
  randomBlock: BigInt
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
      "randomBlock",
      ethereum.Value.fromUnsignedBigInt(randomBlock)
    )
  )

  return randomnessRequestedEvent
}

export function createRoundCancelledEvent(roundId: BigInt): RoundCancelled {
  let roundCancelledEvent = changetype<RoundCancelled>(newMockEvent())

  roundCancelledEvent.parameters = new Array()

  roundCancelledEvent.parameters.push(
    new ethereum.EventParam(
      "roundId",
      ethereum.Value.fromUnsignedBigInt(roundId)
    )
  )

  return roundCancelledEvent
}

export function createRoundOpenedEvent(
  roundId: BigInt,
  tier: BigInt
): RoundOpened {
  let roundOpenedEvent = changetype<RoundOpened>(newMockEvent())

  roundOpenedEvent.parameters = new Array()

  roundOpenedEvent.parameters.push(
    new ethereum.EventParam(
      "roundId",
      ethereum.Value.fromUnsignedBigInt(roundId)
    )
  )
  roundOpenedEvent.parameters.push(
    new ethereum.EventParam("tier", ethereum.Value.fromUnsignedBigInt(tier))
  )

  return roundOpenedEvent
}

export function createRoundResolvedEvent(
  roundId: BigInt,
  winningNumber: i32,
  winner: Address,
  payout: BigInt
): RoundResolved {
  let roundResolvedEvent = changetype<RoundResolved>(newMockEvent())

  roundResolvedEvent.parameters = new Array()

  roundResolvedEvent.parameters.push(
    new ethereum.EventParam(
      "roundId",
      ethereum.Value.fromUnsignedBigInt(roundId)
    )
  )
  roundResolvedEvent.parameters.push(
    new ethereum.EventParam(
      "winningNumber",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(winningNumber))
    )
  )
  roundResolvedEvent.parameters.push(
    new ethereum.EventParam("winner", ethereum.Value.fromAddress(winner))
  )
  roundResolvedEvent.parameters.push(
    new ethereum.EventParam("payout", ethereum.Value.fromUnsignedBigInt(payout))
  )

  return roundResolvedEvent
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
