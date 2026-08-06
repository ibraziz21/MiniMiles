// Walletless Web2 skill-game routes for the Pass (hub-page) BFF.
// walletless-pass-skill-games-spec.md §7, §8, §9, §10.
//
// Every route requires a verified signed service assertion (never a bare
// wallet/canonical id from the request body) and every session/action is
// owned by `canonical_id`, never a wallet. Server authority (deck/timeline
// generation, scoring, anti-abuse) is the SAME engine code the legacy
// contract-backed routes use — see serverSessionStore.ts and
// memoryFlipServer.ts/ruleTapServer.ts, both unchanged by this file.
//
// Reward delivery (ledger credit / mint job) is Slice 3 scope — finish here
// computes and persists the authoritative score/accepted/flags result but
// does not yet move Miles. See the comment on POST /session/finish.

import { Router, type NextFunction, type Request, type Response } from "express";
import { createHash } from "crypto";
import { supabase } from "../supabaseClient";
import { isGameType } from "./config";
import { verifyServiceAssertion, type VerifiedAssertion } from "./serviceAssertion";
import {
  withServerSessionLock,
  stateFromRow,
  ruleStateFromRow,
  type ServerSessionRow,
} from "./serverSessionStore";
import {
  applyFlip,
  buildMemoryDeck,
  finalizeMemoryFlip,
  MEMORY_FLIP_CARD_COUNT,
  MEMORY_FLIP_DURATION_MS,
  newServerSeed,
  serverSeedHash,
  type MemoryServerState,
} from "./memoryFlipServer";
import {
  applyTap,
  buildRuleTapSession,
  finalizeRuleTap,
  revealedTiles,
  RULE_TAP_DURATION_MS,
  RULE_TAP_GRID_SIZE,
  RULE_TAP_REVEAL_LEAD_MS,
  RULE_TAP_TICK_MS,
  type RuleTapState,
} from "./ruleTapServer";
import type { GameType } from "./types";

const router = Router();

const DAILY_CAP = Number(process.env.HUB_SKILL_GAME_DAILY_CAP ?? "5");
const INIT_WINDOW_SECONDS = Number(process.env.HUB_SKILL_GAME_INIT_WINDOW_SECONDS ?? "120");

// ---------------------------------------------------------------------------
// Auth — every route in this router requires a verified service assertion.
// ---------------------------------------------------------------------------

router.use(async (req: Request, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
  const result = await verifyServiceAssertion(token, { method: req.method, path: req.originalUrl });
  if (!result.ok) {
    res.status(401).json({ error: `assertion-${result.reason}` });
    return;
  }
  res.locals.assertion = result.assertion as VerifiedAssertion;
  next();
});

function hashInput(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

// ---------------------------------------------------------------------------
// GET /status?gameType=rule_tap|memory_flip
// ---------------------------------------------------------------------------
router.get("/status", async (req: Request, res: Response) => {
  try {
    const gameType = req.query.gameType;
    if (!isGameType(gameType)) {
      res.status(400).json({ error: "valid gameType required" });
      return;
    }
    const { hubUserId, canonicalId } = (res.locals.assertion as VerifiedAssertion);

    const { data, error } = await supabase.rpc("hub_skill_game_play_status", {
      p_hub_user_id: hubUserId,
      p_email: null,
      p_game_type: gameType,
      p_daily_cap: DAILY_CAP,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      res.status(503).json({ error: "game-service-unavailable" });
      return;
    }

    res.json({
      gameType,
      dailyCap: DAILY_CAP,
      playsToday: row.plays_today,
      playsRemaining: row.plays_remaining,
      nextResetAt: row.next_reset_at,
      bestScoreToday: row.best_score_today ?? null,
      serviceAvailable: true,
      canonicalId: row.canonical_id ?? canonicalId,
    });
  } catch (err: any) {
    console.error("[games/web2/status] ERROR", err?.message ?? err);
    res.status(503).json({ error: "game-service-unavailable" });
  }
});

// ---------------------------------------------------------------------------
// POST /session/start  { gameType, idempotencyKey }
// ---------------------------------------------------------------------------
router.post("/session/start", async (req: Request, res: Response) => {
  try {
    const { gameType, idempotencyKey } = req.body ?? {};
    if (!isGameType(gameType) || !idempotencyKey || typeof idempotencyKey !== "string") {
      res.status(400).json({ error: "gameType and idempotencyKey required" });
      return;
    }
    const { hubUserId } = (res.locals.assertion as VerifiedAssertion);

    const { data, error } = await supabase.rpc("reserve_hub_skill_game_play", {
      p_hub_user_id: hubUserId,
      p_email: null,
      p_game_type: gameType,
      p_idempotency_key: idempotencyKey,
      p_daily_cap: DAILY_CAP,
      p_init_window_seconds: INIT_WINDOW_SECONDS,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      res.status(503).json({ error: "game-service-unavailable" });
      return;
    }

    if (!row.ok) {
      const status = row.error_code === "daily-cap-reached" || row.error_code === "idempotency-conflict" ? 409 : 400;
      res.status(status).json({ error: row.error_code });
      return;
    }

    res.json({
      sessionId: row.session_id,
      gameType,
      status: row.status,
      playsToday: row.plays_today,
      playsRemaining: row.plays_remaining,
      expiresAt: row.expires_at,
    });
  } catch (err: any) {
    console.error("[games/web2/session/start] ERROR", err?.message ?? err);
    res.status(503).json({ error: "game-service-unavailable" });
  }
});

// Shared ownership + reservation lookup for every session/* route below.
type OwnedReservationResult =
  | { ok: false; status: number; body: { error: string } }
  | { ok: true; reservation: { session_id: string; canonical_id: string; game_type: string; status: string; expires_at: string } };

async function loadOwnedReservation(sessionId: string, canonicalId: string): Promise<OwnedReservationResult> {
  const { data, error } = await supabase
    .from("hub_skill_game_play_reservations")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, status: 404, body: { error: "session-not-found" } };
  if (data.canonical_id !== canonicalId) return { ok: false, status: 403, body: { error: "not-your-session" } };
  return { ok: true, reservation: data };
}

// ---------------------------------------------------------------------------
// POST /session/init  { sessionId }
// ---------------------------------------------------------------------------
router.post("/session/init", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body ?? {};
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    const sid = String(sessionId);
    const { canonicalId, hubUserId } = (res.locals.assertion as VerifiedAssertion);

    const owned = await loadOwnedReservation(sid, canonicalId);
    if (!owned.ok) {
      res.status(owned.status).json(owned.body);
      return;
    }
    if (owned.reservation.status === "voided" || owned.reservation.status === "finalized") {
      res.status(409).json({ error: `reservation-${owned.reservation.status}` });
      return;
    }

    const gameType = owned.reservation.game_type as GameType;

    const result = await withServerSessionLock(sid, async () => {
      const { data: existing, error: readErr } = await supabase
        .from("skill_game_server_sessions")
        .select("game_type, server_seed_hash, started_at_ms, completed, finalized, revealed, matched, selected, moves, matches, mistakes, rule, correct, deck")
        .eq("session_id", sid)
        .maybeSingle();
      if (readErr) throw readErr;

      if (existing) {
        // Idempotent resume — never returns the secret board (deck/timeline).
        if (existing.game_type === "rule_tap") {
          return {
            gameType: "rule_tap" as const,
            rule: existing.rule,
            durationMs: RULE_TAP_DURATION_MS,
            tickIntervalMs: RULE_TAP_TICK_MS,
            gridSize: RULE_TAP_GRID_SIZE,
            revealLeadMs: RULE_TAP_REVEAL_LEAD_MS,
            startedAtMs: Number(existing.started_at_ms),
            resumed: true,
          };
        }
        return {
          gameType: "memory_flip" as const,
          cardCount: MEMORY_FLIP_CARD_COUNT,
          durationMs: MEMORY_FLIP_DURATION_MS,
          startedAtMs: Number(existing.started_at_ms),
          deck: existing.deck,
          resumed: true,
        };
      }

      const seed = newServerSeed();
      const startedAtMs = Date.now();

      if (gameType === "rule_tap") {
        const { rule, timeline } = buildRuleTapSession(seed);
        const { error: insErr } = await supabase.from("skill_game_server_sessions").insert({
          session_id: sid,
          wallet_address: null,
          canonical_id: canonicalId,
          hub_user_id: hubUserId,
          source_app: "hub-page",
          game_type: gameType,
          server_seed: seed,
          server_seed_hash: serverSeedHash(seed),
          deck: [],
          rule,
          timeline,
          started_at_ms: startedAtMs,
        });
        if (insErr) throw insErr;
        return {
          gameType: "rule_tap" as const,
          rule,
          durationMs: RULE_TAP_DURATION_MS,
          tickIntervalMs: RULE_TAP_TICK_MS,
          gridSize: RULE_TAP_GRID_SIZE,
          revealLeadMs: RULE_TAP_REVEAL_LEAD_MS,
          startedAtMs,
          resumed: false,
        };
      }

      const deck = buildMemoryDeck(seed);
      const { error: insErr } = await supabase.from("skill_game_server_sessions").insert({
        session_id: sid,
        wallet_address: null,
        canonical_id: canonicalId,
        hub_user_id: hubUserId,
        source_app: "hub-page",
        game_type: gameType,
        server_seed: seed,
        server_seed_hash: serverSeedHash(seed),
        deck,
        started_at_ms: startedAtMs,
      });
      if (insErr) throw insErr;
      return {
        gameType: "memory_flip" as const,
        cardCount: MEMORY_FLIP_CARD_COUNT,
        durationMs: MEMORY_FLIP_DURATION_MS,
        startedAtMs,
        deck,
        resumed: false,
      };
    });

    if (owned.reservation.status === "reserved") {
      await supabase
        .from("hub_skill_game_play_reservations")
        .update({ status: "started", started_at: new Date().toISOString() })
        .eq("session_id", sid)
        .eq("status", "reserved");
    }

    res.json(result);
  } catch (err: any) {
    console.error("[games/web2/session/init] ERROR", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

// Atomically saves the flip/tap engine state and records the action receipt
// in one transaction (§10.3, apply_skill_game_flip_action/
// apply_skill_game_tap_action in migration 063 — see that migration for why
// this must be one RPC rather than two separate writes).
async function saveFlipActionAtomic(
  sessionId: string,
  expectedVersion: number,
  state: MemoryServerState,
  actionId: string,
  input: unknown,
  outcome: unknown
): Promise<boolean> {
  const { data, error } = await supabase.rpc("apply_skill_game_flip_action", {
    p_session_id: sessionId,
    p_expected_version: expectedVersion,
    p_revealed: state.revealed,
    p_matched: state.matched,
    p_selected: state.selected,
    p_action_offsets: state.actionOffsets,
    p_moves: state.moves,
    p_matches: state.matches,
    p_mistakes: state.mistakes,
    p_lock_until_ms: state.lockUntilMs,
    p_completed: state.completed,
    p_action_id: actionId,
    p_input_hash: hashInput(input),
    p_outcome: outcome,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return Boolean(row?.saved);
}

async function saveTapActionAtomic(
  sessionId: string,
  expectedVersion: number,
  state: RuleTapState,
  actionId: string,
  input: unknown,
  outcome: unknown
): Promise<boolean> {
  const { data, error } = await supabase.rpc("apply_skill_game_tap_action", {
    p_session_id: sessionId,
    p_expected_version: expectedVersion,
    p_correct: state.correct,
    p_mistakes: state.mistakes,
    p_taps: state.taps,
    p_counted_targets: state.countedTargets,
    p_action_offsets: state.actionOffsets,
    p_action_id: actionId,
    p_input_hash: hashInput(input),
    p_outcome: outcome,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return Boolean(row?.saved);
}

async function findActionReceipt(sessionId: string, actionId: string) {
  const { data, error } = await supabase
    .from("skill_game_session_actions")
    .select("input_hash, outcome")
    .eq("session_id", sessionId)
    .eq("action_id", actionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// POST /session/flip  { sessionId, cardIndex, offsetMs, actionId }
// ---------------------------------------------------------------------------
router.post("/session/flip", async (req: Request, res: Response) => {
  try {
    const { sessionId, cardIndex, offsetMs, actionId } = req.body ?? {};
    if (!sessionId || !Number.isInteger(cardIndex) || !actionId || typeof actionId !== "string") {
      res.status(400).json({ error: "sessionId, integer cardIndex and actionId required" });
      return;
    }
    const sid = String(sessionId);
    const clientOffsetMs = typeof offsetMs === "number" && Number.isFinite(offsetMs) ? offsetMs : undefined;
    const { canonicalId } = (res.locals.assertion as VerifiedAssertion);
    const input = { cardIndex, offsetMs: clientOffsetMs };

    const out = await withServerSessionLock(sid, async () => {
      const existingReceipt = await findActionReceipt(sid, actionId);
      if (existingReceipt) {
        if (existingReceipt.input_hash !== hashInput(input)) {
          return { status: 409, body: { error: "action-input-mismatch" } };
        }
        return { status: 200, body: existingReceipt.outcome };
      }

      const { data: row, error } = await supabase
        .from("skill_game_server_sessions")
        .select("*")
        .eq("session_id", sid)
        .maybeSingle();
      if (error) throw error;
      if (!row) return { status: 404, body: { error: "session-not-found" } };
      if (row.canonical_id !== canonicalId) return { status: 403, body: { error: "not-your-session" } };
      if (row.finalized) return { status: 409, body: { error: "session-finalized" } };

      const state = stateFromRow(row as ServerSessionRow);
      const result = applyFlip(state, cardIndex, Date.now(), clientOffsetMs);
      if (!result.ok) return { status: 400, body: { error: result.reason } };

      const outcome = { value: result.value, pair: result.pair ?? null, state: result.state, completed: result.state.completed };
      const saved = await saveFlipActionAtomic(sid, (row as ServerSessionRow).version, state, actionId, input, outcome);
      if (!saved) return { status: 409, body: { error: "concurrent-modification" } };

      return { status: 200, body: outcome };
    });

    res.status(out.status).json(out.body);
  } catch (err: any) {
    console.error("[games/web2/session/flip] ERROR", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

// ---------------------------------------------------------------------------
// POST /session/tick  { sessionId }
// ---------------------------------------------------------------------------
router.post("/session/tick", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body ?? {};
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    const sid = String(sessionId);
    const { canonicalId } = (res.locals.assertion as VerifiedAssertion);

    const { data: row, error } = await supabase
      .from("skill_game_server_sessions")
      .select("canonical_id, game_type, timeline, started_at_ms, finalized")
      .eq("session_id", sid)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      res.status(404).json({ error: "session-not-found" });
      return;
    }
    if (row.canonical_id !== canonicalId) {
      res.status(403).json({ error: "not-your-session" });
      return;
    }
    if (row.game_type !== "rule_tap") {
      res.status(400).json({ error: "wrong-game-type" });
      return;
    }

    const elapsedMs = Date.now() - Number(row.started_at_ms);
    const tiles = revealedTiles(
      (row.timeline ?? []) as RuleTapState["timeline"],
      elapsedMs + RULE_TAP_REVEAL_LEAD_MS
    );
    res.json({ elapsedMs, durationMs: RULE_TAP_DURATION_MS, tiles, finalized: Boolean(row.finalized) });
  } catch (err: any) {
    console.error("[games/web2/session/tick] ERROR", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

// ---------------------------------------------------------------------------
// POST /session/tap  { sessionId, tileIndex, offsetMs, actionId }
// ---------------------------------------------------------------------------
router.post("/session/tap", async (req: Request, res: Response) => {
  try {
    const { sessionId, tileIndex, offsetMs, actionId } = req.body ?? {};
    if (!sessionId || !Number.isInteger(tileIndex) || !actionId || typeof actionId !== "string") {
      res.status(400).json({ error: "sessionId, integer tileIndex and actionId required" });
      return;
    }
    const sid = String(sessionId);
    const clientOffsetMs = typeof offsetMs === "number" && Number.isFinite(offsetMs) ? offsetMs : undefined;
    const { canonicalId } = (res.locals.assertion as VerifiedAssertion);
    const input = { tileIndex, offsetMs: clientOffsetMs };

    const out = await withServerSessionLock(sid, async () => {
      const existingReceipt = await findActionReceipt(sid, actionId);
      if (existingReceipt) {
        if (existingReceipt.input_hash !== hashInput(input)) {
          return { status: 409, body: { error: "action-input-mismatch" } };
        }
        return { status: 200, body: existingReceipt.outcome };
      }

      const { data: row, error } = await supabase
        .from("skill_game_server_sessions")
        .select("*")
        .eq("session_id", sid)
        .maybeSingle();
      if (error) throw error;
      if (!row) return { status: 404, body: { error: "session-not-found" } };
      if (row.canonical_id !== canonicalId) return { status: 403, body: { error: "not-your-session" } };
      if (row.game_type !== "rule_tap") return { status: 400, body: { error: "wrong-game-type" } };
      if (row.finalized) return { status: 409, body: { error: "session-finalized" } };

      const state = ruleStateFromRow(row as ServerSessionRow);
      const result = applyTap(state, tileIndex, Date.now(), clientOffsetMs);
      if (!result.ok) return { status: 400, body: { error: result.reason } };

      const outcome = { hit: result.hit, duplicate: result.duplicate, correct: result.correct, mistakes: result.mistakes };
      const saved = await saveTapActionAtomic(sid, (row as ServerSessionRow).version, state, actionId, input, outcome);
      if (!saved) return { status: 409, body: { error: "concurrent-modification" } };

      return { status: 200, body: outcome };
    });

    res.status(out.status).json(out.body);
  } catch (err: any) {
    console.error("[games/web2/session/tap] ERROR", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

// Ensures exactly one minipoint_mint_jobs row exists for an onchain_mint
// delivery. Safe to call on every finish retry: the idempotency key is
// stable, so a 23505 conflict just means the job already exists (§11.3,
// mirrors packages/hub-page/src/lib/akiba/canonicalPartnerQuests.ts's
// identical insert-then-look-up pattern for partner-quest deliveries).
async function ensureSkillGameMintJob(input: {
  deliveryId: string;
  sessionId: string;
  gameType: GameType;
  wallet: string;
  points: number;
}): Promise<void> {
  const jobKey = `skill-game:${input.sessionId}`;
  const { error: insertError } = await supabase.from("minipoint_mint_jobs").insert({
    idempotency_key: jobKey,
    user_address: input.wallet,
    points: input.points,
    reason: `skill-game:${input.gameType}`,
    status: "pending",
    payload: { kind: "hub_skill_game_reward", sessionId: input.sessionId, gameType: input.gameType },
    skill_game_reward_delivery_id: input.deliveryId,
  });
  if (insertError && insertError.code !== "23505") {
    await supabase.rpc("fail_skill_game_reward_delivery", { p_delivery_id: input.deliveryId, p_error: insertError.message });
    throw insertError;
  }
}

// ---------------------------------------------------------------------------
// POST /session/finish  { sessionId }
//
// Computes the authoritative result from server-held state, then hands
// score/reward/flags to finalize_hub_skill_game_session (§11.1) — one
// transaction that persists the result, marks the reservation finalized, and
// either credits the off-chain ledger inline or reserves an onchain_mint
// delivery. For onchain_mint we still need to enqueue the actual mint job
// here (the RPC doesn't own minipoint_mint_jobs' idempotency-key shape).
// Repeating finish is idempotent — the RPC returns the persisted result
// without re-crediting (§2 invariants #6, #9, #10).
// ---------------------------------------------------------------------------
router.post("/session/finish", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body ?? {};
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    const sid = String(sessionId);
    const { canonicalId } = (res.locals.assertion as VerifiedAssertion);

    const out = await withServerSessionLock(sid, async () => {
      const { data: row, error } = await supabase
        .from("skill_game_server_sessions")
        .select("*")
        .eq("session_id", sid)
        .maybeSingle();
      if (error) throw error;
      if (!row) return { status: 404, body: { error: "session-not-found" } };
      if (row.canonical_id !== canonicalId) return { status: 403, body: { error: "not-your-session" } };

      const gameType: GameType = row.game_type === "rule_tap" ? "rule_tap" : "memory_flip";

      let final: { accepted: boolean; score: number; rewardMiles: number; rewardStable: number; completed: boolean; elapsedMs: number; flags: string[] };
      if (row.finalized) {
        // Recompute from the same (now-frozen) server state so the RPC gets a
        // stable input on retry — finalize_hub_skill_game_session itself is
        // what actually guards against re-crediting.
        final = gameType === "rule_tap"
          ? finalizeRuleTap(ruleStateFromRow(row as ServerSessionRow), Date.now())
          : finalizeMemoryFlip(stateFromRow(row as ServerSessionRow), Date.now());
      } else {
        final = gameType === "rule_tap"
          ? finalizeRuleTap(ruleStateFromRow(row as ServerSessionRow), Date.now())
          : finalizeMemoryFlip(stateFromRow(row as ServerSessionRow), Date.now());

        await supabase.from("skill_game_server_sessions").update({
          finalized: true,
          completed: final.completed,
          score: final.score,
          updated_at: new Date().toISOString(),
        }).eq("session_id", sid);
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc("finalize_hub_skill_game_session", {
        p_session_id: sid,
        p_canonical_id: canonicalId,
        p_score: final.score,
        p_accepted: final.accepted,
        p_reward_miles: final.accepted ? final.rewardMiles : 0,
        p_reward_stable: final.accepted ? final.rewardStable : 0,
        p_completed: final.completed,
        p_anti_abuse_flags: final.flags,
      });
      if (rpcError) throw rpcError;
      const persisted = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (!persisted) return { status: 503, body: { error: "game-service-unavailable" } };

      let rewardBody: { mode: "offchain_ledger" | "onchain_mint" | "none"; status: string; deliveryId?: string };
      if (!persisted.delivery_id) {
        rewardBody = { mode: "none", status: "completed" };
      } else if (persisted.delivery_mode === "onchain_mint") {
        await ensureSkillGameMintJob({
          deliveryId: persisted.delivery_id,
          sessionId: sid,
          gameType,
          wallet: String(persisted.destination_wallet).toLowerCase(),
          points: persisted.reward_miles,
        });
        rewardBody = { mode: "onchain_mint", status: persisted.delivery_status, deliveryId: persisted.delivery_id };
      } else {
        rewardBody = { mode: "offchain_ledger", status: persisted.delivery_status, deliveryId: persisted.delivery_id };
      }

      // §8.4 — finish also reports the post-finish play count so the client
      // can disable Play Again without a separate status round-trip.
      const { data: statusData } = await supabase.rpc("hub_skill_game_play_status", {
        p_hub_user_id: row.hub_user_id,
        p_email: null,
        p_game_type: gameType,
        p_daily_cap: DAILY_CAP,
      });
      const statusRow = Array.isArray(statusData) ? statusData[0] : statusData;

      return {
        status: 200,
        body: {
          sessionId: sid,
          accepted: persisted.accepted,
          score: persisted.score,
          rewardMiles: persisted.reward_miles,
          rewardStable: persisted.reward_stable,
          completed: final.completed,
          elapsedMs: final.elapsedMs,
          antiAbuseFlags: final.flags,
          reward: rewardBody,
          playsToday: statusRow?.plays_today ?? null,
          playsRemaining: statusRow?.plays_remaining ?? null,
        },
      };
    });

    res.status(out.status).json(out.body);
  } catch (err: any) {
    console.error("[games/web2/session/finish] ERROR", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

// ---------------------------------------------------------------------------
// GET /session/recover?sessionId=...
// ---------------------------------------------------------------------------
router.get("/session/recover", async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.query.sessionId ?? "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    const { canonicalId } = (res.locals.assertion as VerifiedAssertion);

    const { data: reservation, error: resErr } = await supabase
      .from("hub_skill_game_play_reservations")
      .select("session_id, canonical_id, game_type, status, expires_at")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (resErr) throw resErr;
    if (!reservation) {
      res.status(404).json({ error: "session-not-found" });
      return;
    }
    if (reservation.canonical_id !== canonicalId) {
      res.status(403).json({ error: "not-your-session" });
      return;
    }

    const { data: serverRow } = await supabase
      .from("skill_game_server_sessions")
      .select("finalized, completed, updated_at")
      .eq("session_id", sessionId)
      .maybeSingle();

    const { data: resultRow } = await supabase
      .from("skill_game_sessions")
      .select("score, reward_miles, reward_stable, accepted, anti_abuse_flags")
      .eq("session_id", sessionId)
      .maybeSingle();

    const { data: deliveryRow } = await supabase
      .from("skill_game_reward_deliveries")
      .select("id, mode, status")
      .eq("session_id", sessionId)
      .maybeSingle();

    res.json({
      sessionId,
      reservationStatus: reservation.status,
      gameType: reservation.game_type,
      expiresAt: reservation.expires_at,
      engine: serverRow ? { finalized: Boolean(serverRow.finalized), completed: Boolean(serverRow.completed) } : null,
      result: resultRow
        ? {
            score: resultRow.score,
            accepted: resultRow.accepted,
            rewardMiles: resultRow.reward_miles,
            rewardStable: resultRow.reward_stable,
            antiAbuseFlags: resultRow.anti_abuse_flags ?? [],
          }
        : null,
      reward: deliveryRow
        ? { mode: deliveryRow.mode, status: deliveryRow.status, deliveryId: deliveryRow.id }
        : null,
    });
  } catch (err: any) {
    console.error("[games/web2/session/recover] ERROR", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

export default router;
