import { config as dotenvConfig } from "dotenv";
import fs from "fs";
import path from "path";
import { ethers } from "hardhat";

dotenvConfig();

const DEFAULT_DICE_PROXY = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";
const RNG_ADDRESS = "0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB";

const RNG_ABI = [
  "function estimateRandomizeFee(uint256 evmGasPrice) external view returns (uint256)",
  "function isRandomized(uint256 blockNumber) external view returns (bool)",
  "function getRandomizeStatus(uint256 blockNumber) external view returns (uint8)",
];

type RoundStatus =
  | "resolved"
  | "drawn"
  | "requested_randomness"
  | "randomness_pending"
  | "open"
  | "empty"
  | "cancelled"
  | "not_found"
  | "error";

type RoundReport = {
  roundId: number;
  status: RoundStatus;
  tier?: string;
  filledSlots?: number;
  winner?: string;
  winningNumber?: number;
  randomBlock?: string;
  rngStatus?: number;
  requestTxHash?: string;
  drawTxHash?: string;
  detail?: string;
};

type ResolvedWinner = {
  roundId: number;
  winner: string;
  winningNumber: number;
  tier: string;
  source: "already_resolved" | "drawn_now";
};

function parseArgs(argv: string[]) {
  let diceAddress = process.env.AKIBA_DICE_ADDRESS ?? DEFAULT_DICE_PROXY;
  let outFile = process.env.OUT_FILE ?? "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--address") {
      diceAddress = argv[++i] ?? diceAddress;
    } else if (arg === "--out") {
      outFile = argv[++i] ?? outFile;
    }
  }

  const envStart = process.env.START_ROUND ?? process.env.ROUND_START ?? "";
  const envEnd = process.env.END_ROUND ?? process.env.ROUND_END ?? "";

  if (!envStart || !envEnd) {
    throw new Error(
      "Usage: START_ROUND=<start> END_ROUND=<end> npx hardhat run --network celo scripts/resolve-dice-rounds.ts",
    );
  }

  const startRound = Number(envStart);
  const endRound = Number(envEnd);

  if (!Number.isInteger(startRound) || !Number.isInteger(endRound) || startRound <= 0 || endRound < startRound) {
    throw new Error(`Invalid round range: ${envStart} ${envEnd}`);
  }

  return {
    startRound,
    endRound,
    diceAddress,
    outFile:
      outFile ||
      path.join(
        process.cwd(),
        "scripts",
        "output",
        `dice-resolved-rounds-${startRound}-${endRound}.json`,
      ),
  };
}

function getErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const anyErr = err as any;
    return (
      anyErr?.shortMessage ||
      anyErr?.reason ||
      anyErr?.message ||
      anyErr?.error?.message ||
      "Unknown error"
    );
  }
  return String(err);
}

async function getRandomnessFee(rng: ethers.Contract): Promise<bigint> {
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 5_000_000_000n;
  const estimatedFee: bigint = await rng.estimateRandomizeFee(gasPrice);
  return (estimatedFee * 12n) / 10n;
}

async function main() {
  const { startRound, endRound, diceAddress, outFile } = parseArgs(process.argv.slice(2));
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(
    `Resolving dice rounds ${startRound}..${endRound} on chain ${network.chainId.toString()} using ${signer.address}`,
  );
  console.log(`Dice proxy: ${diceAddress}`);

  const dice = await ethers.getContractAt("AkibaDiceGame", diceAddress);
  const rng = new ethers.Contract(RNG_ADDRESS, RNG_ABI, signer);

  const nextRoundId = Number(await dice.nextRoundId());
  const maxExistingRound = nextRoundId - 1;
  const start = Math.max(1, startRound);
  const end = Math.min(endRound, maxExistingRound);

  if (start > end) {
    throw new Error(`No dice rounds in requested range. nextRoundId=${nextRoundId}`);
  }
  const reports: RoundReport[] = [];
  const resolvedRounds: ResolvedWinner[] = [];

  for (let roundId = start; roundId <= end; roundId++) {
    let info:
      | readonly [bigint, bigint, boolean, bigint, bigint, string]
      | null = null;

    try {
      info = await dice.getRoundInfo(roundId);
    } catch (err) {
      reports.push({
        roundId,
        status: "not_found",
        detail: getErrorMessage(err),
      });
      continue;
    }

    const [tier, filledSlotsRaw, winnerSelected, winningNumberRaw, randomBlock, winner] = info;
    const filledSlots = Number(filledSlotsRaw);
    const winningNumber = Number(winningNumberRaw);
    const tierText = tier.toString();

    if (winnerSelected) {
      const isCancelled = winner === ethers.ZeroAddress && winningNumber === 0 && randomBlock === 0n;
      reports.push({
        roundId,
        status: isCancelled ? "cancelled" : "resolved",
        tier: tierText,
        filledSlots,
        winner,
        winningNumber,
        randomBlock: randomBlock.toString(),
      });
      if (!isCancelled && winner !== ethers.ZeroAddress) {
        resolvedRounds.push({
          roundId,
          winner,
          winningNumber,
          tier: tierText,
          source: "already_resolved",
        });
      }
      continue;
    }

    if (filledSlots === 0) {
      reports.push({
        roundId,
        status: "empty",
        tier: tierText,
        filledSlots,
        detail: "round has no players",
      });
      continue;
    }

    if (randomBlock === 0n) {
      try {
        const fee = await getRandomnessFee(rng);
        const tx = await dice.requestRoundRandomness(roundId, { value: fee });
        const receipt = await tx.wait();

        reports.push({
          roundId,
          status: "requested_randomness",
          tier: tierText,
          filledSlots,
          requestTxHash: receipt?.hash ?? tx.hash,
          detail: `requested with value=${fee.toString()}`,
        });
      } catch (err) {
        reports.push({
          roundId,
          status: "error",
          tier: tierText,
          filledSlots,
          detail: `request randomness failed: ${getErrorMessage(err)}`,
        });
      }
      continue;
    }

    let randomized = false;
    let rngStatus = -1;
    try {
      randomized = await rng.isRandomized(randomBlock);
      try {
        rngStatus = Number(await rng.getRandomizeStatus(randomBlock));
      } catch {
        rngStatus = randomized ? 3 : -1;
      }
    } catch (err) {
      reports.push({
        roundId,
        status: "error",
        tier: tierText,
        filledSlots,
        randomBlock: randomBlock.toString(),
        detail: `rng status failed: ${getErrorMessage(err)}`,
      });
      continue;
    }

    if (!randomized) {
      reports.push({
        roundId,
        status: "randomness_pending",
        tier: tierText,
        filledSlots,
        randomBlock: randomBlock.toString(),
        rngStatus,
      });
      continue;
    }

    if (filledSlots < 6) {
      reports.push({
        roundId,
        status: "open",
        tier: tierText,
        filledSlots,
        randomBlock: randomBlock.toString(),
        rngStatus,
        detail: "randomness ready, but round is not full",
      });
      continue;
    }

    try {
      const tx = await dice.drawRound(roundId);
      const receipt = await tx.wait();
      const refreshed = await dice.getRoundInfo(roundId);
      const [, refreshedFilledSlots, refreshedWinnerSelected, refreshedWinningNumber, refreshedRandomBlock, refreshedWinner] =
        refreshed;

      reports.push({
        roundId,
        status: refreshedWinnerSelected ? "drawn" : "error",
        tier: tierText,
        filledSlots: Number(refreshedFilledSlots),
        winner: refreshedWinner,
        winningNumber: Number(refreshedWinningNumber),
        randomBlock: refreshedRandomBlock.toString(),
        rngStatus,
        drawTxHash: receipt?.hash ?? tx.hash,
        detail: refreshedWinnerSelected ? undefined : "draw transaction completed but round still unresolved",
      });

      if (refreshedWinnerSelected && refreshedWinner !== ethers.ZeroAddress) {
        resolvedRounds.push({
          roundId,
          winner: refreshedWinner,
          winningNumber: Number(refreshedWinningNumber),
          tier: tierText,
          source: "drawn_now",
        });
      }
    } catch (err) {
      reports.push({
        roundId,
        status: "error",
        tier: tierText,
        filledSlots,
        randomBlock: randomBlock.toString(),
        rngStatus,
        detail: `draw failed: ${getErrorMessage(err)}`,
      });
    }
  }

  const summary = reports.reduce<Record<string, number>>((acc, report) => {
    acc[report.status] = (acc[report.status] ?? 0) + 1;
    return acc;
  }, {});

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        network: network.name,
        chainId: network.chainId.toString(),
        diceAddress,
        startRound: start,
        endRound: end,
        summary,
        resolvedRounds,
        rounds: reports,
      },
      null,
      2,
    ),
  );

  console.log(`Processed ${reports.length} dice rounds.`);
  console.log(`Resolved winners captured: ${resolvedRounds.length}`);
  console.log(`Report written to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
