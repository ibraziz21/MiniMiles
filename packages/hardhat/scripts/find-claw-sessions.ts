/**
 * List Akiba Claw sessions for a wallet.
 *
 * Run from packages/hardhat:
 *   CLAW_PLAYER=0x... npm run claw:sessions
 */

import path from "path";
import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import clawArtifact from "../../react-app/contexts/akibaClawGame.json";
import batchRngAbi from "../../react-app/contexts/merkleBatchRng.json";

dotEnvConfig();
dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });

const STATUS: Record<number, string> = {
  0: "None",
  1: "Pending",
  2: "Settled",
  3: "Claimed",
  4: "Burned",
  5: "Refunded",
};

async function main() {
  const player = process.env.CLAW_PLAYER;
  if (!player || !ethers.isAddress(player)) {
    throw new Error("Set CLAW_PLAYER to the wallet address");
  }

  const clawGame =
    process.env.CLAW_GAME_ADDRESS ??
    process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
    "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3";
  const batchRng =
    process.env.CLAW_BATCH_RNG_ADDRESS ??
    process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ??
    "0x249Ce901411809a8A0fECa6102D9F439bbf3751e";
  const deployBlock = Number(process.env.NEXT_PUBLIC_CLAW_DEPLOY_BLOCK ?? "61599859");

  const claw = new ethers.Contract(clawGame, clawArtifact.abi, ethers.provider);
  const rng = new ethers.Contract(batchRng, batchRngAbi, ethers.provider);

  const filter = claw.filters.GameStarted(null, player);
  const latest = await ethers.provider.getBlockNumber();
  const chunkSize = Number(process.env.CLAW_LOG_CHUNK_SIZE ?? "50000");
  const logs: any[] = [];

  for (let fromBlock = deployBlock; fromBlock <= latest; fromBlock += chunkSize + 1) {
    const toBlock = Math.min(fromBlock + chunkSize, latest);
    let attempt = 0;
    while (true) {
      try {
        const chunkLogs = await claw.queryFilter(filter, fromBlock, toBlock);
        logs.push(...chunkLogs);
        break;
      } catch (err) {
        attempt += 1;
        if (attempt >= 3) throw err;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  console.log(`Player: ${player}`);
  console.log(`Sessions found: ${logs.length}`);

  for (const log of logs) {
    const parsed = claw.interface.parseLog(log);
    const sessionId = parsed?.args.sessionId;
    if (sessionId == null) continue;

    const session = await claw.getSession(sessionId);
    const sessionPlay = await rng.getSessionPlay(sessionId).catch(() => null);
    const status = Number(session.status);

    console.log(JSON.stringify({
      sessionId: sessionId.toString(),
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      status,
      statusName: STATUS[status] ?? "Unknown",
      rewardClass: Number(session.rewardClass),
      rewardAmount: session.rewardAmount.toString(),
      voucherId: session.voucherId.toString(),
      batchId: sessionPlay ? sessionPlay.batchId.toString() : null,
      playIndex: sessionPlay ? sessionPlay.playIndex.toString() : null,
      committedClass: sessionPlay ? Number(sessionPlay.committedClass) : null,
    }));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
