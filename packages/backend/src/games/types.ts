export type GameType = "rule_tap" | "memory_flip";

export type RewardThreshold = {
  label: string;
  minScore: number;
  miles: number;
  stable: number;
  note?: string;
};

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

export type SettlementPayload = {
  sessionId: string;
  player: string;
  gameType: GameType;
  score: number;
  rewardMiles: number;
  rewardStable: number;
  expiry: number;
  signature: string;
  digest?: string;
};
