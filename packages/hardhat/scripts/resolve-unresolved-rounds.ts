import { config as dotenvConfig } from "dotenv";
import fs from "fs";
import path from "path";
import hre, { ethers } from "hardhat";

dotenvConfig();

const DEFAULT_RAFFLE_PROXY = "0xd75dfa972c6136f1c594fec1945302f885e1ab29";
const RNG_ADDRESS = "0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB";
const MAX_DIRECT_TICKETS = 25_000;

const RNG_ABI = [
  "function estimateRandomizeFee(uint256 evmGasPrice) external view returns (uint256)",
  "function isRandomized(uint256 blockNumber) external view returns (bool)",
  "function getRandomizeStatus(uint256 blockNumber) external view returns (uint8)",
];

type RoundReport = {
  roundId: number;
  status:
    | "resolved"
    | "closed"
    | "requested_randomness"
    | "randomness_pending"
    | "drawn"
    | "not_active"
    | "not_found"
    | "unfinished"
    | "threshold_not_met"
    | "chunks_required"
    | "error";
  winners?: string[];
  randomBlock?: string;
  rngStatus?: number;
  requestTxHash?: string;
  drawTxHash?: string;
  detail?: string;
};

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let raffleAddress = process.env.AKIBA_RAFFLE_ADDRESS ?? DEFAULT_RAFFLE_PROXY;
  let outFile = "";
  let fromBlock = 0;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--address") {
      raffleAddress = argv[++i] ?? raffleAddress;
    } else if (arg === "--out") {
      outFile = argv[++i] ?? outFile;
    } else if (arg === "--from-block") {
      fromBlock = Number(argv[++i] ?? "0");
    } else {
      positional.push(arg);
    }
  }

  const envStart = process.env.START_ROUND ?? process.env.ROUND_START ?? "";
  const envEnd = process.env.END_ROUND ?? process.env.ROUND_END ?? "";

  if (positional.length < 2 && (!envStart || !envEnd)) {
    throw new Error(
      "Usage: START_ROUND=<start> END_ROUND=<end> npx hardhat run --network celo scripts/resolve-unresolved-rounds.ts [--address <raffle>] [--out <file>] [--from-block <block>]",
    );
  }

  const startRound = Number(positional[0] ?? envStart);
  const endRound = Number(positional[1] ?? envEnd);

  if (!Number.isInteger(startRound) || !Number.isInteger(endRound) || startRound <= 0 || endRound < startRound) {
    throw new Error(`Invalid round range: ${positional[0]} ${positional[1]}`);
  }

  return {
    startRound,
    endRound,
    raffleAddress,
    outFile:
      outFile ||
      path.join(
        process.cwd(),
        "scripts",
        "output",
        `resolved-rounds-${startRound}-${endRound}.json`,
      ),
    fromBlock,
  };
}

function toRoundKey(value: bigint | number | string): string {
  return BigInt(value).toString();
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

async function main() {
  const { startRound, endRound, raffleAddress, outFile, fromBlock } = parseArgs(process.argv.slice(2));
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(
    `Resolving rounds ${startRound}..${endRound} on chain ${network.chainId.toString()} using ${signer.address}`,
  );
  console.log(`Raffle proxy: ${raffleAddress}`);

  const raffle = await ethers.getContractAt("AkibaRaffleV6", raffleAddress);
  const rng = new ethers.Contract(RNG_ADDRESS, RNG_ABI, signer);

  const latestBlock = await ethers.provider.getBlockNumber();
  const roundIdCounter = Number(await raffle.roundIdCounter());

  const start = Math.max(1, startRound);
  const end = Math.min(endRound, roundIdCounter);

  if (start > end) {
    throw new Error(`No rounds in requested range. roundIdCounter=${roundIdCounter}`);
  }

  console.log(`Indexing historical raffle events from block ${fromBlock} to ${latestBlock}...`);

  const [singleWinnerEvents, multiWinnerEvents, closedEvents, randomnessEvents] = await Promise.all([
    raffle.queryFilter(raffle.filters.WinnerSelected(), fromBlock, latestBlock),
    raffle.queryFilter(raffle.filters.MultiWinnersSelected(), fromBlock, latestBlock),
    raffle.queryFilter(raffle.filters.RaffleClosed(), fromBlock, latestBlock),
    raffle.queryFilter(raffle.filters.RandomnessRequested(), fromBlock, latestBlock),
  ]);

  const resolvedMap = new Map<string, string[]>();
  const closedSet = new Set<string>();
  const randomBlockMap = new Map<string, bigint>();

  for (const ev of singleWinnerEvents) {
    const roundKey = toRoundKey(ev.args.roundId);
    resolvedMap.set(roundKey, [ev.args.winner]);
  }

  for (const ev of multiWinnerEvents) {
    const roundKey = toRoundKey(ev.args.roundId);
    resolvedMap.set(roundKey, [...ev.args.winners]);
  }

  for (const ev of closedEvents) {
    closedSet.add(toRoundKey(ev.args.roundId));
  }

  for (const ev of randomnessEvents) {
    randomBlockMap.set(toRoundKey(ev.args.roundId), ev.args.witnetBlock);
  }

  const reports: RoundReport[] = [];

  for (let roundId = start; roundId <= end; roundId++) {
    const roundKey = String(roundId);
    const existingWinners = resolvedMap.get(roundKey);
    if (existingWinners?.length) {
      reports.push({
        roundId,
        status: "resolved",
        winners: existingWinners,
      });
      continue;
    }

    if (closedSet.has(roundKey)) {
      reports.push({
        roundId,
        status: "closed",
      });
      continue;
    }

    let activeRound:
      | readonly [bigint, bigint, bigint, bigint, bigint, string, bigint, bigint, boolean]
      | null = null;
    try {
      activeRound = await raffle.getActiveRound(roundId);
    } catch (err) {
      const msg = getErrorMessage(err);
      const status = roundId > roundIdCounter ? "not_found" : "not_active";
      reports.push({ roundId, status, detail: msg });
      continue;
    }

    const [, , endTime, maxTickets, totalTickets] = activeRound;
    const maxTicketsNum = Number(maxTickets);
    const totalTicketsNum = Number(totalTickets);
    const threshold = Math.floor((maxTicketsNum * 5) / 100);
    const now = Math.floor(Date.now() / 1000);

    if (now <= Number(endTime) && totalTickets !== maxTickets) {
      reports.push({
        roundId,
        status: "unfinished",
        detail: `endTime=${endTime.toString()} totalTickets=${totalTickets.toString()}/${maxTickets.toString()}`,
      });
      continue;
    }

    if (totalTicketsNum < threshold) {
      reports.push({
        roundId,
        status: "threshold_not_met",
        detail: `totalTickets=${totalTickets.toString()}/${maxTickets.toString()}, threshold=${threshold}`,
      });
      continue;
    }

    const randomBlock = randomBlockMap.get(roundKey);

    if (!randomBlock || randomBlock === 0n) {
      try {
        const feeData = await ethers.provider.getFeeData();
        const gasPrice = feeData.gasPrice ?? 5_000_000_000n;
        const estimatedFee: bigint = await rng.estimateRandomizeFee(gasPrice);
        const bufferedFee = (estimatedFee * 12n) / 10n;

        const tx = await raffle.requestRoundRandomness(roundId, {
          value: bufferedFee,
        });
        const receipt = await tx.wait();

        reports.push({
          roundId,
          status: "requested_randomness",
          requestTxHash: receipt?.hash ?? tx.hash,
          detail: `requested with value=${bufferedFee.toString()}`,
        });
      } catch (err) {
        reports.push({
          roundId,
          status: "error",
          detail: `request randomness failed: ${getErrorMessage(err)}`,
        });
      }
      continue;
    }

    try {
      const randomized: boolean = await rng.isRandomized(randomBlock);
      const rngStatus: number = Number(await rng.getRandomizeStatus(randomBlock));

      if (!randomized) {
        reports.push({
          roundId,
          status: "randomness_pending",
          randomBlock: randomBlock.toString(),
          rngStatus,
        });
        continue;
      }

      if (totalTicketsNum > MAX_DIRECT_TICKETS) {
        // The contract may still draw if chunks were already finalized, but if
        // not this is the most likely failure path. We still attempt the draw.
      }

      const tx = await raffle.drawWinner(roundId);
      const receipt = await tx.wait();

      let winners: string[] = [];
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = raffle.interface.parseLog(log);
          if (parsed?.name === "WinnerSelected") {
            winners = [parsed.args.winner];
          } else if (parsed?.name === "MultiWinnersSelected") {
            winners = [...parsed.args.winners];
          }
        } catch {
          // Ignore unrelated logs
        }
      }

      if (winners.length === 0) {
        winners = await raffle.winnersOf(roundId);
      }

      reports.push({
        roundId,
        status: "drawn",
        winners,
        randomBlock: randomBlock.toString(),
        rngStatus,
        drawTxHash: receipt?.hash ?? tx.hash,
      });
    } catch (err) {
      const msg = getErrorMessage(err);
      reports.push({
        roundId,
        status: msg.includes("chunks required") ? "chunks_required" : "error",
        randomBlock: randomBlock.toString(),
        detail: `draw failed: ${msg}`,
      });
    }
  }

  const resolvedRounds = reports
    .filter((item) => item.status === "resolved" || item.status === "drawn")
    .map(({ roundId, winners, status, drawTxHash }) => ({
      roundId,
      winners: winners ?? [],
      status,
      drawTxHash: drawTxHash ?? null,
    }));

  const summary = reports.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  const payload = {
    generatedAt: new Date().toISOString(),
    network: {
      name: hre.network.name,
      chainId: network.chainId.toString(),
    },
    raffleAddress,
    signer: signer.address,
    range: {
      requestedStart: startRound,
      requestedEnd: endRound,
      effectiveStart: start,
      effectiveEnd: end,
      roundIdCounter,
    },
    summary,
    resolvedRounds,
    rounds: reports,
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));

  console.log(`Done. Wrote report to ${outFile}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
