import type { GameplayConfig, GameResult, GameType } from "@akiba/skill-games/core";

export type {
  GameType,
  GamePhase,
  RewardThreshold,
  RuleTapTileKind,
  RuleTapTileColor,
  RuleTapRule,
  RuleTapTile,
  RuleTapAction,
  RuleTapReplay,
  MemoryFlipAction,
  MemoryFlipReplay,
  GameReplay,
  GameResult,
} from "@akiba/skill-games/core";

/** Games that run on the weekly leaderboard / campaign system. */
export const WEEKLY_GAME_TYPES: GameType[] = ["rule_tap", "memory_flip"];

/**
 * React's full game config: shared gameplay shape (name, duration, scoring)
 * layered with React-only economy policy (contract tickets, daily cap,
 * cooldown, weekly prize). Pass's adapter defines its own economy layer —
 * see `@akiba/skill-games` §5.1 — free entry and daily cap 5.
 */
export type GameConfig = GameplayConfig & {
  chainGameType: number;
  route: string;
  entryCostMiles: number;
  maxRewardMiles: number;
  maxRewardStable: number;
  dailyPlayCap: number;
  cooldownSeconds: number;
  /** Weekly leaderboard prize — set to 0 to disable for that week */
  weeklyPrizeUsd: number;
  weeklyPrizeMiles: number;
};

export type GameSession = {
  sessionId: string;
  gameType: GameType;
  walletAddress: string;
  seed: string;
  seedCommitment: string;
  createdAt: string;
  expiresAt: string;
  onchainTxHash?: string;
  status: "created" | "playing" | "submitted" | "settled" | "rejected";
};

export type SettlementPayload = {
  sessionId: string;
  player: string;
  gameType: GameType;
  score: number;
  rewardMiles: number;
  rewardStable: number;
  expiry: number;
  signature: `0x${string}`;
  digest?: `0x${string}`;
};

export type VerifierResponse = {
  accepted: boolean;
  result: GameResult;
  settlement?: SettlementPayload;
  antiAbuseFlags: string[];
  queued?: boolean;
  settled?: boolean;
  settleTxHash?: string;
};

// Canonical leaderboard entry shape (skill-games-leaderboards-spec.md §4.2),
// served by GET /api/games/leaderboard. `playerKey` is opaque — safe to use
// as a React key, never a wallet address or canonical UUID. Mirrors
// `@akiba/skill-games/client`'s `LeaderboardEntry` so both apps' BFFs agree
// on shape; kept as a local type (not a re-export) since this file's
// `LeaderboardEntry` predates that package and several files still import it
// from here.
export type LeaderboardEntry = {
  rank: number;
  playerKey: string;
  displayName: string;
  score: number;
  rewardMiles: number;
  elapsedMs: number | null;
  playedAt: string;
  isYou: boolean;
};

/** Weekly leaderboard — same shape, just a different query period. */
export type WeeklyLeaderboardEntry = LeaderboardEntry;
