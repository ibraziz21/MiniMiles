import "dotenv/config";
import https from "https";
import { ethers } from "hardhat";

const DICE_PROXY =
  process.env.DICE_ADDRESS ??
  "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";

const API_KEY = process.env.CELOSCAN_API_KEY ?? "";
const API_URL = "https://api.celoscan.io/api";
const PAGE_SIZE = 1000;

function getJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

async function fetchAllLogs(topic0: string) {
  const logs: any[] = [];
  for (let page = 1; ; page++) {
    const url =
      `${API_URL}?module=logs&action=getLogs` +
      `&fromBlock=0&toBlock=latest` +
      `&address=${DICE_PROXY}` +
      `&topic0=${topic0}` +
      `&page=${page}&offset=${PAGE_SIZE}` +
      `&apikey=${API_KEY}`;

    const json = await getJson(url);
    const batch = Array.isArray(json.result) ? json.result : [];
    logs.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return logs;
}

function topicToBigInt(topic: string): bigint {
  return BigInt(topic);
}

async function main() {
  if (!API_KEY) {
    throw new Error("CELOSCAN_API_KEY missing");
  }

  const roundOpenedTopic = ethers.id("RoundOpened(uint256,uint256)");
  const roundResolvedTopic = ethers.id("RoundResolved(uint256,uint8,address,uint256)");
  const roundCancelledTopic = ethers.id("RoundCancelled(uint256)");

  const [opened, resolved, cancelled] = await Promise.all([
    fetchAllLogs(roundOpenedTopic),
    fetchAllLogs(roundResolvedTopic),
    fetchAllLogs(roundCancelledTopic),
  ]);

  const unresolved = new Map<string, { roundId: string; tier: string; txHash: string; blockNumber: string }>();

  for (const log of opened) {
    const roundId = topicToBigInt(log.topics[1]).toString();
    const tier = topicToBigInt(log.topics[2]).toString();
    unresolved.set(roundId, {
      roundId,
      tier,
      txHash: log.transactionHash,
      blockNumber: BigInt(log.blockNumber).toString(),
    });
  }

  for (const log of resolved) {
    const roundId = topicToBigInt(log.topics[1]).toString();
    unresolved.delete(roundId);
  }

  for (const log of cancelled) {
    const roundId = topicToBigInt(log.topics[1]).toString();
    unresolved.delete(roundId);
  }

  const list = Array.from(unresolved.values()).sort(
    (a, b) => Number(BigInt(a.roundId) - BigInt(b.roundId))
  );

  console.log(
    JSON.stringify(
      {
        proxy: DICE_PROXY,
        openedCount: opened.length,
        resolvedCount: resolved.length,
        cancelledCount: cancelled.length,
        unresolvedCount: list.length,
        unresolved: list,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
