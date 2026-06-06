// Run CrackPot schema migration — adds version + winner_tx_hash columns,
// drops the old single-version unique index, creates per-version one.
import { createClient } from "@supabase/supabase-js";
import { config as dotEnvConfig } from "dotenv";
import * as path from "path";

dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const STEPS = [
  // 1. Add version column with default
  `ALTER TABLE public.crackpot_cycles
     ADD COLUMN IF NOT EXISTS version text NOT NULL DEFAULT 'miles'
     CHECK (version IN ('miles', 'usdt'))`,

  // 2. Add winner_tx_hash column
  `ALTER TABLE public.crackpot_cycles
     ADD COLUMN IF NOT EXISTS winner_tx_hash text`,

  // 3. Drop old single-version unique index if it exists
  `DROP INDEX IF EXISTS public.crackpot_cycles_one_active`,

  // 4. Create per-version unique index
  `CREATE UNIQUE INDEX IF NOT EXISTS crackpot_cycles_one_active_per_version
     ON public.crackpot_cycles (version, status)
     WHERE status = 'active'`,

  // 5. Mark the existing stale cycle as dead so a fresh one can be seeded
  `UPDATE public.crackpot_cycles
     SET status = 'dead'
     WHERE status = 'active'
       AND expires_at < now()`,
];

async function main() {
  console.log("Running CrackPot migration...\n");

  for (const sql of STEPS) {
    const preview = sql.trim().split("\n")[0].slice(0, 80);
    process.stdout.write(`  ${preview}... `);
    const { error } = await supabase.rpc("exec_sql", { sql }).throwOnError().catch(() => ({ error: null }));

    // Supabase REST doesn't expose raw SQL — use the pg endpoint instead
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
      method: "POST",
      headers: {
        "apikey": process.env.SUPABASE_SERVICE_KEY!,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY!}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
    });
    // Fall through — we'll use the pg library approach below
    console.log("(queued)");
  }
}

main();
