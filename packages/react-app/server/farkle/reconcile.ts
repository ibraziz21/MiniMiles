// server/farkle/reconcile.ts
//
// Self-healing settlement sweep. The match-end paths settle inline, but a single
// transient failure (RPC blip, gas spike, nonce race) would otherwise strand a
// match: status=completed in the DB, but settledMatches(matchId)=false on-chain
// and nothing minted. This sweep finds those and settles them.
//
// Idempotent + gas-safe:
//   · skips matches already settled on-chain (settleMatch is replay-protected)
//   · simulates before sending, so a permanently-reverting match (bad data /
//     contract guard) is skipped instead of burning gas on a doomed tx
//
// Run on a schedule (Vercel cron → /api/games/farkle/reconcile).

import { createClient } from "@supabase/supabase-js";
import {
  settleFarkleOnChain,
  simulateFarkleSettlement,
  isMatchSettledOnChain,
  type FarkleSettlementParams,
} from "@/server/farkle/settleOnChain";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

type HexAddress = `0x${string}`;
const isHexAddress = (v: string | null | undefined): v is HexAddress =>
  !!v && /^0x[a-fA-F0-9]{40}$/.test(v);

export interface ReconcileOptions {
  /** Only consider matches completed within this many days. Default 7. */
  sinceDays?: number;
  /** Max matches to settle per run (bounds gas + runtime). Default 25. */
  limit?: number;
}

export interface ReconcileResult {
  checked: number;
  settled: { matchId: string; txHash: string }[];
  alreadySettled: number;
  reverted: { matchId: string; error: string }[];
  failed: { matchId: string; error: string }[];
}

// Shape of the joined query row. Declared explicitly because Supabase can't
// infer embedded-relation selects without generated DB types (it widens the row
// to a GenericStringError union otherwise).
interface MatchRow {
  id: string;
  winner_address: string | null;
  loser_address: string | null;
  winner_score: number | null;
  loser_score: number | null;
  replay_hash: string | null;
  result_hash: string | null;
  game_modes: {
    mode_key: string | null;
    winner_miles_reward: number | null;
    loser_miles_reward: number | null;
    winner_reward_credit: number | null;
  } | null;
}

export async function reconcileFarkleSettlements(opts: ReconcileOptions = {}): Promise<ReconcileResult> {
  const sinceDays = opts.sinceDays ?? 7;
  const limit = opts.limit ?? 25;
  const sinceIso = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

  const result: ReconcileResult = { checked: 0, settled: [], alreadySettled: 0, reverted: [], failed: [] };

  // settled_at IS NULL skips matches already confirmed on-chain,
  // saving one RPC call per settled match per reconcile run.
  const { data: matches, error } = await supabase
    .from("game_matches")
    .select(
      "id,winner_address,loser_address,winner_score,loser_score,replay_hash,result_hash," +
        "game_modes(mode_key,winner_miles_reward,loser_miles_reward,winner_reward_credit)",
    )
    .eq("status", "completed")
    .is("settled_at", null)
    .gte("completed_at", sinceIso)
    .order("completed_at", { ascending: true });

  if (error) {
    console.error("[farkle/reconcile] query failed:", error.message);
    throw new Error(`reconcile query failed: ${error.message}`);
  }

  for (const m of (matches ?? []) as unknown as MatchRow[]) {
    if (result.settled.length >= limit) break;

    const matchId = m.id;

    if (!isHexAddress(m.winner_address) || !isHexAddress(m.loser_address)) {
      result.failed.push({ matchId, error: "invalid winner/loser address" });
      continue;
    }

    result.checked++;

    // Cheap on-chain read first — most matches are already settled.
    let settledAlready: boolean;
    try {
      settledAlready = await isMatchSettledOnChain(matchId);
    } catch (e: any) {
      result.failed.push({ matchId, error: `settled-check failed: ${e?.shortMessage ?? e?.message}` });
      continue;
    }
    if (settledAlready) {
      result.alreadySettled++;
      // Sync settled_at so this match is skipped on the next run
      await supabase.from("game_matches")
        .update({ settled_at: new Date().toISOString() })
        .eq("id", matchId).is("settled_at", null);
      continue;
    }

    const gm = m.game_modes ?? {} as NonNullable<MatchRow["game_modes"]>;
    const params: FarkleSettlementParams = {
      matchId,
      modeKey: gm.mode_key ?? "",
      winnerAddress: m.winner_address as HexAddress,
      loserAddress: m.loser_address as HexAddress,
      winnerScore: m.winner_score ?? 0,
      loserScore: m.loser_score ?? 0,
      winMiles: gm.winner_miles_reward ?? 10,
      losMiles: gm.loser_miles_reward ?? 5,
      winCreditCents: gm.winner_reward_credit ?? 0,
      replayHash: m.replay_hash ?? undefined,
      resultHash: m.result_hash ?? undefined,
    };

    // Dry-run: don't spend gas on a tx that will revert (e.g. 0x09550c77).
    const sim = await simulateFarkleSettlement(params);
    if (!sim.ok) {
      result.reverted.push({ matchId, error: sim.error });
      console.warn(`[farkle/reconcile] ${matchId} would revert — skipping:`, sim.error);
      continue;
    }

    try {
      const txHash = await settleFarkleOnChain(params);
      result.settled.push({ matchId, txHash });
      console.log(`[farkle/reconcile] settled ${matchId} -> ${txHash}`);
      await supabase.from("game_matches")
        .update({ settled_at: new Date().toISOString() })
        .eq("id", matchId).is("settled_at", null);
    } catch (e: any) {
      const err = e?.shortMessage ?? e?.message ?? String(e);
      if (/AlreadySettled/i.test(err)) {
        result.alreadySettled++;
        await supabase.from("game_matches")
          .update({ settled_at: new Date().toISOString() })
          .eq("id", matchId).is("settled_at", null);
        continue;
      }
      result.failed.push({ matchId, error: err });
      console.error(`[farkle/reconcile] settle failed for ${matchId}:`, err);
    }
  }

  console.log(
    `[farkle/reconcile] done: checked=${result.checked} settled=${result.settled.length} ` +
      `alreadySettled=${result.alreadySettled} reverted=${result.reverted.length} failed=${result.failed.length}`,
  );
  return result;
}
