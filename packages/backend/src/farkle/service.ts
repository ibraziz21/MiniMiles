import { supabase } from "../supabaseClient";
import {
  isFarkleMatchSettledOnChain,
  readFarkleRewardCreditCents,
  settleFarkleOnChain,
  simulateFarkleSettlement,
  type FarkleSettlementParams,
  type HexAddress,
} from "./settleOnChain";

const isHexAddress = (value: string | null | undefined): value is HexAddress =>
  !!value && /^0x[a-fA-F0-9]{40}$/.test(value);

interface MatchRow {
  id: string;
  chain_id: number | null;
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

export interface FarkleSettleResult {
  matchId: string;
  alreadySettled: boolean;
  txHash: string | null;
  rewardCreditsCents: number | null;
}

function toSettlementParams(match: MatchRow): FarkleSettlementParams {
  if (!isHexAddress(match.winner_address) || !isHexAddress(match.loser_address)) {
    throw new Error("invalid winner/loser address");
  }

  const mode = match.game_modes;
  return {
    matchId: match.id,
    modeKey: mode?.mode_key ?? "",
    winnerAddress: match.winner_address,
    loserAddress: match.loser_address,
    winnerScore: match.winner_score ?? 0,
    loserScore: match.loser_score ?? 0,
    winMiles: mode?.winner_miles_reward ?? 10,
    losMiles: mode?.loser_miles_reward ?? 5,
    winCreditCents: mode?.winner_reward_credit ?? 0,
    replayHash: match.replay_hash ?? undefined,
    resultHash: match.result_hash ?? undefined,
  };
}

async function getCompletedMatch(matchId: string): Promise<MatchRow> {
  const { data, error } = await supabase
    .from("game_matches")
    .select(
      "id,chain_id,winner_address,loser_address,winner_score,loser_score,replay_hash,result_hash," +
        "game_modes(mode_key,winner_miles_reward,loser_miles_reward,winner_reward_credit)",
    )
    .eq("id", matchId)
    .eq("status", "completed")
    .maybeSingle();

  if (error) throw new Error(`match query failed: ${error.message}`);
  if (!data) throw new Error("completed match not found");
  return data as unknown as MatchRow;
}

async function markSettled(matchId: string) {
  const { error } = await supabase
    .from("game_matches")
    .update({ settled_at: new Date().toISOString() })
    .eq("id", matchId)
    .is("settled_at", null);
  if (error) console.error(`[farkle/service] failed to set settled_at matchId=${matchId}:`, error.message);
}

async function syncRewardMirror(winnerAddress: HexAddress, expectedCreditCents: number, chainId?: number) {
  if (expectedCreditCents <= 0) return null;
  const rewardCreditsCents = await readFarkleRewardCreditCents(winnerAddress, chainId);
  await supabase.from("farkle_credit_balances").upsert(
    {
      wallet_address: winnerAddress.toLowerCase(),
      reward_credits_cents: rewardCreditsCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet_address" },
  );
  return rewardCreditsCents;
}

async function writeRewardLedger(match: MatchRow, params: FarkleSettlementParams, txHash: string | null) {
  const { data: existing } = await supabase
    .from("game_credit_ledger")
    .select("id")
    .eq("reference_type", "match")
    .eq("reference_id", match.id)
    .eq("ledger_type", "AKIBAMILES_REWARD_GRANTED")
    .limit(1);
  if (existing?.length) return;

  const { error } = await supabase.from("game_credit_ledger").insert([
    {
      wallet_address: params.winnerAddress.toLowerCase(),
      amount: params.winMiles,
      currency: "AKIBAMILES",
      ledger_type: "AKIBAMILES_REWARD_GRANTED",
      reference_type: "match",
      reference_id: match.id,
      tx_hash: txHash,
    },
    {
      wallet_address: params.loserAddress.toLowerCase(),
      amount: params.losMiles,
      currency: "AKIBAMILES",
      ledger_type: "AKIBAMILES_REWARD_GRANTED",
      reference_type: "match",
      reference_id: match.id,
      tx_hash: txHash,
    },
  ]);
  if (error) console.error(`[farkle/service] reward ledger insert failed matchId=${match.id}:`, error.message);
}

export async function settleCompletedFarkleMatch(matchId: string): Promise<FarkleSettleResult> {
  const match   = await getCompletedMatch(matchId);
  const params  = toSettlementParams(match);
  const chainId = match.chain_id ?? undefined;

  const alreadySettled = await isFarkleMatchSettledOnChain(matchId, chainId);

  let txHash: string | null = null;
  if (alreadySettled) {
    console.log(
      `[farkle/service] matchId=${matchId} modeKey=${params.modeKey}` +
      ` winner=${params.winnerAddress} — already settled on-chain`,
    );
    // Still sync the off-chain mirror in case it was missed
    await markSettled(matchId);
  } else {
    console.log(
      `[farkle/service] settling matchId=${matchId} modeKey=${params.modeKey}` +
      ` winner=${params.winnerAddress} loser=${params.loserAddress}` +
      ` winMiles=${params.winMiles} losMiles=${params.losMiles} winCreditCents=${params.winCreditCents}`,
    );
    txHash = await settleFarkleOnChain(params, chainId);
    console.log(`[farkle/service] settled matchId=${matchId} txHash=${txHash}`);
    await markSettled(matchId);
  }

  const rewardCreditsCents = await syncRewardMirror(params.winnerAddress, params.winCreditCents, chainId);
  await writeRewardLedger(match, params, txHash);

  return { matchId, alreadySettled, txHash, rewardCreditsCents };
}

export interface ReconcileResult {
  checked: number;
  settled: { matchId: string; txHash: string | null }[];
  alreadySettled: number;
  reverted: { matchId: string; error: string }[];
  failed: { matchId: string; error: string }[];
}

export async function reconcileFarkleSettlements(opts: { sinceDays?: number; limit?: number } = {}): Promise<ReconcileResult> {
  const sinceDays = opts.sinceDays ?? 7;
  const limit = opts.limit ?? 25;
  const sinceIso = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const result: ReconcileResult = { checked: 0, settled: [], alreadySettled: 0, reverted: [], failed: [] };

  // Filter settled_at IS NULL to skip rows already confirmed on-chain.
  // This avoids one RPC call per match on every reconcile run.
  const { data, error } = await supabase
    .from("game_matches")
    .select(
      "id,chain_id,winner_address,loser_address,winner_score,loser_score,replay_hash,result_hash," +
        "game_modes(mode_key,winner_miles_reward,loser_miles_reward,winner_reward_credit)",
    )
    .eq("status", "completed")
    .is("settled_at", null)
    .gte("completed_at", sinceIso)
    .order("completed_at", { ascending: true });

  if (error) throw new Error(`reconcile query failed: ${error.message}`);

  console.log(`[farkle/service] reconcile starting: ${(data ?? []).length} unsettled matches (last ${sinceDays}d)`);

  for (const match of (data ?? []) as unknown as MatchRow[]) {
    if (result.settled.length >= limit) break;
    result.checked++;

    try {
      const params  = toSettlementParams(match);
      const chainId = match.chain_id ?? undefined;

      if (await isFarkleMatchSettledOnChain(match.id, chainId)) {
        result.alreadySettled++;
        console.log(`[farkle/service] reconcile matchId=${match.id} — already settled, syncing mirror`);
        await markSettled(match.id);
        await syncRewardMirror(params.winnerAddress, params.winCreditCents, chainId);
        await writeRewardLedger(match, params, null);
        continue;
      }

      const sim = await simulateFarkleSettlement(params, chainId);
      if (!sim.ok) {
        result.reverted.push({ matchId: match.id, error: sim.error });
        console.warn(`[farkle/service] reconcile matchId=${match.id} would revert — skipping: ${sim.error}`);
        continue;
      }

      const settled = await settleCompletedFarkleMatch(match.id);
      result.settled.push({ matchId: match.id, txHash: settled.txHash });
      console.log(`[farkle/service] reconcile settled matchId=${match.id} txHash=${settled.txHash}`);
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.reason ?? e?.message ?? String(e);
      if (/AlreadySettled/i.test(msg)) {
        result.alreadySettled++;
        await markSettled(match.id);
      } else {
        result.failed.push({ matchId: match.id, error: msg });
        console.error(`[farkle/service] reconcile failed matchId=${match.id}: ${msg}`);
      }
    }
  }

  console.log(
    `[farkle/service] reconcile done: checked=${result.checked} settled=${result.settled.length}` +
    ` alreadySettled=${result.alreadySettled} reverted=${result.reverted.length} failed=${result.failed.length}`,
  );

  return result;
}
