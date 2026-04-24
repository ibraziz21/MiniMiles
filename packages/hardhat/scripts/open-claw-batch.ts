/**
 * Generate and optionally open an Akiba Claw Merkle outcome batch.
 *
 * This is the missing operational step for the claw game:
 *   1. Generate N precommitted reward outcomes.
 *   2. Build Merkle proofs for leaf = keccak256(batchId, playIndex, rewardClass).
 *   3. Call MerkleBatchRng.openBatch(...) with the Merkle root and inventory.
 *   4. Write a server-only manifest consumed by the Next API settle route.
 *
 * Run from packages/hardhat:
 *   npm run claw:batch:dry
 *   npm run claw:batch:open
 *
 * Useful args:
 * Env vars:
 *   NEXT_PUBLIC_BATCH_RNG_ADDRESS / CLAW_BATCH_RNG_ADDRESS
 *   CLAW_BATCH_ID                 Optional; defaults to UTC timestamp YYYYMMDDHHMMSS
 *   CLAW_BATCH_LOSES / CLAW_BATCH_COMMONS / CLAW_BATCH_RARES / CLAW_BATCH_EPICS / CLAW_BATCH_LEGENDARYS
 *   CLAW_BATCH_SHUFFLE_SEED       Optional deterministic shuffle seed for reproducible test batches
 *   CLAW_BATCH_OPEN=1             Actually submit openBatch; otherwise dry-run only
 *   CLAW_BATCH_SKIP_SUPABASE=1    Local-only escape hatch; do not use for production opens
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import batchRngAbi from "../../react-app/contexts/merkleBatchRng.json";

dotEnvConfig();
dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });

type RewardName = "loses" | "commons" | "rares" | "epics" | "legendarys";

const REWARD_CLASS: Record<RewardName, number> = {
  loses: 1,
  commons: 2,
  rares: 3,
  epics: 4,
  legendarys: 5,
};

type ManifestPlay = {
  playIndex: number;
  rewardClass: number;
  proof: string[];
};

type BatchManifest = {
  plays: ManifestPlay[];
};

function getArg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasArg(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function defaultBatchId(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
  ].join("");
}

function getIntArg(name: RewardName, fallback: number): number {
  const raw = getArg(name) ?? process.env[`CLAW_BATCH_${name.toUpperCase()}`];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return value;
}

function normalizeHex32(value: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Expected bytes32 hex, got: ${value}`);
  }
  return value.toLowerCase();
}

function leafHash(batchId: bigint, playIndex: number, rewardClass: number): string {
  const inner = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint8"],
      [batchId, BigInt(playIndex), rewardClass]
    )
  );
  return normalizeHex32(ethers.keccak256(inner));
}

function hashPair(a: string, b: string): string {
  const left = BigInt(a) <= BigInt(b) ? a : b;
  const right = BigInt(a) <= BigInt(b) ? b : a;
  return normalizeHex32(ethers.keccak256(ethers.concat([left, right])));
}

function buildMerkleTree(leaves: string[]): string[][] {
  if (leaves.length === 0) throw new Error("Cannot build an empty Merkle tree");
  const layers: string[][] = [leaves.map(normalizeHex32)];

  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const sibling = prev[i + 1] ?? prev[i];
      next.push(hashPair(prev[i], sibling));
    }
    layers.push(next);
  }

  return layers;
}

function getProof(layers: string[][], index: number): string[] {
  const proof: string[] = [];
  let idx = index;

  for (let level = 0; level < layers.length - 1; level += 1) {
    const layer = layers[level];
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    proof.push(layer[siblingIdx] ?? layer[idx]);
    idx = Math.floor(idx / 2);
  }

  return proof;
}

function seededShuffle<T>(items: T[], seed?: string): T[] {
  const arr = [...items];

  for (let i = arr.length - 1; i > 0; i -= 1) {
    let j: number;
    if (seed) {
      const digest = crypto
        .createHash("sha256")
        .update(`${seed}:${i}`)
        .digest();
      j = digest.readUInt32BE(0) % (i + 1);
    } else {
      j = crypto.randomInt(i + 1);
    }
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

async function upsertSupabaseManifest(opts: {
  batchId: string;
  merkleRoot: string;
  totalPlays: number;
  counts: Record<RewardName, number>;
  manifest: BatchManifest;
  openedTx?: string;
}) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required to store claw manifests");
  }

  const supabase = createClient(url, serviceKey);
  const { error } = await supabase
    .from("claw_batch_manifests")
    .upsert({
      batch_id: opts.batchId,
      merkle_root: opts.merkleRoot,
      total_plays: opts.totalPlays,
      counts: opts.counts,
      manifest: opts.manifest,
      ...(opts.openedTx ? { opened_tx: opts.openedTx, opened_at: new Date().toISOString() } : {}),
    }, { onConflict: "batch_id" });

  if (error) {
    throw new Error(`Failed to upsert Supabase claw manifest: ${error.message}`);
  }
}

async function main() {
  const batchRng =
    getArg("batch-rng") ??
    process.env.CLAW_BATCH_RNG_ADDRESS ??
    process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ??
    "0x249Ce901411809a8A0fECa6102D9F439bbf3751e";

  const batchIdRaw = getArg("batch-id") ?? process.env.CLAW_BATCH_ID ?? defaultBatchId();
  const batchId = BigInt(batchIdRaw);

  const counts: Record<RewardName, number> = {
    loses: getIntArg("loses", 80),
    commons: getIntArg("commons", 15),
    rares: getIntArg("rares", 4),
    epics: getIntArg("epics", 1),
    legendarys: getIntArg("legendarys", 0),
  };

  const rewardClasses = seededShuffle(
    (Object.keys(counts) as RewardName[]).flatMap((name) =>
      Array.from({ length: counts[name] }, () => REWARD_CLASS[name])
    ),
    getArg("shuffle-seed") ?? process.env.CLAW_BATCH_SHUFFLE_SEED
  );

  if (rewardClasses.length === 0) {
    throw new Error("At least one reward outcome is required");
  }

  const leaves = rewardClasses.map((rewardClass, playIndex) =>
    leafHash(batchId, playIndex, rewardClass)
  );
  const layers = buildMerkleTree(leaves);
  const merkleRoot = layers[layers.length - 1][0];

  const plays: ManifestPlay[] = rewardClasses.map((rewardClass, playIndex) => ({
    playIndex,
    rewardClass,
    proof: getProof(layers, playIndex),
  }));

  const batchManifest: BatchManifest = {
    plays,
  };

  const manifest = {
    [batchId.toString()]: {
      plays,
    },
  };

  const outputDir = path.resolve(__dirname, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, `claw-batch-${batchId.toString()}.manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("MerkleBatchRng:", batchRng);
  console.log("Batch ID:", batchId.toString());
  console.log("Total plays:", plays.length);
  console.log("Counts:", counts);
  console.log("Merkle root:", merkleRoot);
  console.log("Manifest:", manifestPath);
  console.log(`Set in packages/react-app/.env: CLAW_BATCH_STORE_FILE="${manifestPath}"`);

  if (!hasArg("open") && process.env.CLAW_BATCH_OPEN !== "1") {
    console.log("\nDry run only. Set CLAW_BATCH_OPEN=1 to submit openBatch.");
    return;
  }

  if (process.env.CLAW_BATCH_SKIP_SUPABASE !== "1") {
    console.log("Uploading manifest to Supabase...");
    await upsertSupabaseManifest({
      batchId: batchId.toString(),
      merkleRoot,
      totalPlays: plays.length,
      counts,
      manifest: batchManifest,
    });
    console.log("Manifest uploaded.");
  } else {
    console.warn("Skipping Supabase manifest upload. Do not use this mode for production.");
  }

  const contract = new ethers.Contract(batchRng, batchRngAbi, signer);
  const tx = await contract.openBatch(
    batchId,
    merkleRoot,
    plays.length,
    counts.loses,
    counts.commons,
    counts.rares,
    counts.epics,
    counts.legendarys
  );
  console.log("openBatch tx:", tx.hash);
  await tx.wait();
  console.log("Batch opened.");

  if (process.env.CLAW_BATCH_SKIP_SUPABASE !== "1") {
    await upsertSupabaseManifest({
      batchId: batchId.toString(),
      merkleRoot,
      totalPlays: plays.length,
      counts,
      manifest: batchManifest,
      openedTx: tx.hash,
    });
    console.log("Supabase manifest row updated with openBatch tx.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
