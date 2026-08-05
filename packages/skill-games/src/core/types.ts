// Runtime-neutral gameplay types shared by every host (React app, Pass, and
// eventually the Backend engines). No wallet, ticket, settlement, or economy
// fields belong here — see the host's own config for that overlay.

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

/** Pure gameplay shape: name, duration, scoring. No entry cost, cooldown, or cap. */
export type GameplayConfig = {
  type: GameType;
  name: string;
  shortName: string;
  description: string;
  durationSeconds: number;
  thresholds: RewardThreshold[];
  leaderboardSort: "score_desc" | "time_asc";
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
