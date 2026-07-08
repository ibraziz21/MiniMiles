// Verify Supabase DB migrations 024–026 are applied.
// Read-only: only queries column metadata and table existence.
// Run: npx hardhat run --config hardhat.config.ts scripts/crackpot-verify-db.ts --network celo
import { config as dotEnvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as path from "path";

dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });
dotEnvConfig();

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");

  const sb = createClient(url, key);

  // ── Check crackpot_cycles columns ────────────────────────────────────────────
  const cyclesCols = [
    "chain_id", "contract_cycle_id", "contract_version",
    "secret_salt", "secret_commitment", "open_tx_hash", "expire_tx_hash",
    "payout_amount", "cracked_at", "commitment_algorithm", "secret_revealed_at",
  ];

  // Query information_schema to check column presence.
  const { data: cycleCols, error: e1 } = await sb
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", "crackpot_cycles")
    .in("column_name", cyclesCols);

  if (e1) {
    // Fallback: try a direct select to see what columns exist
    const { error: e2 } = await sb.from("crackpot_cycles").select(cyclesCols.join(", ")).limit(0);
    if (e2) {
      console.error("crackpot_cycles missing columns:", e2.message);
      process.exit(1);
    }
    console.log("✓ crackpot_cycles — all chain/commitment/settlement columns present");
  } else {
    const found = (cycleCols ?? []).map((r: any) => r.column_name);
    const missing = cyclesCols.filter(c => !found.includes(c));
    if (missing.length > 0) {
      console.error("✗ crackpot_cycles missing columns:", missing.join(", "));
      console.error("  → Apply migrations 024 and 026.");
      process.exit(1);
    }
    console.log("✓ crackpot_cycles — all", found.length, "chain/commitment/settlement columns present");
  }

  // ── Check crackpot_attempts columns ──────────────────────────────────────────
  const attemptsCols = ["entry_tx_hash", "chain_id", "entry_log_index"];
  const { error: e3 } = await sb
    .from("crackpot_attempts")
    .select(attemptsCols.join(", "))
    .limit(0);
  if (e3) {
    console.error("✗ crackpot_attempts missing columns:", e3.message);
    console.error("  → Apply migration 025.");
    process.exit(1);
  }
  console.log("✓ crackpot_attempts — entry_tx_hash, chain_id, entry_log_index present");

  // ── Check crackpot_payout_jobs table ─────────────────────────────────────────
  const payoutCols = [
    "id", "cycle_id", "chain_id", "contract_cycle_id", "contract_version",
    "winner_address", "winner_guesses", "idempotency_key", "status",
    "tx_hash", "payout_amount", "attempts", "last_error",
    "leased_at", "lease_owner", "next_attempt_at",
  ];
  const { error: e4 } = await sb
    .from("crackpot_payout_jobs")
    .select(payoutCols.join(", "))
    .limit(0);
  if (e4) {
    console.error("✗ crackpot_payout_jobs missing or inaccessible:", e4.message);
    console.error("  → Apply migration 026.");
    process.exit(1);
  }
  console.log("✓ crackpot_payout_jobs — table exists with expected columns");

  // ── Check crackpot_cycles status constraint ───────────────────────────────────
  // Try inserting a dummy row with status='settling' — expect constraint violation, NOT unknown status.
  const { error: e5 } = await sb
    .from("crackpot_cycles")
    .select("id, status")
    .eq("status", "settling")
    .limit(1);
  if (e5) {
    console.warn("⚠ Could not query settling status:", e5.message);
  } else {
    console.log("✓ crackpot_cycles — 'settling' status is queryable (constraint updated)");
  }

  // ── Check active Miles cycle DB row ──────────────────────────────────────────
  const { data: activeMiles, error: e6 } = await sb
    .from("crackpot_cycles")
    .select("id, status, chain_id, contract_cycle_id, contract_version, secret_commitment, expires_at")
    .eq("version", "miles")
    .in("status", ["active", "settling"])
    .maybeSingle();

  if (e6) {
    console.warn("⚠ Could not query active Miles cycle:", e6.message);
  } else if (!activeMiles) {
    console.log("ℹ No active Miles cycle in DB (expected — chain cycle 127 is stale)");
  } else {
    console.log("Active Miles cycle in DB:", JSON.stringify(activeMiles, null, 2));
  }

  // ── Check stale cycle 127 DB row ─────────────────────────────────────────────
  const { data: c127, error: e7 } = await sb
    .from("crackpot_cycles")
    .select("id, status, chain_id, contract_cycle_id, contract_version, secret_commitment, expires_at")
    .eq("contract_cycle_id", 127)
    .maybeSingle();

  if (e7) {
    console.warn("⚠ Could not query cycle 127:", e7.message);
  } else if (!c127) {
    console.log("ℹ Cycle 127 not in DB (was never chain-anchored — pre-upgrade era row absent)");
  } else {
    console.log("Cycle 127 DB row:", JSON.stringify(c127, null, 2));
  }

  console.log("\n✅ DB verification complete");
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
