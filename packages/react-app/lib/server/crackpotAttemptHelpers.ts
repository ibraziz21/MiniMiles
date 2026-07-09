// lib/server/crackpotAttemptHelpers.ts
//
// Session-scoped DB helpers for CrackPot attempts and guesses.
//
// SECURITY: every player-facing read/write includes `.eq("player_address", wallet)`
// so that a different session wallet cannot access another player's state, even
// if they supply the correct attempt UUID.
//
// Fairness:
//   USDT cycles use truthful (noiseless) feedback.
//   Miles cycles use the standard noise injection for anti-solver protection.

import { supabase } from "@/lib/supabaseClient";
import {
  buildAttemptExpiresAt,
  computeFeedback,
  applyNoiseForVersion,
  secondsUntil,
} from "@/lib/server/crackpotEngine";
import { enqueuePayoutJob } from "@/lib/server/crackpotPayoutWorker";
import {
  GUESSES_PER_ENTRY,
  THEMES,
  type AttemptStatus,
  type AttemptView,
  type GuessView,
  type GuessFeedback,
  type ThemeName,
  type CrackPotVersion,
} from "@/lib/crackpotTypes";

const MAX_GUESSES_PER_ATTEMPT = GUESSES_PER_ENTRY;

// ── Raw DB shapes ─────────────────────────────────────────────────────────────

export type RawAttempt = {
  id: string;
  cycle_id: string;
  player_address: string;
  attempt_number: number;
  started_at: string;
  expires_at: string;
  status: string;
  guesses_used: number;
  is_paid: boolean;
  entry_tx_hash: string | null;
  chain_id: number | null;
  entry_log_index: number | null;
  created_at: string;
  updated_at: string;
};

export type RawGuess = {
  id: string;
  attempt_id: string;
  cycle_id: string;
  player_address: string;
  guess_number: number;
  symbols: [number, number, number, number];
  feedback: GuessFeedback;
  locked_count: number;
  is_correct: boolean;
  created_at: string;
};

// ── View builders ─────────────────────────────────────────────────────────────

export function buildGuessView(g: RawGuess, theme: ThemeName): GuessView {
  const themeConfig = THEMES[theme];
  return {
    guessNumber:  g.guess_number,
    symbols:      g.symbols,
    symbolLabels: g.symbols.map((i) => themeConfig.symbolLabels[i]) as [string, string, string, string],
    feedback:     g.feedback,
    isCorrect:    g.is_correct,
    createdAt:    g.created_at,
  };
}

export function buildAttemptView(
  attempt: RawAttempt,
  guesses: RawGuess[],
  theme: ThemeName,
  freeAttemptsUsed: number,
  totalAttemptsUsed: number,
  priorGuesses: RawGuess[] = [],
): AttemptView {
  return {
    attemptId:         attempt.id,
    attemptNumber:     attempt.attempt_number,
    expiresAt:         attempt.expires_at,
    secondsRemaining:  secondsUntil(attempt.expires_at),
    guessesUsed:       attempt.guesses_used,
    status:            attempt.status as AttemptStatus,
    guesses:           guesses.map((g) => buildGuessView(g, theme)),
    // Renumber prior tries sequentially (1..N) — their per-attempt guess_numbers
    // repeat across entries and would collide as React keys / labels.
    priorGuesses:      priorGuesses.map((g, i) => ({
      ...buildGuessView(g, theme),
      guessNumber: i + 1,
    })),
    freeAttemptsUsed,
    totalAttemptsUsed,
    canUpsell:         true,
  };
}

// ── Attempt reads ─────────────────────────────────────────────────────────────

/**
 * Find an existing attempt by tx hash — used for idempotency.
 * Does NOT scope by player because the caller must check ownership after.
 */
export async function findAttemptByTxHash(
  chainId: number,
  txHash: string,
): Promise<RawAttempt | null> {
  const { data, error } = await supabase
    .from("crackpot_attempts")
    .select("*")
    .eq("chain_id", chainId)
    .eq("entry_tx_hash", txHash.toLowerCase())
    .maybeSingle();

  if (error) throw new Error(`[crackpotAttempts] findByTxHash: ${error.message}`);
  return data ?? null;
}

/**
 * Load an attempt scoped to the authenticated player wallet.
 * Returns null if not found OR if the attempt belongs to a different player.
 */
export async function getAttemptForPlayer(
  attemptId: string,
  playerWallet: string,
): Promise<RawAttempt | null> {
  const { data, error } = await supabase
    .from("crackpot_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("player_address", playerWallet.toLowerCase()) // auth scope
    .maybeSingle();

  if (error) throw new Error(`[crackpotAttempts] getForPlayer: ${error.message}`);
  return data ?? null;
}

/**
 * Find the currently active (non-expired) attempt for a player in a cycle.
 */
/**
 * DB-only lookup of the live cycle for a version. Used by restore paths that
 * must stay fast and available even while the chain-backed sync is rotating —
 * no chain reads, no transactions.
 */
export async function findLiveDbCycle(
  version: CrackPotVersion,
): Promise<{ id: string; theme: ThemeName; expires_at: string } | null> {
  const { data, error } = await supabase
    .from("crackpot_cycles")
    .select("id, theme, expires_at")
    .eq("version", version)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[crackpotAttempts] findLiveDbCycle failed:", error.message);
    return null;
  }
  return (data as { id: string; theme: ThemeName; expires_at: string } | null) ?? null;
}

export async function getActiveAttemptForPlayer(
  cycleId: string,
  playerWallet: string,
): Promise<RawAttempt | null> {
  const { data, error } = await supabase
    .from("crackpot_attempts")
    .select("*")
    .eq("cycle_id", cycleId)
    .eq("player_address", playerWallet.toLowerCase())
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw new Error(`[crackpotAttempts] getActive: ${error.message}`);
  return data ?? null;
}

/**
 * Count all attempts (free + paid) for a player in a cycle.
 * Also returns the count of free (unpaid) attempts separately.
 */
export async function countAttemptsForPlayer(
  cycleId: string,
  playerWallet: string,
): Promise<{ total: number; free: number }> {
  const { data, error } = await supabase
    .from("crackpot_attempts")
    .select("is_paid", { count: "exact" })
    .eq("cycle_id", cycleId)
    .eq("player_address", playerWallet.toLowerCase());

  if (error) throw new Error(`[crackpotAttempts] count: ${error.message}`);
  const rows = data ?? [];
  return {
    total: rows.length,
    free:  rows.filter((r: any) => !r.is_paid).length,
  };
}

// ── Attempt writes ────────────────────────────────────────────────────────────

export type CreateAttemptParams = {
  cycleId:      string;
  playerWallet: string;
  attemptNumber: number;
  isPaid:       boolean;
  chainId:      number | null;
  txHash:       string | null;
  logIndex:     number | null;
  /** Hard ceiling for the attempt window (the cycle's own expiry). */
  maxExpiresAt?: Date | null;
};

export async function createAttempt(params: CreateAttemptParams): Promise<RawAttempt> {
  const now      = new Date();
  let expiresAt  = buildAttemptExpiresAt(now);

  // Clamp the attempt window to the cycle end so an attempt can never
  // straddle a rotation (guessing into an already-expired cycle).
  if (
    params.maxExpiresAt &&
    Number.isFinite(params.maxExpiresAt.getTime()) &&
    params.maxExpiresAt < expiresAt
  ) {
    expiresAt = params.maxExpiresAt;
  }

  const { data, error } = await supabase
    .from("crackpot_attempts")
    .insert({
      cycle_id:        params.cycleId,
      player_address:  params.playerWallet.toLowerCase(),
      attempt_number:  params.attemptNumber,
      started_at:      now.toISOString(),
      expires_at:      expiresAt.toISOString(),
      status:          "active",
      guesses_used:    0,
      is_paid:         params.isPaid,
      entry_tx_hash:   params.txHash ? params.txHash.toLowerCase() : null,
      chain_id:        params.chainId,
      entry_log_index: params.logIndex,
    })
    .select("*")
    .single();

  if (error) throw new Error(`[crackpotAttempts] create: ${error.message}`);
  return data as RawAttempt;
}

// ── Guess reads ───────────────────────────────────────────────────────────────

export async function getGuessesForAttempt(
  attemptId: string,
  playerWallet: string,
): Promise<RawGuess[]> {
  const { data, error } = await supabase
    .from("crackpot_guesses")
    .select("*")
    .eq("attempt_id", attemptId)
    .eq("player_address", playerWallet.toLowerCase()) // auth scope
    .order("guess_number", { ascending: true });

  if (error) throw new Error(`[crackpotAttempts] getGuesses: ${error.message}`);
  return (data ?? []) as RawGuess[];
}

/**
 * All of a player's guesses across every entry in a cycle, oldest first.
 * Used to build the read-only "prior tries" history shown on later entries.
 */
export async function getGuessesForCycle(
  cycleId: string,
  playerWallet: string,
): Promise<RawGuess[]> {
  const { data, error } = await supabase
    .from("crackpot_guesses")
    .select("*")
    .eq("cycle_id", cycleId)
    .eq("player_address", playerWallet.toLowerCase()) // auth scope
    .order("created_at", { ascending: true });

  if (error) throw new Error(`[crackpotAttempts] getGuessesForCycle: ${error.message}`);
  return (data ?? []) as RawGuess[];
}

// ── Guess write ───────────────────────────────────────────────────────────────

export type SubmitGuessParams = {
  attemptId:    string;
  cycleId:      string;
  playerWallet: string;
  guessNumber:  number;
  symbols:      [number, number, number, number];
  secret:       [number, number, number, number];
  version:      CrackPotVersion; // controls noise application
};

export type SubmitGuessResult = {
  guessView:  GuessView;
  isCorrect:  boolean;
  theme:      ThemeName;
  newStatus:  AttemptStatus;
};

export async function submitGuess(
  params: SubmitGuessParams,
  attempt: RawAttempt,
  theme: ThemeName,
): Promise<SubmitGuessResult> {
  const rawFeedback = computeFeedback(params.secret, params.symbols);
  // USDT: truthful feedback (no noise). Miles: noise injected.
  const feedback    = applyNoiseForVersion(
    rawFeedback,
    params.version,
    params.cycleId,
    params.playerWallet,
    params.guessNumber,
  );
  const lockedCount = feedback.filter((f) => f === "locked").length;
  const isCorrect   = lockedCount === 4;

  // Insert guess — DB enforces (attempt_id, guess_number) uniqueness.
  await supabase.from("crackpot_guesses").insert({
    attempt_id:     params.attemptId,
    cycle_id:       params.cycleId,
    player_address: params.playerWallet.toLowerCase(),
    guess_number:   params.guessNumber,
    symbols:        params.symbols,
    feedback,
    locked_count:   lockedCount,
    is_correct:     isCorrect,
  });

  // Determine new attempt status.
  const guessesUsed = attempt.guesses_used + 1;
  let newStatus: AttemptStatus = "active";
  if (isCorrect) {
    newStatus = "won";
  } else if (guessesUsed >= MAX_GUESSES_PER_ATTEMPT) {
    newStatus = "lost";
  }

  // Update attempt.
  await supabase
    .from("crackpot_attempts")
    .update({ guesses_used: guessesUsed, status: newStatus })
    .eq("id", params.attemptId)
    .eq("player_address", params.playerWallet.toLowerCase()); // auth scope on write too

  const guessView = buildGuessView(
    {
      id:             "",
      attempt_id:     params.attemptId,
      cycle_id:       params.cycleId,
      player_address: params.playerWallet.toLowerCase(),
      guess_number:   params.guessNumber,
      symbols:        params.symbols,
      feedback,
      locked_count:   lockedCount,
      is_correct:     isCorrect,
      created_at:     new Date().toISOString(),
    },
    theme,
  );

  return { guessView, isCorrect, theme, newStatus };
}

// ── Settlement on correct guess ───────────────────────────────────────────────

export type CycleSettlementRef = {
  id:                string;
  chain_id:          number | null;
  contract_cycle_id: number | null;
  contract_version:  number | null;
};

/**
 * Called by the guess route when `isCorrect` is true.
 *
 * Atomically:
 *   1. Updates cycle status to 'settling' (only if still 'active').
 *   2. Enqueues a durable crackpot_payout_jobs row with an idempotency key.
 *
 * Idempotent: duplicate correct guesses on the same cycle return the existing
 * job and do not double-enqueue.
 *
 * Returns null (and logs a warning) if the cycle is missing chain fields —
 * this is a configuration error, not a player error.
 */
export async function settleWinningCycle(
  cycle: CycleSettlementRef,
  winnerAddress: string,
  winnerGuesses: number,
): Promise<boolean> {
  if (
    cycle.chain_id == null ||
    cycle.contract_cycle_id == null ||
    cycle.contract_version == null
  ) {
    console.error(
      "[crackpotAttemptHelpers] settleWinningCycle called with cycle missing chain fields:",
      cycle.id,
    );
    return false;
  }

  await enqueuePayoutJob({
    cycleId:         cycle.id,
    chainId:         cycle.chain_id,
    contractCycleId: cycle.contract_cycle_id,
    contractVersion: cycle.contract_version,
    winnerAddress,
    winnerGuesses,
  });
  return true;
}

// ── Cycle secret read (server-only, never returned to client) ─────────────────

/**
 * Loads the secret code, theme, and version for a cycle.
 * The SELECT is deliberately minimal — this is the only place secret_code
 * should be read.  It must never appear in any API response.
 */
export async function getCycleSecret(
  cycleId: string,
): Promise<{
  secret:    [number, number, number, number];
  theme:     ThemeName;
  version:   CrackPotVersion;
  status:    string;
  expiresAt: string | null;
} | null> {
  const { data, error } = await supabase
    .from("crackpot_cycles")
    .select("secret_code, theme, version, status, expires_at")
    .eq("id", cycleId)
    .single();

  if (error) return null;
  return {
    secret:    data.secret_code as [number, number, number, number],
    theme:     data.theme       as ThemeName,
    version:   data.version     as CrackPotVersion,
    status:    data.status      as string,
    expiresAt: (data.expires_at as string | null) ?? null,
  };
}

/**
 * Load the chain fields for a cycle (needed by settleWinningCycle).
 * Returns null if the cycle does not exist.
 */
export async function getCycleChainRef(
  cycleId: string,
): Promise<CycleSettlementRef | null> {
  const { data, error } = await supabase
    .from("crackpot_cycles")
    .select("id, chain_id, contract_cycle_id, contract_version")
    .eq("id", cycleId)
    .maybeSingle();

  if (error) throw new Error(`[crackpotAttempts] getCycleChainRef: ${error.message}`);
  return data ?? null;
}
