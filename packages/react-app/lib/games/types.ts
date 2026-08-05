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

export type LeaderboardEntry = {
  rank: number;
  walletAddress: string;
  username?: string | null;
  score: number;
  mistakes?: number;
  moves?: number;
  elapsedMs: number;
  rewardMiles: number;
  rewardStable: number;
  playedAt: string;
};

/**
 * Weekly leaderboard — best single score per wallet across the week.
 * weeklyPrize fields are from GameConfig and used for display only on the frontend;
 * actual disbursement (USDT / voucher) is handled off-chain by the admin.
 */
export type WeeklyLeaderboardEntry = LeaderboardEntry & {
  /** ISO week string e.g. "2025-W16" */
  week: string;
  /** Rank-based prize assigned at week close — 0 if not yet awarded */
  prizeUsd: number;
  prizeMiles: number;
};
