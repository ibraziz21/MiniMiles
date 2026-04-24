/**
 * Settle and claim a specific Akiba Claw session.
 *
 * This is useful for repairing sessions where MerkleBatchRng already has a
 * committed class, but AkibaClawGame is still Pending.
 *
 * Run from packages/hardhat:
 *   CLAW_SESSION_ID=46 npm run claw:settle
 */

import path from "path";
import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";
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

function normalizePrivateKey(value: string): `0x${string}` {
  if (!value) throw new Error("Set CELO_RELAYER_PK or PRIVATE_KEY");
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}

async function main() {
  const sessionIdRaw = process.env.CLAW_SESSION_ID;
  if (!sessionIdRaw) throw new Error("Set CLAW_SESSION_ID");
  const sessionId = BigInt(sessionIdRaw);

  const clawGame =
    process.env.CLAW_GAME_ADDRESS ??
    process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
    "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3";
  const batchRng =
    process.env.CLAW_BATCH_RNG_ADDRESS ??
    process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ??
    "0x249Ce901411809a8A0fECa6102D9F439bbf3751e";
  const relayerPk = normalizePrivateKey(process.env.CELO_RELAYER_PK ?? process.env.PRIVATE_KEY ?? "");

  const wallet = new ethers.Wallet(relayerPk, ethers.provider);
  const claw = new ethers.Contract(clawGame, clawArtifact.abi, wallet);
  const rng = new ethers.Contract(batchRng, batchRngAbi, ethers.provider);

  console.log("Relayer:", wallet.address);
  console.log("Session:", sessionId.toString());

  const sessionPlay = await rng.getSessionPlay(sessionId);
  console.log("Batch:", sessionPlay.batchId.toString());
  console.log("Play index:", sessionPlay.playIndex.toString());
  console.log("Committed class:", Number(sessionPlay.committedClass));

  let session = await claw.getSession(sessionId);
  console.log("Initial status:", STATUS[Number(session.status)] ?? Number(session.status));

  if (Number(session.status) === 1) {
    if (Number(sessionPlay.committedClass) === 0) {
      throw new Error("Session is pending but has no committed class; use the manifest-backed settle path first");
    }

    const tx = await claw.settleGame(sessionId);
    console.log("settleGame tx:", tx.hash);
    await tx.wait();
    session = await claw.getSession(sessionId);
    console.log("Post-settle status:", STATUS[Number(session.status)] ?? Number(session.status));
  }

  if (Number(session.status) < 3) {
    const tx = await claw.claimReward(sessionId);
    console.log("claimReward tx:", tx.hash);
    await tx.wait();
    session = await claw.getSession(sessionId);
  }

  console.log("Final status:", STATUS[Number(session.status)] ?? Number(session.status));
  console.log("Reward class:", Number(session.rewardClass));
  console.log("Reward amount:", session.rewardAmount.toString());
  console.log("Voucher ID:", session.voucherId.toString());

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && Number(session.status) >= 3) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await supabase
      .from("claw_batch_plays")
      .upsert({
        session_id: sessionId.toString(),
        batch_id: sessionPlay.batchId.toString(),
        play_index: Number(sessionPlay.playIndex),
        commit_status: "claimed",
        settled_at: new Date().toISOString(),
      }, { onConflict: "session_id" });
    console.log("Supabase claw_batch_plays marked claimed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
