export type GameType = "rule_tap" | "memory_flip";

export type GamePhase =
  | "idle"
  | "starting"
  | "countdown"
  | "playing"
  | "evaluating"
  | "submitting"
  | "settled"
  | "error";

export type RewardThreshold = {
  label: string;
  minScore: number;
  miles: number;
  stable: number;
  note?: string;
};

export type GameConfig = {
  type: GameType;
  chainGameType: number;
  name: string;
  shortName: string;
  description: string;
  route: string;
  entryCostMiles: number;
  maxRewardMiles: number;
  maxRewardStable: number;
  durationSeconds: number;
  thresholds: RewardThreshold[];
  leaderboardSort: "score_desc" | "time_asc";
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

export type RuleTapTileKind = "star" | "circle" | "square" | "diamond";
export type RuleTapTileColor = "blue" | "green" | "red" | "gold";

export type RuleTapRule = {
  instruction: string;
  targets: Array<{ color: RuleTapTileColor; kind: RuleTapTileKind }>;
  avoids: Array<{ color: RuleTapTileColor; kind: RuleTapTileKind }>;
};

export type RuleTapTile = {
  id: string;
  index: number;
  color: RuleTapTileColor;
  kind: RuleTapTileKind;
  activeFromMs: number;
  activeToMs: number;
};

export type RuleTapAction = {
  type: "tap";
  offsetMs: number;
  tileIndex: number;
};

export type RuleTapReplay = {
  sessionId: string;
  seed: string;
  startedAt: string;
  durationMs: number;
  actions: RuleTapAction[];
};

export type MemoryFlipAction = {
  type: "flip";
  offsetMs: number;
  cardIndex: number;
};

export type MemoryFlipReplay = {
  sessionId: string;
  seed: string;
  startedAt: string;
  durationMs: number;
  actions: MemoryFlipAction[];
};

export type GameReplay = RuleTapReplay | MemoryFlipReplay;

export type GameResult = {
  sessionId: string;
  gameType: GameType;
  score: number;
  mistakes: number;
  moves?: number;
  matches?: number;
  completed: boolean;
  elapsedMs: number;
  rewardMiles: number;
  rewardStable: number;
  reason?: string;
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
