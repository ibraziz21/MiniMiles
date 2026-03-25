/**
 * migrate-to-v2.ts  — DRY RUN MODE
 *
 * Reads eligible users from Supabase and V1 balances, then prints
 * what each batch would migrate. No burns or mints are executed.
 *
 * .env required:
 *   SUPABASE_URL=
 *   SUPABASE_SERVICE_KEY=
 *   MINIPOINTS_ADDRESS=   (V1)
 *
 * Run:
 *   npx hardhat run scripts/migrate-to-v2.ts --network celo
 */

import { ethers } from "hardhat";
import { createClient } from "@supabase/supabase-js";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const BATCH_SIZE = 200;

const V1_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  supabase: ReturnType<typeof createClient>,
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

async function getEligibleUsers(): Promise<string[]> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  const engaged = await fetchAllRows<{ user_address: string }>(supabase, "daily_engagements", "user_address");
  const engagedSet = new Set(engaged.map((r) => r.user_address));

  const blacklist = await fetchAllRows<{ address: string }>(supabase, "blacklisted_addresses", "address");
  const blacklistSet = new Set(blacklist.map((r) => r.address));

  const members = await fetchAllRows<{ user_address: string }>(supabase, "users", "user_address", { is_member: true });

  const eligible = members
    .map((r) => r.user_address)
    .filter((addr) => engagedSet.has(addr) && !blacklistSet.has(addr));

  console.log("=== Eligibility Summary ===");
  console.log(`Total members:   ${members.length}`);
  console.log(`With engagement: ${engagedSet.size}`);
  console.log(`Blacklisted:     ${blacklistSet.size}`);
  console.log(`Eligible:        ${eligible.length}`);
  console.log("");

  return eligible;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Dry-run as:", deployer.address);

  const v1Address = process.env.MINIPOINTS_ADDRESS;
  if (!v1Address) throw new Error("Set MINIPOINTS_ADDRESS in .env");

  const v1 = new ethers.Contract(v1Address, V1_ABI, deployer);

  const eligible = await getEligibleUsers();
  const total = eligible.length;
  const numBatches = Math.ceil(total / BATCH_SIZE);

  console.log(`=== Batch Preview (${numBatches} batches of up to ${BATCH_SIZE}) ===\n`);

  let totalWithBalance = 0;
  let totalZeroBalance = 0;
  let grandTotalTokens = 0n;

  for (let b = 0; b < numBatches; b++) {
    const slice = eligible.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

    const balances: bigint[] = await Promise.all(
      slice.map((addr) => v1.balanceOf(addr) as Promise<bigint>)
    );

    const withBalance = slice
      .map((addr, i) => ({ addr, bal: balances[i] }))
      .filter(({ bal }) => bal > 0n);

    const zeroCount = slice.length - withBalance.length;
    const batchTotal = withBalance.reduce((sum, { bal }) => sum + bal, 0n);

    grandTotalTokens += batchTotal;
    totalWithBalance += withBalance.length;
    totalZeroBalance += zeroCount;

    console.log(`Batch ${String(b + 1).padStart(3, " ")}/${numBatches}:`
      + `  ${String(withBalance.length).padStart(3)} to migrate`
      + `  ${String(zeroCount).padStart(3)} zero-balance`
      + `  total = ${ethers.formatUnits(batchTotal, 18)} Miles`
    );
  }

  console.log("");
  console.log("=== Totals ===");
  console.log(`Addresses to migrate: ${totalWithBalance}`);
  console.log(`Zero-balance (skip):  ${totalZeroBalance}`);
  console.log(`Total tokens to move: ${ethers.formatUnits(grandTotalTokens, 18)} Miles`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
