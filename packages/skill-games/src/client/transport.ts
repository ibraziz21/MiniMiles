import type { GameResult, GameType, RuleTapRule, RuleTapTile } from "../core/types";

// ---------------------------------------------------------------------------
// Browser-to-host contract (spec: "walletless-pass-skill-games-spec.md" §5.3).
//
// This is the target shape a future host adapter (Pass's BFF) implements.
// Identity, wallets, chain calls, cookies, and payout selection are
// deliberately absent — the browser only ever sees game inputs and a
// session id. React's own adapter (ticket purchase, on-chain start, legacy
// settlement) is a separate, richer contract that lives in the React app;
// it is not implemented against this type in this slice.
// ---------------------------------------------------------------------------

export type GamePlayStatus = {
  gameType: GameType;
  dailyCap: number;
  playsToday: number;
  playsRemaining: number;
  nextResetAt: string;
  bestScoreToday: number | null;
  serviceAvailable: boolean;
};

export type ClientGameSession = {
  sessionId: string;
  gameType: GameType;
  status: "reserved";
  playsToday: number;
  playsRemaining: number;
  expiresAt: string;
};

export type InitResponse = {
  deck?: string[];
  cardCount?: number;
  rule?: RuleTapRule;
};

export type FlipInput = { cardIndex: number; offsetMs: number };
export type FlipResponse = { accepted: boolean };

export type TickResponse = { elapsedMs: number; tiles: RuleTapTile[] };

export type TapInput = { tileIndex: number; offsetMs: number };
export type TapResponse = { hit: boolean; correct: number; mistakes: number };

export type FinishResponse = {
  sessionId: string;
  accepted: boolean;
  result: GameResult;
  antiAbuseFlags: string[];
  reward: {
    mode: "offchain_ledger" | "onchain_mint" | "none";
    status: "pending" | "processing" | "completed" | "failed";
    deliveryId?: string;
  };
  playsToday: number;
  playsRemaining: number;
};

export type RecoveryResponse = {
  sessionId: string;
  status: "reserved" | "started" | "finalized" | "voided";
  result?: GameResult;
};

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

export type LeaderboardPeriod = {
  scope: "daily" | "weekly";
  startsAt: string;
  endsAt: string;
};

export type LeaderboardResponse = {
  entries: LeaderboardEntry[];
  myBest: LeaderboardEntry | null;
  period: LeaderboardPeriod;
};

export type SkillGameAdapter = {
  gamesHomeHref: string;
  standingsHref: string;
  getStatus(gameType: GameType): Promise<GamePlayStatus>;
  start(gameType: GameType, idempotencyKey: string): Promise<ClientGameSession>;
  init(sessionId: string): Promise<InitResponse>;
  flip(sessionId: string, input: FlipInput): Promise<FlipResponse>;
  tick(sessionId: string): Promise<TickResponse>;
  tap(sessionId: string, input: TapInput): Promise<TapResponse>;
  finish(sessionId: string): Promise<FinishResponse>;
  recover(sessionId: string): Promise<RecoveryResponse>;
  leaderboard(gameType: GameType, scope: "daily" | "weekly"): Promise<LeaderboardResponse>;
  track(event: string, properties?: Record<string, unknown>): void;
};

// ---------------------------------------------------------------------------
// Play transport — the narrow slice `useMemoryFlipGame`/`useRuleTapGame`
// actually call. A host builds this from its own richer session-start flow
// (ticket purchase + on-chain start for React today; the BFF's
// `/api/games/session/*` routes for Pass later) and hands it to the hook
// only once a session exists. Absent entirely, the hook falls back to local
// mock-mode play (dev/no-contract only — never used for an authoritative
// result).
// ---------------------------------------------------------------------------

export type MemoryFlipPlayTransport = {
  init(): Promise<InitResponse>;
  flip(cardIndex: number, offsetMs: number): Promise<void>;
};

export type RuleTapPlayTransport = {
  init(): Promise<InitResponse>;
  tick(): Promise<TickResponse>;
  tap(tileIndex: number, offsetMs: number): Promise<TapResponse>;
};
