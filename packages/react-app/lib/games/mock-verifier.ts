"use client";

import { GAME_CONFIGS, MOCK_WALLET } from "./config";
import { seedCommitment } from "./replay-validation";
import { validateMemoryFlipReplay, validateRuleTapReplay } from "@/server/games/replay-validation";
import { isoWeek } from "@/lib/isoWeek";
import type {
  GameReplay,
  GameSession,
  GameType,
  MemoryFlipReplay,
  RuleTapReplay,
  SettlementPayload,
  VerifierResponse,
} from "./types";

// Local-only mock leaderboard shape — deliberately not the real, canonical
// `LeaderboardEntry` from ./types (which is wallet-free `playerKey`/
// `displayName`, per skill-games-leaderboards-spec.md §4.2). Every method
// that reads/writes these is already @deprecated below; nothing in the real
// UI consumes them (the real leaderboard comes from GET /api/games/leaderboard).
type MockLeaderboardEntry = {
  rank: number;
  walletAddress: string;
  score: number;
  mistakes?: number;
  moves?: number;
  elapsedMs: number;
  rewardMiles: number;
  rewardStable: number;
  playedAt: string;
};

type MockWeeklyLeaderboardEntry = MockLeaderboardEntry & {
  week: string;
  prizeUsd: number;
  prizeMiles: number;
};

type Store = {
  sessions: Record<string, GameSession>;
  results: Record<string, VerifierResponse>;
  leaderboard: Record<string, MockLeaderboardEntry[]>;
  weeklyLeaderboard: Record<string, MockWeeklyLeaderboardEntry[]>;
  walletStarts: Record<string, number[]>;
  /** Key: `gameType:wallet:YYYY-MM-DD` → count of sessions started that day */
  dailyPlays: Record<string, number>;
};

const storageKey = "akiba_skill_games_v1";

function todayKey(gameType: GameType) {
  return `${gameType}:${new Date().toISOString().slice(0, 10)}`;
}

function weekKey(gameType: GameType) {
  return `weekly:${gameType}:${isoWeek()}`;
}

function emptyStore(): Store {
  return { sessions: {}, results: {}, leaderboard: {}, weeklyLeaderboard: {}, walletStarts: {}, dailyPlays: {} };
}

function loadStore(): Store {
  if (typeof window === "undefined") return emptyStore();
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as Store;
    if (!parsed.weeklyLeaderboard) parsed.weeklyLeaderboard = {};
    if (!parsed.dailyPlays) parsed.dailyPlays = {};
    return parsed;
  } catch {
    return emptyStore();
  }
}

function dailyPlaysKey(gameType: GameType, walletAddress: string) {
  return `${gameType}:${walletAddress.toLowerCase()}:${new Date().toISOString().slice(0, 10)}`;
}

function saveStore(store: Store) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(store));
}

function sessionId(gameType: GameType, walletAddress: string) {
  return `${gameType}-${Date.now().toString(36)}-${walletAddress.slice(-6).toLowerCase()}`;
}

function seedFor(id: string, walletAddress: string) {
  return `akiba-v1:${id}:${walletAddress.toLowerCase()}`;
}

function mockSignature(payload: Omit<SettlementPayload, "signature">): `0x${string}` {
  const source = JSON.stringify(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `0x${(h >>> 0).toString(16).padStart(64, "0")}`;
}

function sortLeaderboard(entries: MockLeaderboardEntry[]) {
  return entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((a.mistakes ?? 0) !== (b.mistakes ?? 0)) return (a.mistakes ?? 0) - (b.mistakes ?? 0);
    return a.elapsedMs - b.elapsedMs;
  });
}

function rankAndUpsert(gameType: GameType, walletAddress: string, response: VerifierResponse, store: Store) {
  // --- Daily ---
  const dKey = todayKey(gameType);
  const daily = store.leaderboard[dKey] ?? seededLeaderboard(gameType);
  const dailyIdx = daily.findIndex((e) => e.walletAddress.toLowerCase() === walletAddress.toLowerCase());
  const next: MockLeaderboardEntry = {
    rank: 0,
    walletAddress,
    score: response.result.score,
    mistakes: response.result.mistakes,
    moves: response.result.moves,
    elapsedMs: response.result.elapsedMs,
    rewardMiles: response.result.rewardMiles,
    rewardStable: response.result.rewardStable,
    playedAt: new Date().toISOString(),
  };
  if (dailyIdx >= 0) {
    if (daily[dailyIdx].score < next.score) daily[dailyIdx] = next;
  } else {
    daily.push(next);
  }
  store.leaderboard[dKey] = sortLeaderboard(daily).slice(0, 20).map((e, i) => ({ ...e, rank: i + 1 }));

  // --- Weekly ---
  const wKey = weekKey(gameType);
  const weekly: MockWeeklyLeaderboardEntry[] = store.weeklyLeaderboard[wKey] ?? [];
  const weeklyIdx = weekly.findIndex((e) => e.walletAddress.toLowerCase() === walletAddress.toLowerCase());
  const wNext: MockWeeklyLeaderboardEntry = {
    ...next,
    week: isoWeek(),
    prizeUsd: 0,
    prizeMiles: 0,
  };
  if (weeklyIdx >= 0) {
    if (weekly[weeklyIdx].score < wNext.score) weekly[weeklyIdx] = wNext;
  } else {
    weekly.push(wNext);
  }
  store.weeklyLeaderboard[wKey] = (sortLeaderboard(weekly) as MockWeeklyLeaderboardEntry[])
    .slice(0, 50)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

function seededLeaderboard(_gameType: GameType): MockLeaderboardEntry[] {
  return [];
}

export const mockVerifier = {
  async createGameSession(gameType: GameType, walletAddress = MOCK_WALLET): Promise<GameSession> {
    const store = loadStore();
    const now = Date.now();
    const config = GAME_CONFIGS[gameType];

    // Enforce daily play cap
    const dpKey = dailyPlaysKey(gameType, walletAddress);
    const playsToday = store.dailyPlays[dpKey] ?? 0;
    if (playsToday >= config.dailyPlayCap) {
      throw new Error(`daily_cap_reached:${config.dailyPlayCap}`);
    }

    const recentStarts = (store.walletStarts[walletAddress] ?? []).filter((ts) => now - ts < 60_000);
    const id = sessionId(gameType, walletAddress);
    const seed = seedFor(id, walletAddress);
    const session: GameSession = {
      sessionId: id,
      gameType,
      walletAddress,
      seed,
      seedCommitment: seedCommitment(seed, walletAddress, gameType),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + config.durationSeconds * 1000 + 10 * 60_000).toISOString(),
      status: "created",
    };
    store.sessions[id] = session;
    store.walletStarts[walletAddress] = [...recentStarts, now];
    store.dailyPlays[dpKey] = playsToday + 1;
    saveStore(store);
    return session;
  },

  async fetchGameSeed(sessionId: string) {
    const session = loadStore().sessions[sessionId];
    if (!session) throw new Error("Unknown game session");
    return session.seed;
  },

  async submitReplay(gameType: GameType, sessionId: string, replayPayload: GameReplay): Promise<VerifierResponse> {
    const store = loadStore();
    const session = store.sessions[sessionId];
    if (!session) throw new Error("Unknown game session");
    if (session.gameType !== gameType) throw new Error("Game type mismatch");

    const validation =
      gameType === "rule_tap"
        ? validateRuleTapReplay(replayPayload as RuleTapReplay)
        : validateMemoryFlipReplay(replayPayload as MemoryFlipReplay);

    const antiAbuseFlags = [...validation.flags];
    const dpKey = dailyPlaysKey(gameType, session.walletAddress);
    if ((store.dailyPlays[dpKey] ?? 0) > GAME_CONFIGS[gameType].dailyPlayCap) {
      antiAbuseFlags.push("session_velocity_cap_exceeded");
    }
    const accepted = !antiAbuseFlags.some((flag) =>
      ["impossible_completion_time", "non_monotonic_action_log", "input_during_pair_evaluation_lock"].includes(flag)
    );
    const settlementBase = {
      sessionId,
      player: session.walletAddress,
      gameType,
      score: validation.result.score,
      rewardMiles: accepted ? validation.result.rewardMiles : 0,
      rewardStable: accepted ? validation.result.rewardStable : 0,
      expiry: Math.floor(Date.now() / 1000) + 15 * 60,
      digest: `0x${sessionId.split("").reduce((acc, char) => acc + char.charCodeAt(0).toString(16), "").slice(0, 64).padEnd(64, "0")}` as `0x${string}`,
    };
    const settlement: SettlementPayload = {
      ...settlementBase,
      signature: mockSignature(settlementBase),
    };
    const response: VerifierResponse = {
      accepted,
      antiAbuseFlags,
      result: {
        ...validation.result,
        rewardMiles: settlement.rewardMiles,
        rewardStable: settlement.rewardStable,
      },
      settlement,
    };
    store.results[sessionId] = response;
    store.sessions[sessionId] = { ...session, status: accepted ? "submitted" : "rejected" };
    if (accepted) rankAndUpsert(gameType, session.walletAddress, response, store);
    saveStore(store);
    return response;
  },

  async validateReplay(gameType: GameType, replayPayload: GameReplay) {
    return gameType === "rule_tap"
      ? validateRuleTapReplay(replayPayload as RuleTapReplay)
      : validateMemoryFlipReplay(replayPayload as MemoryFlipReplay);
  },

  async getSettlementPayload(sessionId: string) {
    return loadStore().results[sessionId]?.settlement ?? null;
  },

  /** @deprecated — leaderboard now served from /api/games/leaderboard */
  async fetchLeaderboard(gameType: GameType) {
    const store = loadStore();
    return store.leaderboard[todayKey(gameType)] ?? seededLeaderboard(gameType);
  },

  /** @deprecated */
  async fetchMyBestScore(gameType: GameType, walletAddress = MOCK_WALLET) {
    const entries = await this.fetchLeaderboard(gameType);
    return entries.find((entry) => entry.walletAddress.toLowerCase() === walletAddress.toLowerCase()) ?? null;
  },

  /** @deprecated */
  async fetchWeeklyLeaderboard(gameType: GameType): Promise<MockWeeklyLeaderboardEntry[]> {
    const store = loadStore();
    return store.weeklyLeaderboard[weekKey(gameType)] ?? [];
  },

  /** @deprecated */
  async fetchMyWeeklyBestScore(gameType: GameType, walletAddress = MOCK_WALLET) {
    const entries = await this.fetchWeeklyLeaderboard(gameType);
    return entries.find((e) => e.walletAddress.toLowerCase() === walletAddress.toLowerCase()) ?? null;
  },

  fetchDailyPlays(gameType: GameType, walletAddress = MOCK_WALLET): { played: number; cap: number } {
    const store = loadStore();
    const dpKey = dailyPlaysKey(gameType, walletAddress);
    return {
      played: store.dailyPlays[dpKey] ?? 0,
      cap: GAME_CONFIGS[gameType].dailyPlayCap,
    };
  },
};
