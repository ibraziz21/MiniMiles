// Signed BFF client from hub-page to the Backend's /games/web2/* namespace.
// walletless-pass-skill-games-spec.md §7.2/§8. Every call signs a fresh
// service assertion scoped to the exact method+path being hit, so a captured
// assertion can't be replayed against a different route.

import { getServerEnv } from "@/lib/env.server";
import { signServiceAssertion } from "./serviceAssertion";

export class GamesBackendError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

function backendUrl(): string {
  const value = getServerEnv().gamesBackend.url;
  if (!value) throw new Error("GAMES_BACKEND_URL is not configured");
  return value.replace(/\/$/, "");
}

async function call<T>(
  identity: { canonicalId: string; hubUserId: string },
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const assertion = signServiceAssertion({ ...identity, method, path });
  const res = await fetch(`${backendUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${assertion}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GamesBackendError(res.status, data?.error ?? "backend-error", data?.message);
  }
  return data as T;
}

export type GameType = "rule_tap" | "memory_flip";

export type PlayStatus = {
  canonicalId: string;
  playsToday: number;
  playsRemaining: number;
  nextResetAt: string;
  bestScoreToday: number | null;
};

export type StartResult = {
  sessionId: string;
  status: string;
  playsToday: number;
  playsRemaining: number;
  expiresAt: string;
};

export type Identity = { canonicalId: string; hubUserId: string };

export const gamesBackend = {
  status(identity: Identity, gameType: GameType) {
    const path = `/games/web2/status?gameType=${gameType}`;
    return call<PlayStatus>(identity, "GET", path);
  },
  start(identity: Identity, gameType: GameType, idempotencyKey: string) {
    return call<StartResult>(identity, "POST", "/games/web2/session/start", { gameType, idempotencyKey });
  },
  init(identity: Identity, sessionId: string) {
    return call<any>(identity, "POST", "/games/web2/session/init", { sessionId });
  },
  flip(identity: Identity, sessionId: string, cardIndex: number, offsetMs: number, actionId: string) {
    return call<any>(identity, "POST", "/games/web2/session/flip", { sessionId, cardIndex, offsetMs, actionId });
  },
  tick(identity: Identity, sessionId: string) {
    return call<any>(identity, "POST", "/games/web2/session/tick", { sessionId });
  },
  tap(identity: Identity, sessionId: string, tileIndex: number, offsetMs: number, actionId: string) {
    return call<any>(identity, "POST", "/games/web2/session/tap", { sessionId, tileIndex, offsetMs, actionId });
  },
  finish(identity: Identity, sessionId: string) {
    return call<any>(identity, "POST", "/games/web2/session/finish", { sessionId });
  },
  recover(identity: Identity, sessionId: string) {
    const path = `/games/web2/session/recover?sessionId=${encodeURIComponent(sessionId)}`;
    return call<any>(identity, "GET", path);
  },
};
