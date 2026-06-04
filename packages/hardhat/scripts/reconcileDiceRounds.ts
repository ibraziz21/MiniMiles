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
 *   ROUND_ID=12 npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   ROUND_IDS=12,15 npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   START_ROUND_ID=21700 npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   OUTPUT_JSON=./dice-rounds.json START_ROUND_ID=21700 npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   DRY_RUN=false START_ROUND_ID=21700 npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   DRY_RUN=false START_ROUND_ID=21700 END_ROUND_ID=21800 npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   DRY_RUN=false OUTPUT_JSON=./dice-reconcile-results.json START_ROUND_ID=21700 npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   DRY_RUN=false ROUND_ID=12 npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   DRY_RUN=false npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   DRY_RUN=false REQUEST_EARLY_OPEN=true npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 *   DRY_RUN=false CANCEL_OPEN=true ROUND_IDS=12,15 npx hardhat run scripts/reconcileDiceRounds.ts --network celo
 */

import { ethers } from "hardhat";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

const DICE_PROXY =
  process.env.DICE_ADDRESS ??
  "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";

const DRY_RUN = process.env.DRY_RUN !== "false";
const REQUEST_EARLY_OPEN = process.env.REQUEST_EARLY_OPEN === "true";
const REQUEST_FULL_WAITING = process.env.REQUEST_FULL_WAITING !== "false";
const DRAW_READY = process.env.DRAW_READY !== "false";
const CANCEL_OPEN = process.env.CANCEL_OPEN === "true";
const OUTPUT_JSON = process.env.OUTPUT_JSON?.trim();
const WITNET_FEE_WEI = BigInt(process.env.WITNET_FEE_WEI ?? ethers.parseEther("0.01").toString());

type RoundStateName = "none" | "open" | "fullWaiting" | "ready" | "resolved";
type RandomizeStatusName =
  | "void"
  | "awaiting"
  | "ready"
  | "error"
  | "finalizing"
  | "unknown";

type RoundAction =
  | { type: "request-randomness"; dryRun: boolean; txHash?: string }
  | { type: "draw-round"; dryRun: boolean; txHash?: string }
  | { type: "cancel-round"; dryRun: boolean; txHash?: string }
  | { type: "skip-cancel"; reason: string }
  | { type: "error"; message: string };

type RoundResult = {
  roundId: string;
  tier: string;
  state: RoundStateName;
  filledSlots: number;
  randomBlock: string;
  randomness: RandomizeStatusName | "not-requested";
  randomnessReady: boolean;
  winnerSelected: boolean;
  winningNumber: string;
  winner: string;
  actions: RoundAction[];
};

function parseRoundIds(): bigint[] | null {
  const raw = (process.env.ROUND_IDS ?? process.env.ROUND_ID)?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => BigInt(v));
}

function buildRoundRange(startRoundId: bigint, endRoundIdInclusive: bigint): bigint[] {
  if (startRoundId <= 0n) {
    throw new Error("START_ROUND_ID must be greater than 0");
  }

  if (endRoundIdInclusive < startRoundId) {
    throw new Error("END_ROUND_ID must be greater than or equal to START_ROUND_ID");
  }

  return Array.from(
    { length: Number(endRoundIdInclusive - startRoundId + 1n) },
    (_, i) => startRoundId + BigInt(i)
  );
}

function stateName(stateNum: number): RoundStateName {
  if (stateNum === 1) return "open";
  if (stateNum === 2) return "fullWaiting";
  if (stateNum === 3) return "ready";
  if (stateNum === 4) return "resolved";
  return "none";
}

function randomizeStatusName(statusNum: number): RandomizeStatusName {
  if (statusNum === 0) return "void";
  if (statusNum === 1) return "awaiting";
  if (statusNum === 2) return "ready";
  if (statusNum === 3) return "error";
  if (statusNum === 4) return "finalizing";
  return "unknown";
}

function writeJsonReport(outputJson: string, report: unknown) {
  const outputPath = resolve(outputJson);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report written: ${outputPath}`);
}

async function main() {
  const [signer] = await ethers.getSigners();
  const dice = await ethers.getContractAt("AkibaDiceGame", DICE_PROXY);
  const rngAddress = await dice.RNG();
  const rng = await ethers.getContractAt(
    [
      "function getRandomizeStatus(uint256 blockNumber) view returns (uint8)",
      "function isRandomized(uint256 blockNumber) view returns (bool)",
    ],
    rngAddress
  );
  const owner = await dice.owner();

  const selectedRoundIds = parseRoundIds();
  const nextRoundId = await dice.nextRoundId();
  const latestRoundId = nextRoundId - 1n;
  const startRoundId = process.env.START_ROUND_ID
    ? BigInt(process.env.START_ROUND_ID)
    : null;
  const endRoundId = process.env.END_ROUND_ID
    ? BigInt(process.env.END_ROUND_ID)
    : latestRoundId;
  const totalCreated = await dice.totalRoundsCreated();
  const totalResolved = await dice.totalRoundsResolved();
  const totalCancelled = await dice.totalRoundsCancelled();

  console.log("Dice proxy:         ", DICE_PROXY);
  console.log("RNG:                ", rngAddress);
  console.log("Caller:             ", signer.address);
  console.log("Owner:              ", owner);
  console.log("Mode:               ", DRY_RUN ? "DRY_RUN" : "EXECUTE");
  console.log("REQUEST_EARLY_OPEN: ", REQUEST_EARLY_OPEN);
  console.log("REQUEST_FULL_WAITING:", REQUEST_FULL_WAITING);
  console.log("DRAW_READY:         ", DRAW_READY);
  console.log("CANCEL_OPEN:        ", CANCEL_OPEN);
  console.log("OUTPUT_JSON:        ", OUTPUT_JSON || "(disabled)");
  console.log("WITNET_FEE_WEI:     ", WITNET_FEE_WEI.toString());
  console.log("nextRoundId:        ", nextRoundId.toString());
  console.log("latestRoundId:      ", latestRoundId.toString());
  console.log("totalCreated:       ", totalCreated.toString());
  console.log("totalResolved:      ", totalResolved.toString());
  console.log("totalCancelled:     ", totalCancelled.toString());
  console.log(
    "created-resolved-cancelled:",
    (totalCreated - totalResolved - totalCancelled).toString()
  );

  const roundIds = selectedRoundIds
    ?? (startRoundId
      ? buildRoundRange(startRoundId, endRoundId)
      : buildRoundRange(1n, latestRoundId));

  console.log("roundsToCheck:      ", roundIds.length);

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
  const results: RoundResult[] = [];

  for (const roundId of roundIds) {
    const [tier, filledSlots, winnerSelected, winningNumber, randomBlock, winner] =
      await dice.getRoundInfo(roundId);
    const rawState = await dice.getRoundState(roundId);
    const state = stateName(Number(rawState));
    const filled = Number(filledSlots);
    const randomnessStatus =
      randomBlock === 0n
        ? "not-requested"
        : randomizeStatusName(Number(await rng.getRandomizeStatus(randomBlock)));
    const randomnessReady =
      randomBlock !== 0n ? await rng.isRandomized(randomBlock) : false;
    const roundResult: RoundResult = {
      roundId: roundId.toString(),
      tier: tier.toString(),
      state,
      filledSlots: filled,
      randomBlock: randomBlock.toString(),
      randomness: randomnessStatus,
      randomnessReady,
      winnerSelected,
      winningNumber: winningNumber.toString(),
      winner,
      actions: [],
    };

    if (state === "resolved") {
      counts.resolved += 1;
      console.log(
        [
          `round=${roundId.toString()}`,
          `tier=${tier.toString()}`,
          `state=${state}`,
          `filled=${filled}/6`,
          `randomBlock=${randomBlock.toString()}`,
          `randomness=${randomnessStatus}`,
          `randomnessReady=${randomnessReady}`,
          `winnerSelected=${winnerSelected}`,
          `winningNumber=${winningNumber.toString()}`,
          `winner=${winner}`,
        ].join(" ")
      );
      results.push(roundResult);
      continue;
    }

    if (state === "none") {
      counts.none += 1;
      console.log(
        [
          `round=${roundId.toString()}`,
          `tier=${tier.toString()}`,
          `state=${state}`,
          `filled=${filled}/6`,
          `randomBlock=${randomBlock.toString()}`,
          `randomness=${randomnessStatus}`,
          `randomnessReady=${randomnessReady}`,
          `winnerSelected=${winnerSelected}`,
          `winningNumber=${winningNumber.toString()}`,
          `winner=${winner}`,
        ].join(" ")
      );
      results.push(roundResult);
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
        `randomness=${randomnessStatus}`,
        `randomnessReady=${randomnessReady}`,
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
          roundResult.actions.push({
            type: "request-randomness",
            dryRun: true,
          });
        } else {
          const tx = await dice.requestRoundRandomness(roundId, {
            value: WITNET_FEE_WEI,
          });
          await tx.wait();
          requested += 1;
          console.log(`  requested randomness: ${tx.hash}`);
          roundResult.actions.push({
            type: "request-randomness",
            dryRun: false,
            txHash: tx.hash,
          });
        }
      }

      if (shouldDraw) {
        if (DRY_RUN) {
          console.log(`  [dry-run] drawRound(${roundId.toString()})`);
          roundResult.actions.push({
            type: "draw-round",
            dryRun: true,
          });
        } else {
          const tx = await dice.drawRound(roundId);
          await tx.wait();
          drawn += 1;
          console.log(`  drew round: ${tx.hash}`);
          roundResult.actions.push({
            type: "draw-round",
            dryRun: false,
            txHash: tx.hash,
          });
        }
      }

      if (shouldCancel) {
        if (signer.address.toLowerCase() !== owner.toLowerCase()) {
          console.log("  skip cancel: caller is not owner");
          roundResult.actions.push({
            type: "skip-cancel",
            reason: "caller is not owner",
          });
        } else if (DRY_RUN) {
          console.log(`  [dry-run] cancelRound(${roundId.toString()})`);
          roundResult.actions.push({
            type: "cancel-round",
            dryRun: true,
          });
        } else {
          const tx = await dice.cancelRound(roundId);
          await tx.wait();
          cancelled += 1;
          console.log(`  cancelled round: ${tx.hash}`);
          roundResult.actions.push({
            type: "cancel-round",
            dryRun: false,
            txHash: tx.hash,
          });
        }
      }
    } catch (err: any) {
      errors += 1;
      const message = err?.shortMessage || err?.message || String(err);
      console.log(`  error: ${message}`);
      roundResult.actions.push({
        type: "error",
        message,
      });
    }

    results.push(roundResult);
  }

  const summary = {
    resolved: counts.resolved,
    ready: counts.ready,
    open: counts.open,
    fullWaitingNoRandomness: counts.fullWaitingNoRandomness,
    fullWaitingPendingRandomness: counts.fullWaitingPendingRandomness,
    none: counts.none,
    requestedRandomness: requested,
    drawn,
    cancelled,
    errors,
  };

  console.log("\nSummary");
  console.log("  resolved:                   ", summary.resolved);
  console.log("  ready:                      ", summary.ready);
  console.log("  open:                       ", summary.open);
  console.log("  fullWaiting no randomness:  ", summary.fullWaitingNoRandomness);
  console.log("  fullWaiting pending random: ", summary.fullWaitingPendingRandomness);
  console.log("  none:                       ", summary.none);
  console.log("  requested randomness:       ", summary.requestedRandomness);
  console.log("  drawn:                      ", summary.drawn);
  console.log("  cancelled:                  ", summary.cancelled);
  console.log("  errors:                     ", summary.errors);

  if (OUTPUT_JSON) {
    writeJsonReport(OUTPUT_JSON, {
      generatedAt: new Date().toISOString(),
      proxy: DICE_PROXY,
      rng: rngAddress,
      caller: signer.address,
      owner,
      mode: DRY_RUN ? "DRY_RUN" : "EXECUTE",
      options: {
        requestEarlyOpen: REQUEST_EARLY_OPEN,
        requestFullWaiting: REQUEST_FULL_WAITING,
        drawReady: DRAW_READY,
        cancelOpen: CANCEL_OPEN,
        witnetFeeWei: WITNET_FEE_WEI.toString(),
        selectedRoundIds: selectedRoundIds?.map((id) => id.toString()) ?? null,
        startRoundId: startRoundId?.toString() ?? null,
        endRoundId: endRoundId.toString(),
      },
      chainState: {
        nextRoundId: nextRoundId.toString(),
        latestRoundId: latestRoundId.toString(),
        totalCreated: totalCreated.toString(),
        totalResolved: totalResolved.toString(),
        totalCancelled: totalCancelled.toString(),
        createdMinusResolvedMinusCancelled: (
          totalCreated - totalResolved - totalCancelled
        ).toString(),
      },
      roundsToCheck: roundIds.length,
      summary,
      rounds: results,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
