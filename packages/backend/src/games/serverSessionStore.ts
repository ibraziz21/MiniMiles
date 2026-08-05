// Shared server-authoritative session state store for skill_game_server_sessions.
// Extracted from games/routes.ts so both the legacy on-chain-backed routes and
// the walletless Web2 routes (games/web2Routes.ts) read/write identical
// gameplay state through the identical optimistic-concurrency path — server
// authority must not diverge between the two entry points.

import { supabase } from "../supabaseClient";
import type { MemoryServerState } from "./memoryFlipServer";
import type { RuleTapState } from "./ruleTapServer";

// Per-session in-process serialization so concurrent flips/taps on the same
// session don't interleave. Cross-instance safety comes from the optimistic
// `version` guard on each write (a stale write loses and the client retries).
const serverSessionLocks = new Map<string, Promise<unknown>>();
export function withServerSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = serverSessionLocks.get(sessionId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  serverSessionLocks.set(sessionId, run);
  void run.catch(() => undefined).finally(() => {
    if (serverSessionLocks.get(sessionId) === run) serverSessionLocks.delete(sessionId);
  });
  return run;
}

export type ServerSessionRow = {
  session_id: string;
  wallet_address: string | null;
  canonical_id: string | null;
  hub_user_id: string | null;
  source_app: string;
  game_type: string;
  server_seed: string;
  server_seed_hash: string;
  deck: string[];
  revealed: number[] | null;
  matched: number[] | null;
  selected: number[] | null;
  action_offsets: number[] | null;
  moves: number | null;
  matches: number | null;
  mistakes: number | null;
  lock_until_ms: number | null;
  started_at_ms: number | string;
  completed: boolean | null;
  finalized: boolean | null;
  version: number;
  // rule_tap-specific
  rule: RuleTapState["rule"] | null;
  timeline: RuleTapState["timeline"] | null;
  counted_targets: string[] | null;
  correct: number | null;
  taps: number | null;
};

export function stateFromRow(row: ServerSessionRow): MemoryServerState {
  return {
    deck: row.deck,
    revealed: row.revealed ?? [],
    matched: row.matched ?? [],
    selected: row.selected ?? [],
    moves: row.moves ?? 0,
    matches: row.matches ?? 0,
    mistakes: row.mistakes ?? 0,
    lockUntilMs: row.lock_until_ms ?? 0,
    startedAtMs: Number(row.started_at_ms),
    actionOffsets: row.action_offsets ?? [],
    completed: row.completed ?? false,
  };
}

// Optimistic-concurrency write: only succeeds if `version` is unchanged.
export async function saveServerState(sessionId: string, state: MemoryServerState, expectedVersion: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("skill_game_server_sessions")
    .update({
      revealed: state.revealed,
      matched: state.matched,
      selected: state.selected,
      action_offsets: state.actionOffsets,
      moves: state.moves,
      matches: state.matches,
      mistakes: state.mistakes,
      lock_until_ms: state.lockUntilMs,
      completed: state.completed,
      version: expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("session_id", sessionId)
    .eq("version", expectedVersion)
    .select("session_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export function ruleStateFromRow(row: ServerSessionRow): RuleTapState {
  return {
    rule: row.rule as RuleTapState["rule"],
    timeline: (row.timeline ?? []) as RuleTapState["timeline"],
    correct: row.correct ?? 0,
    mistakes: row.mistakes ?? 0,
    taps: row.taps ?? 0,
    countedTargets: row.counted_targets ?? [],
    actionOffsets: row.action_offsets ?? [],
    startedAtMs: Number(row.started_at_ms),
  };
}

// Optimistic-concurrency write for rule_tap live taps.
export async function saveRuleTapState(sessionId: string, state: RuleTapState, expectedVersion: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("skill_game_server_sessions")
    .update({
      correct: state.correct,
      mistakes: state.mistakes,
      taps: state.taps,
      counted_targets: state.countedTargets,
      action_offsets: state.actionOffsets,
      version: expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("session_id", sessionId)
    .eq("version", expectedVersion)
    .select("session_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
