import { supabase } from "../supabaseClient";
import { createHash, randomBytes, randomUUID } from "crypto";
import {
  isFarkleMatchSettledOnChain,
  readFarkleRewardCreditCents,
  settleFarkleOnChain,
  simulateFarkleSettlement,
  type FarkleSettlementParams,
  type HexAddress,
} from "./settleOnChain";
import {
  countFarkleSettlementJobsByStatus,
  getFarkleSettlementJob,
  getFarkleSettlementJobById,
  isMissingFarkleSettlementJobsTable,
  leaseFarkleSettlementJobs,
  listFarkleSettlementJobs,
  markFarkleJobConfirmed,
  markFarkleJobRetrying,
  upsertFarkleSettlementJob,
  type FarkleSettlementJobRow,
  type FarkleSettlementJobStatus,
} from "./settlementJobs";

const isHexAddress = (value: string | null | undefined): value is HexAddress =>
  !!value && /^0x[a-fA-F0-9]{40}$/.test(value);

const INVITE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
function generateInviteCode(): string {
  const bytes = randomBytes(4);
  const part = Array.from(bytes).map((b) => INVITE_CODE_CHARS[b % INVITE_CODE_CHARS.length]).join("");
  return `FARK-${part}`;
}

const ACTIVE_MATCH_STATUSES = ["created", "funded", "in_progress"];
const FARKLE_MODE_KEYS = new Set(["FARKLE_QUICK_1500_AKIBA", "FARKLE_REWARD_3000_USDT"]);
const FARKLE_QUEUE_TTL_MS = Number(process.env.FARKLE_QUEUE_TTL_MS ?? "120000") || 120_000;
const FARKLE_TURN_TIMEOUT_SECONDS = Number(process.env.FARKLE_TURN_TIMEOUT_SECONDS ?? "60") || 60;
const FARKLE_MATCH_STALE_SECONDS = Number(process.env.FARKLE_MATCH_STALE_SECONDS ?? "300") || 300;
const FARKLE_SUPABASE_TIMEOUT_MS = Number(process.env.FARKLE_SUPABASE_TIMEOUT_MS ?? "4500") || 4_500;
const FARKLE_SUPABASE_RETRIES = Number(process.env.FARKLE_SUPABASE_RETRIES ?? "2") || 2;
const FARKLE_SETTLEMENT_WORKER_INTERVAL_MS =
  Number(process.env.FARKLE_SETTLEMENT_WORKER_INTERVAL_MS ?? process.env.SETTLE_RETRY_INTERVAL_MS ?? "60000") ||
  60_000;
const FARKLE_SETTLEMENT_WORKER_LIMIT = Number(process.env.FARKLE_SETTLEMENT_WORKER_LIMIT ?? "3") || 3;
const FARKLE_SETTLEMENT_WORKER_ID = `farkle-${process.pid}-${randomUUID()}`;

interface MatchRow {
  id: string;
  status?: string | null;
  chain_id: number | null;
  current_turn_address?: string | null;
  turn_started_at?: string | null;
  last_action_at?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
  winner_address: string | null;
  loser_address: string | null;
  winner_score: number | null;
  loser_score: number | null;
  replay_hash: string | null;
  result_hash: string | null;
  game_modes: {
    mode_key: string | null;
    entry_currency?: string | null;
    winner_miles_reward: number | null;
    loser_miles_reward: number | null;
    winner_reward_credit: number | null;
  } | null;
}

interface PlayerRow {
  match_id: string;
  wallet_address: string;
  banked_score: number | null;
  entry_debited?: boolean | null;
  seat_index?: number | null;
}

interface QueueRow {
  status: string;
  match_id: string | null;
  wallet_address?: string;
  queued_at?: string;
}

type DbErrorLike = {
  message?: string;
  details?: string | null;
  code?: string | null;
};

type DbResult<T = unknown> = {
  data?: T | null;
  error?: DbErrorLike | null;
  count?: number | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dbErrorText(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  const e = error as DbErrorLike;
  return [e.message, e.details, e.code].filter(Boolean).join(" ");
}

function isTransientDbError(error: unknown) {
  const text = dbErrorText(error).toLowerCase();
  if (!text) return false;
  return (
    text.includes("fetch failed") ||
    text.includes("socket") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("und_err") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("network")
  );
}

async function withTimeout<T>(promise: PromiseLike<T>, label: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const err = new Error(`${label} timed out after ${timeoutMs}ms`);
          err.name = "TimeoutError";
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function withSupabaseRetry<T extends DbResult>(
  label: string,
  operation: () => PromiseLike<T>,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? FARKLE_SUPABASE_TIMEOUT_MS;
  const retries = opts.retries ?? FARKLE_SUPABASE_RETRIES;
  let lastThrown: unknown;
  let lastResult: T | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await withTimeout(operation(), label, timeoutMs);
      lastResult = result;
      if (!result.error || !isTransientDbError(result.error) || attempt >= retries) {
        return result;
      }
      console.warn(
        `[farkle/db] transient Supabase error label=${label} attempt=${attempt + 1}/${retries + 1}:` +
          ` ${dbErrorText(result.error)}`,
      );
    } catch (err) {
      lastThrown = err;
      if (!isTransientDbError(err) || attempt >= retries) throw err;
      console.warn(
        `[farkle/db] retrying Supabase op label=${label} attempt=${attempt + 1}/${retries + 1}:` +
          ` ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await sleep(200 * (attempt + 1));
  }

  if (lastResult) return lastResult;
  throw lastThrown instanceof Error ? lastThrown : new Error(String(lastThrown ?? "supabase op failed"));
}

async function readDb<T>(label: string, operation: () => PromiseLike<DbResult<any>>): Promise<DbResult<T>> {
  const result = await withSupabaseRetry(label, operation);
  if (result.error) throw new Error(`${label} failed: ${dbErrorText(result.error)}`);
  return result as DbResult<T>;
}

async function bestEffortDb(label: string, operation: () => PromiseLike<DbResult>) {
  try {
    const result = await withSupabaseRetry(label, operation);
    if (result.error) {
      console.warn(`[farkle/db] ${label} failed: ${dbErrorText(result.error)}`);
    }
  } catch (err) {
    console.warn(`[farkle/db] ${label} skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function generateServerSeed() {
  return createHash("sha256")
    .update(`${Date.now()}-${randomBytes(32).toString("hex")}-${process.env.SERVER_SEED_SECRET ?? "akiba"}`)
    .digest("hex");
}

function hashServerSeed(seed: string) {
  return createHash("sha256").update(seed).digest("hex");
}

function getMode(match: MatchRow) {
  const relation = match.game_modes;
  return Array.isArray(relation) ? relation[0] : relation;
}

function getModeKey(match: MatchRow) {
  return getMode(match)?.mode_key ?? null;
}

function isFarkleMatch(match: MatchRow) {
  const modeKey = getModeKey(match);
  return !!modeKey && FARKLE_MODE_KEYS.has(modeKey);
}

function matchActivityIso(match: MatchRow) {
  return match.last_action_at ?? match.turn_started_at ?? match.started_at ?? match.created_at;
}

function isOlderThan(iso: string | null | undefined, seconds: number, nowMs = Date.now()) {
  if (!iso) return false;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) && nowMs - value > seconds * 1000;
}

export interface FarkleSettleResult {
  matchId: string;
  alreadySettled: boolean;
  txHash: string | null;
  rewardCreditsCents: number | null;
  jobStatus?: string | null;
}

export interface FarkleRecoverySnapshot {
  ok: boolean;
  counts: Record<string, number>;
  jobs: FarkleSettlementJobRow[];
  missingJobs: Array<{
    matchId: string;
    modeKey: string | null;
    winnerAddress: string | null;
    loserAddress: string | null;
    winnerScore: number | null;
    loserScore: number | null;
    completedAt: string | null;
    settledAt: string | null;
  }>;
  tableMissing?: boolean;
  generatedAt: string;
}

let loggedMissingSettlementJobsTable = false;
let farkleSettlementWorkerTimer: ReturnType<typeof setInterval> | null = null;
let farkleSettlementWorkerBootTimer: ReturnType<typeof setTimeout> | null = null;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  const e = error as { shortMessage?: string; reason?: string; message?: string };
  return e?.shortMessage ?? e?.reason ?? e?.message ?? String(error);
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
  let rewardCreditsCents: number;
  try {
    rewardCreditsCents = await readFarkleRewardCreditCents(winnerAddress, chainId);
  } catch (err: any) {
    // Vault read is best-effort — Vercel reads on-chain balance directly for display.
    console.warn(`[farkle/service] syncRewardMirror skipped for ${winnerAddress}: ${err?.message ?? err}`);
    return null;
  }
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
  const { error } = await supabase.from("game_credit_ledger").upsert(
    [
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
    ],
    {
      onConflict: "reference_type,reference_id,ledger_type,wallet_address",
      ignoreDuplicates: true,
    },
  );
  if (error) console.error(`[farkle/service] reward ledger upsert failed matchId=${match.id}:`, error.message);
}

export async function expireWaitingFarkleQueue(now = new Date()) {
  const nowIso = now.toISOString();

  await bestEffortDb("expire waiting queue", () =>
    supabase
      .from("matchmaking_queue")
      .update({ status: "expired" })
      .eq("status", "waiting")
      .lt("expires_at", nowIso),
  );

  await bestEffortDb("expire stale matched reservation", () =>
    supabase
      .from("matchmaking_queue")
      .update({ status: "expired" })
      .eq("status", "matched")
      .is("match_id", null)
      .lt("expires_at", nowIso),
  );
}

async function refundMatchEntries(matchId: string) {
  const { data: players } = await readDb<PlayerRow[]>("read debited match players", () =>
    supabase
      .from("game_match_players")
      .select("wallet_address, entry_debited")
      .eq("match_id", matchId)
      .eq("entry_debited", true),
  );

  if (!players?.length) return;

  const { data: modeRow } = await readDb<any>("read refund match mode", () =>
    supabase
      .from("game_matches")
      .select("game_modes(mode_key, entry_currency)")
      .eq("id", matchId)
      .maybeSingle(),
  );

  const modeKey = modeRow?.game_modes?.mode_key ?? "";
  const isTicket = modeKey === "FARKLE_QUICK_1500_AKIBA";

  for (const player of players) {
    const addr = player.wallet_address;
    if (isTicket) {
      const { data: bal } = await readDb<{ balance: number }>("read ticket refund balance", () =>
        supabase
          .from("farkle_ticket_balances")
          .select("balance")
          .eq("wallet_address", addr)
          .maybeSingle(),
      );
      const newBal = (bal?.balance ?? 0) + 1;
      await bestEffortDb("write ticket refund balance", () =>
        supabase.from("farkle_ticket_balances").upsert(
          { wallet_address: addr, balance: newBal, updated_at: new Date().toISOString() },
          { onConflict: "wallet_address" },
        ),
      );
      await bestEffortDb("write ticket refund ledger", () =>
        supabase.from("game_credit_ledger").insert({
          wallet_address: addr,
          amount: 1,
          balance_after: newBal,
          currency: "AKIBA_TICKET",
          ledger_type: "AKIBA_TICKET_REFUNDED",
          reference_type: "match",
          reference_id: matchId,
        }),
      );
    } else {
      const { data: bal } = await readDb<{ purchased_credits: number }>("read credit refund balance", () =>
        supabase
          .from("farkle_credit_balances")
          .select("purchased_credits")
          .eq("wallet_address", addr)
          .maybeSingle(),
      );
      const newBal = (bal?.purchased_credits ?? 0) + 1;
      await bestEffortDb("write credit refund balance", () =>
        supabase.from("farkle_credit_balances").upsert(
          { wallet_address: addr, purchased_credits: newBal, updated_at: new Date().toISOString() },
          { onConflict: "wallet_address" },
        ),
      );
      await bestEffortDb("write credit refund ledger", () =>
        supabase.from("game_credit_ledger").insert({
          wallet_address: addr,
          amount: 1,
          balance_after: newBal,
          currency: "GAME_CREDIT",
          ledger_type: "GAME_CREDIT_REFUNDED",
          reference_type: "match",
          reference_id: matchId,
        }),
      );
    }
    console.log(`[farkle/service] refunded entry matchId=${matchId} wallet=${addr} modeKey=${modeKey}`);
  }
}

async function cancelMatch(match: MatchRow, reason: string, nowIso: string) {
  const { error } = await withSupabaseRetry("cancel stale match", () =>
    supabase
      .from("game_matches")
      .update({
        status: "cancelled",
        completed_at: nowIso,
        metadata: { ...(match.metadata ?? {}), endReason: reason },
      })
      .eq("id", match.id)
      .in("status", ACTIVE_MATCH_STATUSES),
  );
  if (error) {
    console.error(`[farkle/service] failed to cancel stale match matchId=${match.id} reason=${reason}:`, dbErrorText(error));
    return;
  }

  console.log(`[farkle/service] cancelled matchId=${match.id} reason=${reason}`);
  if (reason === "stale_incomplete_match") {
    await refundMatchEntries(match.id);
  }
}

async function completeTimeout(match: MatchRow, winner: PlayerRow, loser: PlayerRow, nowIso: string) {
  const { data: completedMatch, error: matchError } = await withSupabaseRetry("complete timeout match", () =>
    supabase
      .from("game_matches")
      .update({
        status: "completed",
        winner_address: winner.wallet_address,
        loser_address: loser.wallet_address,
        winner_score: winner.banked_score ?? 0,
        loser_score: loser.banked_score ?? 0,
        completed_at: nowIso,
        metadata: { ...(match.metadata ?? {}), endReason: "timeout_auto" },
      })
      .eq("id", match.id)
      .eq("status", "in_progress")
      .select("id")
      .maybeSingle(),
  );

  if (matchError) {
    console.error(`[farkle/service] failed to auto-timeout match matchId=${match.id}:`, dbErrorText(matchError));
    return;
  }
  if (!completedMatch) return;

  await bestEffortDb("record timeout winner", () =>
    supabase
      .from("game_match_players")
      .update({ result: "win" })
      .eq("match_id", match.id)
      .eq("wallet_address", winner.wallet_address),
  );
  await bestEffortDb("record timeout loser", () =>
    supabase
      .from("game_match_players")
      .update({ result: "loss" })
      .eq("match_id", match.id)
      .eq("wallet_address", loser.wallet_address),
  );

  console.log(
    `[farkle/service] auto-timeout matchId=${match.id} modeKey=${getModeKey(match) ?? ""}` +
      ` winner=${winner.wallet_address} loser=${loser.wallet_address}`,
  );

  try {
    await settleCompletedFarkleMatch(match.id);
  } catch (err: any) {
    console.error(
      `[farkle/service] auto-timeout settlement failed matchId=${match.id}; reconcile will retry:`,
      err?.message ?? err,
    );
  }
}

export async function reconcilePlayerFarkleSessions(address: string) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const { data: playerRows } = await readDb<PlayerRow[]>("read player farkle matches", () =>
    supabase
      .from("game_match_players")
      .select("match_id, wallet_address, banked_score")
      .eq("wallet_address", address),
  );

  const matchIds = [...new Set((playerRows ?? []).map((row) => row.match_id))];
  if (matchIds.length === 0) return;

  const [matchesResult, allPlayersResult] = await Promise.all([
    readDb<MatchRow[]>("read active farkle matches", () =>
      supabase
        .from("game_matches")
        .select(
          "id,status,current_turn_address,turn_started_at,last_action_at,started_at,created_at,metadata," +
            "game_modes(mode_key,winner_miles_reward,loser_miles_reward,winner_reward_credit)",
        )
        .in("id", matchIds)
        .in("status", ACTIVE_MATCH_STATUSES),
    ),
    readDb<PlayerRow[]>("read active farkle players", () =>
      supabase
        .from("game_match_players")
        .select("match_id, wallet_address, banked_score")
        .in("match_id", matchIds),
    ),
  ]);

  for (const match of ((matchesResult.data ?? []) as MatchRow[]).filter(isFarkleMatch)) {
    const players = ((allPlayersResult.data ?? []) as PlayerRow[]).filter((row) => row.match_id === match.id);
    const activityIso = matchActivityIso(match);

    if (players.length < 2) {
      if (isOlderThan(activityIso, FARKLE_MATCH_STALE_SECONDS, now)) {
        await cancelMatch(match, "stale_incomplete_match", nowIso);
      }
      continue;
    }

    if (isOlderThan(activityIso, FARKLE_MATCH_STALE_SECONDS, now)) {
      await cancelMatch(match, "stale_inactive_match", nowIso);
      continue;
    }

    if (
      match.status === "in_progress" &&
      match.current_turn_address &&
      isOlderThan(match.turn_started_at, FARKLE_TURN_TIMEOUT_SECONDS, now)
    ) {
      const loser = players.find((row) => row.wallet_address === match.current_turn_address);
      const winner = players.find((row) => row.wallet_address !== match.current_turn_address);
      if (winner && loser) {
        await completeTimeout(match, winner, loser, nowIso);
      } else {
        await cancelMatch(match, "invalid_timeout_players", nowIso);
      }
    }
  }
}

export async function getActiveFarkleMatchForPlayer(address: string) {
  await reconcilePlayerFarkleSessions(address);

  const { data: playerRows } = await readDb<Array<{ match_id: string }>>("read active player rows", () =>
    supabase
      .from("game_match_players")
      .select("match_id")
      .eq("wallet_address", address),
  );

  const matchIds = [...new Set((playerRows ?? []).map((row) => row.match_id))];
  if (matchIds.length === 0) return null;

  const { data: matches } = await readDb<MatchRow[]>("read active player match", () =>
    supabase
      .from("game_matches")
      .select("id, status, created_at, game_modes(mode_key)")
      .in("id", matchIds)
      .in("status", ACTIVE_MATCH_STATUSES)
      .order("created_at", { ascending: false }),
  );

  const match = ((matches ?? []) as MatchRow[]).find(isFarkleMatch);
  if (!match) return null;

  return {
    matchId: match.id,
    status: match.status ?? "in_progress",
    modeKey: getModeKey(match),
  };
}

export interface EnterFarkleMatchInput {
  address: string;
  modeKey: string;
  targetAddress?: string | null;
  inviteCode?: string | null;
}

export async function enterFarkleMatch(input: EnterFarkleMatchInput) {
  const address = input.address.toLowerCase();
  const modeKey = input.modeKey;
  let targetAddress = input.targetAddress ? input.targetAddress.toLowerCase() : null;

  // Resolve invite code to wallet address if provided and no explicit target
  if (!targetAddress && input.inviteCode) {
    const code = input.inviteCode.toUpperCase().trim();
    const { data: slot } = await supabase
      .from("matchmaking_queue")
      .select("wallet_address, mode_key")
      .eq("invite_code", code)
      .eq("status", "waiting")
      .gt("expires_at", new Date().toISOString())
      .neq("wallet_address", address)
      .maybeSingle();
    if (!slot) {
      return { statusCode: 404, body: { error: "invite_not_found", message: "Code not found or already used." } };
    }
    targetAddress = slot.wallet_address;
  }

  if (!FARKLE_MODE_KEYS.has(modeKey)) {
    return { statusCode: 400, body: { error: "invalid modeKey" } };
  }

  await expireWaitingFarkleQueue();

  const active = await getActiveFarkleMatchForPlayer(address);
  if (active) {
    console.log(`[farkle/service] reconnect wallet=${address} matchId=${active.matchId} modeKey=${active.modeKey}`);
    return { statusCode: 200, body: { status: "matched", matchId: active.matchId, modeKey: active.modeKey } };
  }

  const { data: existingQueue } = await readDb<QueueRow>("read existing queue row", () =>
    supabase
      .from("matchmaking_queue")
      .select("status, match_id")
      .eq("wallet_address", address)
      .eq("mode_key", modeKey)
      .maybeSingle(),
  );

  // Only short-circuit if the caller is already waiting AND has no specific target.
  // When targetAddress is set (from inviteCode or direct challenge) we must proceed
  // to the RPC so the waiter can match against another player.
  if (existingQueue?.status === "waiting" && !targetAddress) {
    return { statusCode: 200, body: { status: "waiting" } };
  }

  if (existingQueue?.status === "matched" && existingQueue.match_id) {
    const { data: existingMatch } = await readDb<{ id: string; status: string }>("verify matched queue row", () =>
      supabase
        .from("game_matches")
        .select("id, status")
        .eq("id", existingQueue.match_id)
        .in("status", ACTIVE_MATCH_STATUSES)
        .maybeSingle(),
    );

    if (existingMatch) {
      return { statusCode: 200, body: { status: "matched", matchId: existingQueue.match_id } };
    }

    console.warn(
      `[farkle/service] expired stale matched queue row wallet=${address}` +
        ` modeKey=${modeKey} matchId=${existingQueue.match_id}`,
    );
    await bestEffortDb("expire stale matched queue row", () =>
      supabase
        .from("matchmaking_queue")
        .update({ status: "expired", match_id: null })
        .eq("wallet_address", address)
        .eq("mode_key", modeKey)
        .eq("status", "matched"),
    );
  }

  const matchId = randomUUID();
  const matchKey = `farkle-${Date.now()}`;
  const seed = generateServerSeed();
  const seedHash = hashServerSeed(seed);
  const inviteCode = generateInviteCode();

  const { data: result, error: rpcError } = await withSupabaseRetry("farkle_enter_match rpc", () =>
    supabase.rpc("farkle_enter_match", {
      p_caller: address,
      p_mode_key: modeKey,
      p_target_addr: targetAddress,
      p_match_id: matchId,
      p_match_key: matchKey,
      p_seed: seed,
      p_seed_hash: seedHash,
      p_invite_code: inviteCode,
    }),
    { timeoutMs: Math.max(FARKLE_SUPABASE_TIMEOUT_MS, 8_000) },
  );

  if (rpcError) throw new Error(`matchmaking rpc failed: ${dbErrorText(rpcError)}`);

  const res = result as { status?: string; match_id?: string; error?: string } | null;
  if (res?.error === "insufficient_tickets") {
    return {
      statusCode: 402,
      body: { error: "insufficient-tickets", message: "You need at least 1 ticket to enter." },
    };
  }
  if (res?.error === "insufficient_credits") {
    return {
      statusCode: 402,
      body: { error: "insufficient-credits", message: "You need at least 1 game credit to enter." },
    };
  }
  if (res?.error === "insufficient_balance_retry") {
    return {
      statusCode: 402,
      body: { error: "insufficient-balance", message: "Balance changed concurrently. Please try again." },
    };
  }
  if (res?.error) {
    console.error("[farkle/service] RPC returned error:", res.error);
    return { statusCode: 500, body: { error: res.error } };
  }

  if (res?.status === "matched") {
    console.log(
      `[farkle/service] match_create matchId=${res.match_id} callerWallet=${address} modeKey=${modeKey}` +
        " entryDebited=true",
    );
    return { statusCode: 200, body: { status: "matched", matchId: res.match_id } };
  }

  console.log(`[farkle/service] queue_join wallet=${address} modeKey=${modeKey}`);
  return { statusCode: 200, body: { status: "waiting" } };
}

export async function getFarkleQueue(modeKey: string, address?: string | null) {
  if (!FARKLE_MODE_KEYS.has(modeKey)) {
    return { statusCode: 400, body: { error: "invalid modeKey" } };
  }

  const wallet = address?.toLowerCase() ?? null;
  await expireWaitingFarkleQueue();

  if (wallet) {
    const active = await getActiveFarkleMatchForPlayer(wallet);
    if (active) {
      return {
        statusCode: 200,
        body: { matchId: active.matchId, modeKey: active.modeKey, waiters: [] },
      };
    }
  }

  let myMatchId: string | null = null;
  let myInviteCode: string | null = null;
  if (wallet) {
    const { data: myEntry } = await readDb<QueueRow & { invite_code?: string | null }>("read queue entry", () =>
      supabase
        .from("matchmaking_queue")
        .select("status, match_id, invite_code")
        .eq("wallet_address", wallet)
        .eq("mode_key", modeKey)
        .maybeSingle(),
    );

    if (myEntry?.status === "matched" && myEntry.match_id) {
      const { data: match } = await readDb<{ id: string; status: string }>("verify polled queue match", () =>
        supabase
          .from("game_matches")
          .select("id, status")
          .eq("id", myEntry.match_id)
          .in("status", ACTIVE_MATCH_STATUSES)
          .maybeSingle(),
      );
      if (match) {
        myMatchId = myEntry.match_id;
      } else {
        await bestEffortDb("expire stale polled queue row", () =>
          supabase
            .from("matchmaking_queue")
            .update({ status: "expired", match_id: null })
            .eq("wallet_address", wallet)
            .eq("mode_key", modeKey),
        );
      }
    } else if (myEntry?.status === "waiting") {
      myInviteCode = myEntry.invite_code ?? null;
      await bestEffortDb("refresh queue ttl", () =>
        supabase
          .from("matchmaking_queue")
          .update({ expires_at: new Date(Date.now() + FARKLE_QUEUE_TTL_MS).toISOString() })
          .eq("wallet_address", wallet)
          .eq("mode_key", modeKey)
          .eq("status", "waiting"),
      );
    }
  }

  const { data: queue } = await readDb<Array<{ wallet_address: string; queued_at: string }>>("read waiting queue", () =>
    supabase
      .from("matchmaking_queue")
      .select("wallet_address, queued_at")
      .eq("mode_key", modeKey)
      .eq("status", "waiting")
      .order("queued_at", { ascending: true }),
  );

  const waiters = (queue ?? []).filter((row) => row.wallet_address !== wallet);
  const wallets = waiters.map((row) => row.wallet_address);
  const usernameMap: Record<string, string> = {};
  if (wallets.length > 0) {
    const { data: users } = await readDb<Array<{ user_address: string; username: string | null }>>(
      "read waiter usernames",
      () =>
        supabase
          .from("users")
          .select("user_address, username")
          .in("user_address", wallets),
    );
    for (const user of users ?? []) {
      if (user.username) usernameMap[user.user_address] = user.username;
    }
  }

  return {
    statusCode: 200,
    body: {
      matchId: myMatchId,
      myInviteCode,
      waiters: waiters.map((row) => ({
        address: row.wallet_address,
        username: usernameMap[row.wallet_address] ?? null,
        queuedAt: row.queued_at,
      })),
    },
  };
}

export async function cancelFarkleQueueEntry(modeKey: string, address: string) {
  const wallet = address.toLowerCase();
  const { error } = await withSupabaseRetry("cancel queue entry", () =>
    supabase
      .from("matchmaking_queue")
      .update({ status: "cancelled", match_id: null })
      .eq("wallet_address", wallet)
      .eq("mode_key", modeKey)
      .eq("status", "waiting"),
  );
  if (error) throw new Error(`failed to leave lobby: ${dbErrorText(error)}`);
}

async function enqueueSettlementJob(
  match: MatchRow,
  params: FarkleSettlementParams,
): Promise<FarkleSettlementJobRow | null> {
  try {
    return await upsertFarkleSettlementJob({
      matchId: match.id,
      modeKey: params.modeKey,
      winnerAddress: params.winnerAddress,
      loserAddress: params.loserAddress,
      winnerScore: params.winnerScore,
      loserScore: params.loserScore,
      winMiles: params.winMiles,
      losMiles: params.losMiles,
      winCreditCents: params.winCreditCents,
      chainId: match.chain_id ?? 42220,
    });
  } catch (err) {
    if (isMissingFarkleSettlementJobsTable(err)) {
      if (!loggedMissingSettlementJobsTable) {
        loggedMissingSettlementJobsTable = true;
        console.warn("[farkle/service] farkle_settlement_jobs missing; using legacy inline settlement");
      }
      return null;
    }
    throw err;
  }
}

async function settleAndMirrorCompletedMatch(
  match: MatchRow,
  params: FarkleSettlementParams,
): Promise<Omit<FarkleSettleResult, "jobStatus">> {
  const matchId = match.id;
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

export async function settleCompletedFarkleMatch(matchId: string): Promise<FarkleSettleResult> {
  const match = await getCompletedMatch(matchId);
  const params = toSettlementParams(match);
  const job = await enqueueSettlementJob(match, params);
  const attempts = Math.max(1, (job?.attempts ?? 0) + 1);

  try {
    const result = await settleAndMirrorCompletedMatch(match, params);
    if (job) {
      await markFarkleJobConfirmed(job.id, result.txHash ?? job.tx_hash ?? null, attempts);
    }
    return { ...result, jobStatus: job ? "confirmed" : null };
  } catch (err) {
    if (job) {
      try {
        await markFarkleJobRetrying(job.id, errorMessage(err), attempts);
      } catch (jobErr) {
        console.error(
          `[farkle/service] failed to mark settlement job retrying matchId=${matchId}:`,
          errorMessage(jobErr),
        );
      }
    }
    throw err;
  }
}

export async function processFarkleSettlementJob(job: FarkleSettlementJobRow) {
  const attempts = Math.max(1, job.attempts + 1);
  try {
    const match = await getCompletedMatch(job.match_id);
    const params = toSettlementParams(match);
    const chainId = match.chain_id ?? job.chain_id ?? undefined;

    if (await isFarkleMatchSettledOnChain(job.match_id, chainId)) {
      console.log(`[farkle/service] settlement_job already_confirmed matchId=${job.match_id}`);
      await markSettled(job.match_id);
      await syncRewardMirror(params.winnerAddress, params.winCreditCents, chainId);
      await writeRewardLedger(match, params, job.tx_hash ?? null);
      await markFarkleJobConfirmed(job.id, job.tx_hash ?? null, attempts);
      return { ok: true, matchId: job.match_id, txHash: job.tx_hash ?? null };
    }

    const sim = await simulateFarkleSettlement(params, chainId);
    if (!sim.ok) {
      throw new Error(`simulation failed: ${sim.error}`);
    }

    const result = await settleAndMirrorCompletedMatch(match, params);
    await markFarkleJobConfirmed(job.id, result.txHash ?? job.tx_hash ?? null, attempts);
    console.log(
      `[farkle/service] settlement_job confirmed matchId=${job.match_id}` +
        ` txHash=${result.txHash ?? "none"} attempts=${attempts}`,
    );
    return { ok: true, matchId: job.match_id, txHash: result.txHash };
  } catch (err) {
    const msg = errorMessage(err);
    try {
      await markFarkleJobRetrying(job.id, msg, attempts);
    } catch (jobErr) {
      console.error(
        `[farkle/service] failed to update settlement job matchId=${job.match_id}:`,
        errorMessage(jobErr),
      );
    }
    console.error(`[farkle/service] settlement_job failed matchId=${job.match_id}: ${msg}`);
    return { ok: false, matchId: job.match_id, error: msg };
  }
}

export async function runFarkleSettlementJobs(limit = FARKLE_SETTLEMENT_WORKER_LIMIT) {
  let jobs: FarkleSettlementJobRow[] = [];
  try {
    jobs = await leaseFarkleSettlementJobs(FARKLE_SETTLEMENT_WORKER_ID, limit);
  } catch (err) {
    if (isMissingFarkleSettlementJobsTable(err)) {
      if (!loggedMissingSettlementJobsTable) {
        loggedMissingSettlementJobsTable = true;
        console.warn("[farkle/service] settlement worker disabled; farkle_settlement_jobs table missing");
      }
      return { leased: 0, processed: 0, failed: 0 };
    }
    console.error("[farkle/service] settlement worker lease failed:", errorMessage(err));
    return { leased: 0, processed: 0, failed: 1 };
  }

  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    const result = await processFarkleSettlementJob(job);
    processed++;
    if (!result.ok) failed++;
  }

  if (jobs.length > 0) {
    console.log(`[farkle/service] settlement worker processed=${processed} failed=${failed}`);
  }

  return { leased: jobs.length, processed, failed };
}

export function startFarkleSettlementWorker() {
  if (farkleSettlementWorkerTimer || farkleSettlementWorkerBootTimer) return;
  console.log(
    `[farkle/service] starting settlement worker owner=${FARKLE_SETTLEMENT_WORKER_ID}` +
      ` intervalMs=${FARKLE_SETTLEMENT_WORKER_INTERVAL_MS}`,
  );

  const run = () => {
    runFarkleSettlementJobs().catch((err) =>
      console.error("[farkle/service] settlement worker crashed:", errorMessage(err)),
    );
  };

  farkleSettlementWorkerBootTimer = setTimeout(() => {
    farkleSettlementWorkerBootTimer = null;
    run();
    farkleSettlementWorkerTimer = setInterval(run, FARKLE_SETTLEMENT_WORKER_INTERVAL_MS);
  }, 8_000);
}

export async function getFarkleRecoverySnapshot(input: {
  statuses?: FarkleSettlementJobStatus[];
  limit?: number;
} = {}): Promise<FarkleRecoverySnapshot> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));

  try {
    const [counts, jobs, unsettled] = await Promise.all([
      countFarkleSettlementJobsByStatus(),
      listFarkleSettlementJobs({ statuses: input.statuses, limit }),
      readDb<MatchRow[]>("read recovery unsettled matches", () =>
        supabase
          .from("game_matches")
          .select(
            "id,chain_id,status,winner_address,loser_address,winner_score,loser_score,completed_at,settled_at," +
              "game_modes(mode_key,winner_miles_reward,loser_miles_reward,winner_reward_credit)",
          )
          .eq("status", "completed")
          .is("settled_at", null)
          .order("completed_at", { ascending: true })
          .limit(limit),
      ),
    ]);

    const unsettledMatches = ((unsettled.data ?? []) as any[]) as Array<MatchRow & {
      completed_at?: string | null;
      settled_at?: string | null;
    }>;
    const matchIds = unsettledMatches.map((match) => match.id);
    const jobIds = new Set<string>();

    if (matchIds.length > 0) {
      const { data, error } = await supabase
        .from("farkle_settlement_jobs")
        .select("match_id")
        .in("match_id", matchIds);
      if (error) throw error;
      for (const row of data ?? []) jobIds.add(row.match_id);
    }

    const missingJobs = unsettledMatches
      .filter((match) => !jobIds.has(match.id) && isFarkleMatch(match))
      .map((match) => ({
        matchId: match.id,
        modeKey: getModeKey(match),
        winnerAddress: match.winner_address,
        loserAddress: match.loser_address,
        winnerScore: match.winner_score,
        loserScore: match.loser_score,
        completedAt: match.completed_at ?? null,
        settledAt: match.settled_at ?? null,
      }));

    return {
      ok: true,
      counts,
      jobs,
      missingJobs,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (isMissingFarkleSettlementJobsTable(err)) {
      return {
        ok: false,
        counts: {},
        jobs: [],
        missingJobs: [],
        tableMissing: true,
        generatedAt: new Date().toISOString(),
      };
    }
    throw err;
  }
}

export async function retryFarkleRecoveryTarget(input: { jobId?: string; matchId?: string }) {
  let job: FarkleSettlementJobRow | null = null;
  if (input.jobId) {
    job = await getFarkleSettlementJobById(input.jobId);
  } else if (input.matchId) {
    job = await getFarkleSettlementJob(input.matchId);
  }

  if (job) {
    const result = await processFarkleSettlementJob(job);
    return { target: "job" as const, job, result };
  }

  if (input.matchId) {
    const result = await settleCompletedFarkleMatch(input.matchId);
    return { target: "match" as const, job: null, result };
  }

  throw new Error("jobId or matchId required");
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
