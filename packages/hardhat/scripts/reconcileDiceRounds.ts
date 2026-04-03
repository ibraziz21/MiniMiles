/**
 * Scan AkibaDice rounds and reconcile anything that can be progressed.
 *
 * Default mode is dry-run. In execution mode, the script can:
 * - request randomness for full rounds that are missing it
 * - draw full rounds whose randomness is ready
 * - optionally request randomness early for open rounds with players
 * - optionally cancel open rounds, but only if explicitly enabled
 *
 * Examples:
 *   npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   DRY_RUN=false npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   DRY_RUN=false REQUEST_EARLY_OPEN=true npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   DRY_RUN=false CANCEL_OPEN=true ROUND_IDS=12,15 npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 */

import { ethers } from "hardhat";

const DICE_PROXY =
  process.env.DICE_ADDRESS ??
  "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";

const DRY_RUN = process.env.DRY_RUN !== "false";
const REQUEST_EARLY_OPEN = process.env.REQUEST_EARLY_OPEN === "true";
const REQUEST_FULL_WAITING = process.env.REQUEST_FULL_WAITING !== "false";
const DRAW_READY = process.env.DRAW_READY !== "false";
const CANCEL_OPEN = process.env.CANCEL_OPEN === "true";
const WITNET_FEE_WEI = BigInt(process.env.WITNET_FEE_WEI ?? ethers.parseEther("0.01").toString());

type RoundStateName = "none" | "open" | "fullWaiting" | "ready" | "resolved";

function parseRoundIds(): bigint[] | null {
  const raw = process.env.ROUND_IDS?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => BigInt(v));
}

function stateName(stateNum: number): RoundStateName {
  if (stateNum === 1) return "open";
  if (stateNum === 2) return "fullWaiting";
  if (stateNum === 3) return "ready";
  if (stateNum === 4) return "resolved";
  return "none";
}

async function main() {
  const [signer] = await ethers.getSigners();
  const dice = await ethers.getContractAt("AkibaDiceGame", DICE_PROXY);
  const owner = await dice.owner();

  const selectedRoundIds = parseRoundIds();
  const nextRoundId = await dice.nextRoundId();
  const totalCreated = await dice.totalRoundsCreated();
  const totalResolved = await dice.totalRoundsResolved();
  const totalCancelled = await dice.totalRoundsCancelled();

  console.log("Dice proxy:         ", DICE_PROXY);
  console.log("Caller:             ", signer.address);
  console.log("Owner:              ", owner);
  console.log("Mode:               ", DRY_RUN ? "DRY_RUN" : "EXECUTE");
  console.log("REQUEST_EARLY_OPEN: ", REQUEST_EARLY_OPEN);
  console.log("REQUEST_FULL_WAITING:", REQUEST_FULL_WAITING);
  console.log("DRAW_READY:         ", DRAW_READY);
  console.log("CANCEL_OPEN:        ", CANCEL_OPEN);
  console.log("WITNET_FEE_WEI:     ", WITNET_FEE_WEI.toString());
  console.log("nextRoundId:        ", nextRoundId.toString());
  console.log("totalCreated:       ", totalCreated.toString());
  console.log("totalResolved:      ", totalResolved.toString());
  console.log("totalCancelled:     ", totalCancelled.toString());
  console.log(
    "created-resolved-cancelled:",
    (totalCreated - totalResolved - totalCancelled).toString()
  );

  const roundIds =
    selectedRoundIds ??
    Array.from({ length: Number(nextRoundId - 1n) }, (_, i) => BigInt(i + 1));

  const counts = {
    none: 0,
    open: 0,
    fullWaitingNoRandomness: 0,
    fullWaitingPendingRandomness: 0,
    ready: 0,
    resolved: 0,
  };

  let requested = 0;
  let drawn = 0;
  let cancelled = 0;
  let errors = 0;

  for (const roundId of roundIds) {
    const [tier, filledSlots, winnerSelected, winningNumber, randomBlock, winner] =
      await dice.getRoundInfo(roundId);
    const rawState = await dice.getRoundState(roundId);
    const state = stateName(Number(rawState));
    const filled = Number(filledSlots);

    if (state === "resolved") {
      counts.resolved += 1;
      continue;
    }

    if (state === "none") {
      counts.none += 1;
      continue;
    }

    if (state === "open") {
      counts.open += 1;
    } else if (state === "ready") {
      counts.ready += 1;
    } else if (state === "fullWaiting") {
      if (randomBlock === 0n) counts.fullWaitingNoRandomness += 1;
      else counts.fullWaitingPendingRandomness += 1;
    }

    console.log(
      [
        `round=${roundId.toString()}`,
        `tier=${tier.toString()}`,
        `state=${state}`,
        `filled=${filled}/6`,
        `randomBlock=${randomBlock.toString()}`,
        `winnerSelected=${winnerSelected}`,
        `winningNumber=${winningNumber.toString()}`,
        `winner=${winner}`,
      ].join(" ")
    );

    const shouldRequestOpen =
      REQUEST_EARLY_OPEN &&
      state === "open" &&
      filled > 0 &&
      randomBlock === 0n;

    const shouldRequestFull =
      REQUEST_FULL_WAITING &&
      state === "fullWaiting" &&
      filled === 6 &&
      randomBlock === 0n;

    const shouldDraw =
      DRAW_READY &&
      state === "ready" &&
      filled === 6 &&
      !winnerSelected;

    const shouldCancel =
      CANCEL_OPEN &&
      state === "open" &&
      filled > 0 &&
      randomBlock === 0n;

    try {
      if (shouldRequestOpen || shouldRequestFull) {
        if (DRY_RUN) {
          console.log(
            `  [dry-run] requestRoundRandomness(${roundId.toString()})`
          );
        } else {
          const tx = await dice.requestRoundRandomness(roundId, {
            value: WITNET_FEE_WEI,
          });
          await tx.wait();
          requested += 1;
          console.log(`  requested randomness: ${tx.hash}`);
        }
      }

      if (shouldDraw) {
        if (DRY_RUN) {
          console.log(`  [dry-run] drawRound(${roundId.toString()})`);
        } else {
          const tx = await dice.drawRound(roundId);
          await tx.wait();
          drawn += 1;
          console.log(`  drew round: ${tx.hash}`);
        }
      }

      if (shouldCancel) {
        if (signer.address.toLowerCase() !== owner.toLowerCase()) {
          console.log("  skip cancel: caller is not owner");
        } else if (DRY_RUN) {
          console.log(`  [dry-run] cancelRound(${roundId.toString()})`);
        } else {
          const tx = await dice.cancelRound(roundId);
          await tx.wait();
          cancelled += 1;
          console.log(`  cancelled round: ${tx.hash}`);
        }
      }
    } catch (err: any) {
      errors += 1;
      console.log(
        `  error: ${err?.shortMessage || err?.message || String(err)}`
      );
    }
  }

  console.log("\nSummary");
  console.log("  resolved:                   ", counts.resolved);
  console.log("  ready:                      ", counts.ready);
  console.log("  open:                       ", counts.open);
  console.log("  fullWaiting no randomness:  ", counts.fullWaitingNoRandomness);
  console.log("  fullWaiting pending random: ", counts.fullWaitingPendingRandomness);
  console.log("  none:                       ", counts.none);
  console.log("  requested randomness:       ", requested);
  console.log("  drawn:                      ", drawn);
  console.log("  cancelled:                  ", cancelled);
  console.log("  errors:                     ", errors);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
