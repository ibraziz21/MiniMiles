"use client";

// Browser-side transport for the walletless skill games. Talks only to
// hub-page's own same-origin BFF routes (never the Backend directly, never a
// wallet) — auth is the existing Supabase cookie session; the BFF resolves
// canonical identity and signs the service assertion server-side.
// walletless-pass-skill-games-spec.md §7.1, §8.

import type { MemoryFlipPlayTransport, RuleTapPlayTransport, LeaderboardResponse } from "@akiba/skill-games/client";
import type { GameType } from "@akiba/skill-games/core";

export class GamesApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function postJson<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GamesApiError(res.status, data?.error ?? "request-failed");
  return data as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GamesApiError(res.status, data?.error ?? "request-failed");
  return data as T;
}

export type PlayStatus = {
  gameType: GameType;
  dailyCap: number;
  playsToday: number;
  playsRemaining: number;
  nextResetAt: string;
  bestScoreToday: number | null;
  serviceAvailable: boolean;
};

export function fetchStatus(gameType: GameType): Promise<PlayStatus> {
  return getJson(`/api/games/status?gameType=${gameType}`);
}

export type StartedSession = {
  sessionId: string;
  gameType: GameType;
  status: string;
  playsToday: number;
  playsRemaining: number;
  expiresAt: string;
};

export function startSession(gameType: GameType): Promise<StartedSession> {
  const idempotencyKey = crypto.randomUUID();
  return postJson("/api/games/session/start", { gameType }, { "Idempotency-Key": idempotencyKey });
}

export function buildMemoryFlipTransport(sessionId: string): MemoryFlipPlayTransport {
  return {
    init: () => postJson("/api/games/session/init", { sessionId }),
    flip: async (cardIndex, offsetMs) => {
      await postJson("/api/games/session/flip", { sessionId, cardIndex, offsetMs, actionId: crypto.randomUUID() });
    },
  };
}

export function buildRuleTapTransport(sessionId: string): RuleTapPlayTransport {
  return {
    init: () => postJson("/api/games/session/init", { sessionId }),
    tick: () => postJson("/api/games/session/tick", { sessionId }),
    tap: (tileIndex, offsetMs) =>
      postJson("/api/games/session/tap", { sessionId, tileIndex, offsetMs, actionId: crypto.randomUUID() }),
  };
}

export type FinishResult = {
  sessionId: string;
  accepted: boolean;
  score: number;
  rewardMiles: number;
  rewardStable: number;
  completed: boolean;
  elapsedMs: number;
  antiAbuseFlags: string[];
  reward: { mode: "offchain_ledger" | "onchain_mint" | "none"; status: string; deliveryId?: string };
  playsToday: number | null;
  playsRemaining: number | null;
};

export function finishSession(sessionId: string): Promise<FinishResult> {
  return postJson("/api/games/session/finish", { sessionId });
}

export type RecoverResult = {
  sessionId: string;
  reservationStatus: "reserved" | "started" | "finalized" | "voided";
  gameType: GameType;
  expiresAt: string;
  engine: { finalized: boolean; completed: boolean } | null;
  result: { score: number; accepted: boolean; rewardMiles: number; rewardStable: number; antiAbuseFlags: string[] } | null;
  reward: { mode: string; status: string; deliveryId: string } | null;
};

export function recoverSession(sessionId: string): Promise<RecoverResult> {
  return getJson(`/api/games/session/recover?sessionId=${encodeURIComponent(sessionId)}`);
}

export function fetchLeaderboard(gameType: GameType, scope: "daily" | "weekly"): Promise<LeaderboardResponse> {
  return getJson(`/api/games/leaderboard?gameType=${gameType}&period=${scope}`);
}
