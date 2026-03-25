/**
 * blacklist-bad-actors.ts
 *
 * Mode A (default): pulls all referrers from Supabase where
 *   >= MIN_REFERRALS referred wallets AND 100% have zero activity,
 *   then blacklists those referrers + every wallet they referred.
 *
 * Mode B: set BAD_ACTOR_ADDRESS to target a single referrer only.
 *
 * .env required:
 *   SUPABASE_URL=
 *   SUPABASE_SERVICE_KEY=
 *   MINIPOINTS_V2_ADDRESS=
 *
 * Optional:
 *   BAD_ACTOR_ADDRESS=   single address (skips auto-detect)
 *   MIN_REFERRALS=50     minimum referral count to flag (default 50)
 *   DRY_RUN=false        set to execute on-chain
 *   START_CHUNK=23       resume from chunk N
 *
 * Run:
 *   npx hardhat run scripts/blacklist-bad-actors.ts --network celo
 *   DRY_RUN=false npx hardhat run scripts/blacklist-bad-actors.ts --network celo
 */

import { ethers } from "hardhat";
import { createClient } from "@supabase/supabase-js";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const DRY_RUN       = process.env.DRY_RUN !== "false";
const CHUNK_SIZE    = 200;
const MAX_RETRIES   = 8;
const RETRY_DELAY   = 5000;
const MIN_REFERRALS = parseInt(process.env.MIN_REFERRALS ?? "50", 10);

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      const retryable =
        msg.includes("replacement transaction underpriced") ||
        msg.includes("nonce too low") ||
        msg.includes("already known") ||
        msg.includes("transaction underpriced") ||
        msg.includes("intrinsic gas too low");
      if (retryable && attempt < MAX_RETRIES) {
        console.warn(`    [${label}] attempt ${attempt} failed: ${msg.split("\n")[0]}`);
        console.warn(`    Retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
      } else {
        throw err;
      }
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts`);
}

const AKIBA_V2_ABI = [
  "function batchSetBlacklist(address[] calldata accounts, bool blacklisted) external",
  "function blacklist(address) view returns (bool)",
  "function owner() view returns (address)",
  "function minters(address) view returns (bool)",
];

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  supabase: any,
  table: string,
  column: string,
  filters?: Record<string, any>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    let query = supabase
      .from(table)
      .select(column)
      .range(from, from + PAGE_SIZE - 1);
    if (filters) {
      for (const [key, val] of Object.entries(filters)) {
        query = query.eq(key, val);
      }
    }
    const { data, error } = await query;
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function detectBadActors(supabase: any): Promise<string[]> {
  console.log(`Auto-detecting bad actors (>= ${MIN_REFERRALS} referrals, 100% zero-activity)...`);

  // Fetch all referrals
  const allReferrals = await fetchAllRows<{ referrer_address: string; referred_address: string }>(
    supabase, "referrals", "referrer_address, referred_address"
  );

  // Group referred wallets by referrer
  const byReferrer = new Map<string, string[]>();
  for (const r of allReferrals) {
    const ref = r.referrer_address.toLowerCase();
    if (!byReferrer.has(ref)) byReferrer.set(ref, []);
    byReferrer.get(ref)!.push(r.referred_address.toLowerCase());
  }

  // Fetch all addresses with any engagement
  const engaged = await fetchAllRows<{ user_address: string }>(supabase, "daily_engagements", "user_address");
  const engagedSet = new Set(engaged.map((r) => r.user_address.toLowerCase()));

  const badActors: string[] = [];
  for (const [referrer, referred] of byReferrer.entries()) {
    if (referred.length < MIN_REFERRALS) continue;
    const allZero = referred.every((a) => !engagedSet.has(a));
    if (allZero) {
      badActors.push(referrer);
    }
  }

  return badActors;
}

async function main() {
  const v2Address = process.env.MINIPOINTS_V2_ADDRESS;
  if (!v2Address) throw new Error("MINIPOINTS_V2_ADDRESS not set in .env");

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  console.log(`\n=== Blacklist Bad Actors (${DRY_RUN ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`Threshold: >= ${MIN_REFERRALS} referrals, 100% zero-activity\n`);

  // 1) Determine list of bad actor referrers
  let badActors: string[];
  const singleActor = process.env.BAD_ACTOR_ADDRESS?.toLowerCase();
  if (singleActor) {
    console.log(`Single-actor mode: ${singleActor}`);
    badActors = [singleActor];
  } else {
    badActors = await detectBadActors(supabase);
    console.log(`\nFound ${badActors.length} bad actor referrer(s):`);
    badActors.forEach((a, i) => console.log(`  [${i + 1}] ${a}`));
  }

  // Skip already-handled actors (comma-separated EXCLUDE_ADDRESSES in .env)
  const excludeSet = new Set(
    (process.env.EXCLUDE_ADDRESSES ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean)
  );
  const filteredActors = badActors.filter((a) => !excludeSet.has(a));
  if (excludeSet.size > 0) {
    console.log(`\nSkipping ${badActors.length - filteredActors.length} already-handled actor(s).`);
  }

  // 2) Collect all referred wallets for each bad actor
  const allTargetsSet = new Set<string>(filteredActors);

  for (const actor of filteredActors) {
    const referrals = await fetchAllRows<{ referred_address: string }>(
      supabase, "referrals", "referred_address", { referrer_address: actor }
    );
    for (const r of referrals) allTargetsSet.add(r.referred_address.toLowerCase());
  }

  const allTargets = Array.from(allTargetsSet);
  console.log(`\nTotal wallets to blacklist: ${allTargets.length}`);
  console.log(`  (${badActors.length} referrers + their referred wallets)\n`);

  if (DRY_RUN) {
    console.log("[DRY RUN] No on-chain transactions sent.");
    console.log("To execute: DRY_RUN=false npx hardhat run scripts/blacklist-bad-actors.ts --network celo");
    return;
  }

  // 3) Connect to V2 and send batches
  const [signer] = await ethers.getSigners();
  const v2 = new ethers.Contract(v2Address, AKIBA_V2_ABI, signer);

  const isOwner  = (await v2.owner()).toLowerCase() === signer.address.toLowerCase();
  const isMinter = await v2.minters(signer.address);
  if (!isOwner && !isMinter) {
    throw new Error(`Signer ${signer.address} is not owner or minter on AkibaMilesV2`);
  }

  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice
    ? (feeData.gasPrice * 130n) / 100n
    : ethers.parseUnits("5", "gwei");
  console.log("Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei\n");

  const chunks: string[][] = [];
  for (let i = 0; i < allTargets.length; i += CHUNK_SIZE) {
    chunks.push(allTargets.slice(i, i + CHUNK_SIZE));
  }

  const startChunk = parseInt(process.env.START_CHUNK ?? "1", 10) - 1;
  console.log(`Sending chunks ${startChunk + 1}–${chunks.length} (${CHUNK_SIZE} each)...\n`);

  for (let i = startChunk; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`  Chunk ${i + 1}/${chunks.length} (${chunk.length} addresses)...`);
    const tx = await withRetry(`chunk ${i + 1}`, () =>
      v2.batchSetBlacklist(chunk, true, { gasPrice })
    );
    console.log(`  Tx hash: ${tx.hash}`);
    await tx.wait();
    console.log(`  ✅ Done.`);
  }

  console.log("\n✅ All chunks blacklisted.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
