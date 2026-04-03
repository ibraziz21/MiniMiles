import { ethers } from "hardhat";

const DICE_PROXY =
  process.env.DICE_ADDRESS ??
  "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE ?? "50", 10);
const DELAY_MS = parseInt(process.env.DELAY_MS ?? "0", 10);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stateName(stateNum: number): string {
  if (stateNum === 1) return "open";
  if (stateNum === 2) return "fullWaiting";
  if (stateNum === 3) return "ready";
  if (stateNum === 4) return "resolved";
  return "none";
}

async function main() {
  const dice = await ethers.getContractAt("AkibaDiceGame", DICE_PROXY);
  const nextRoundId = await dice.nextRoundId();
  const startId = BigInt(process.env.START_ID ?? "1");
  const endIdExclusive = process.env.END_ID
    ? BigInt(process.env.END_ID)
    : nextRoundId;

  const unresolved: Array<{
    roundId: string;
    tier: string;
    filledSlots: number;
    randomBlock: string;
    winner: string;
    state: string;
  }> = [];

  for (let start = startId; start < endIdExclusive; start += BigInt(CHUNK_SIZE)) {
    const end = start + BigInt(CHUNK_SIZE) > endIdExclusive
      ? endIdExclusive
      : start + BigInt(CHUNK_SIZE);

    const roundIds: bigint[] = [];
    for (let roundId = start; roundId < end; roundId++) {
      roundIds.push(roundId);
    }

    const infos = await Promise.all(roundIds.map((roundId) => dice.getRoundInfo(roundId)));
    const openRoundIds = roundIds.filter((_, i) => infos[i][2] === false);
    const states = await Promise.all(openRoundIds.map((roundId) => dice.getRoundState(roundId)));
    const stateMap = new Map<string, string>();
    openRoundIds.forEach((roundId, i) => {
      stateMap.set(roundId.toString(), stateName(Number(states[i])));
    });

    infos.forEach((info, i) => {
      const roundId = roundIds[i];
      const [tier, filledSlots, winnerSelected, , randomBlock, winner] = info;
      if (winnerSelected) return;
      unresolved.push({
        roundId: roundId.toString(),
        tier: tier.toString(),
        filledSlots: Number(filledSlots),
        randomBlock: randomBlock.toString(),
        winner,
        state: stateMap.get(roundId.toString()) ?? "unknown",
      });
    });

    if (DELAY_MS > 0) {
      await sleep(DELAY_MS);
    }
  }

  console.log(JSON.stringify({
    proxy: DICE_PROXY,
    startId: startId.toString(),
    endIdExclusive: endIdExclusive.toString(),
    nextRoundId: nextRoundId.toString(),
    unresolvedCount: unresolved.length,
    unresolved,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
