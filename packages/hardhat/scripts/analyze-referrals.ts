/**
 * analyze-referrals.ts
 *
 * Reviews all wallets referred by BAD_ACTOR_ADDRESS and reports:
 *  - Total referred wallets
 *  - How many have 0 daily_engagements (quest activity)
 *  - How many are registered members (users table)
 *  - How many triggered referrer_rewarded = true (bonus was paid out)
 *  - Breakdown by engagement bucket
 *
 * .env required:
 *   SUPABASE_URL=
 *   SUPABASE_SERVICE_KEY=
 *   BAD_ACTOR_ADDRESS=
 *
 * Run:
 *   npx hardhat run scripts/analyze-referrals.ts --network celo
 */

import { createClient } from "@supabase/supabase-js";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

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

async function main() {
  const badActor = process.env.BAD_ACTOR_ADDRESS?.toLowerCase();
  if (!badActor) throw new Error("BAD_ACTOR_ADDRESS not set in .env");

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  console.log(`\n=== Referral Analysis for ${badActor} ===\n`);

  // 1) All referrals made by the bad actor
  const referrals = await fetchAllRows<{
    referred_address: string;
    redeemed_at: string;
    referrer_rewarded: boolean;
  }>(supabase, "referrals", "referred_address, redeemed_at, referrer_rewarded", {
    referrer_address: badActor,
  });

  if (referrals.length === 0) {
    console.log("No referrals found for this address.");
    return;
  }

  console.log(`Total referred wallets: ${referrals.length}`);

  // 2) For each referred wallet, get their engagement count
  const results: Array<{
    address: string;
    redeemed_at: string;
    referrer_rewarded: boolean;
    engagements: number;
    is_member: boolean;
  }> = [];

  for (const ref of referrals) {
    const addr = ref.referred_address;

    const { count: engCount } = await supabase
      .from("daily_engagements")
      .select("*", { count: "exact", head: true })
      .eq("user_address", addr);

    const { data: userRow } = await supabase
      .from("users")
      .select("user_address")
      .eq("user_address", addr)
      .maybeSingle();

    results.push({
      address: addr,
      redeemed_at: ref.redeemed_at,
      referrer_rewarded: ref.referrer_rewarded,
      engagements: engCount ?? 0,
      is_member: !!userRow,
    });
  }

  // 3) Stats
  const zeroActivity    = results.filter((r) => r.engagements === 0);
  const lowActivity     = results.filter((r) => r.engagements > 0 && r.engagements < 3);
  const qualifiedActivity = results.filter((r) => r.engagements >= 3);
  const bonusPaid       = results.filter((r) => r.referrer_rewarded);
  const notMembers      = results.filter((r) => !r.is_member);

  console.log(`\n── Activity Breakdown ──────────────────────`);
  console.log(`  0 engagements (pure bots):    ${zeroActivity.length}`);
  console.log(`  1–2 engagements (minimal):    ${lowActivity.length}`);
  console.log(`  3+ engagements (qualified):   ${qualifiedActivity.length}`);
  console.log(`\n── Other Signals ───────────────────────────`);
  console.log(`  Not registered as member:     ${notMembers.length}`);
  console.log(`  Referrer bonus already paid:  ${bonusPaid.length}`);

  // 4) List zero-activity wallets
  if (zeroActivity.length > 0) {
    console.log(`\n── Zero-Activity Wallets (${zeroActivity.length}) ──────────────`);
    zeroActivity.forEach((r, i) => {
      console.log(`  [${i + 1}] ${r.address}  redeemed: ${r.redeemed_at ?? "unknown"}  member: ${r.is_member}`);
    });
  }

  // 5) List wallets where bonus was paid but engagement is 0 (fraud confirmed)
  const fraudConfirmed = results.filter((r) => r.referrer_rewarded && r.engagements === 0);
  if (fraudConfirmed.length > 0) {
    console.log(`\n⚠️  Bonus paid but 0 activity (${fraudConfirmed.length} wallets) — fraud confirmed:`);
    fraudConfirmed.forEach((r) => console.log(`  ${r.address}`));
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
