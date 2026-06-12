/**
 * Server-authoritative Penalty Pressure engine.
 *
 * The keeper AI and all shot outcomes live only on the server. The client sends
 * {zone, normalisedPower} per shot and receives {goal, keeperDiveCol, points}.
 * Because the keeper's prediction uses server-held column history, the client
 * cannot precompute outcomes or fake power values.
 *
 * Pure module — no I/O. Persistence + HTTP live in routes.ts.
 */

import { rewardForPenaltyGoals, scorePenaltyShot } from "./score";

export const PENALTY_SHOTS = 5;
export const PENALTY_DURATION_MS = 60_000;
// Minimum elapsed ms expected for a completed 5-shot session (anti-bot).
const MIN_COMPLETION_MS = 4_000;

// Zone layout — 3 columns × 2 rows:
//   0=top-left  1=top-mid  2=top-right
//   3=bot-left  4=bot-mid  5=bot-right
export type PenaltyZone = 0 | 1 | 2 | 3 | 4 | 5;

export type ShotRecord = {
  zone: PenaltyZone;
  normalisedPower: number;
  goal: boolean;
  keeperDiveCol: number;    // 0=left 1=mid 2=right
  points: number;
  offsetMs: number;
};

export type PenaltyServerState = {
  shotsTaken: number;
  goalsScored: number;
  streak: number;           // consecutive goals before the NEXT shot
  totalScore: number;
  columnHistory: number[];  // column aimed per completed shot
  shotResults: ShotRecord[];
  startedAtMs: number;
};

export type PenaltyPublicState = {
  shotsTaken: number;
  goalsScored: number;
  totalScore: number;
  completed: boolean;
};

export type ShotResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      goal: boolean;
      keeperDiveCol: number;
      points: number;
      state: PenaltyPublicState;
      completed: boolean;
    };

export type PenaltyFinalResult = {
  score: number;
  rewardMiles: number;
  rewardStable: number;
  goalsScored: number;
  shotsTaken: number;
  completed: boolean;
  elapsedMs: number;
  flags: string[];
  accepted: boolean;
};

function keeperDiveCol(): number {
  // Equal chance of dive left, hold centre, or dive right.
  return Math.floor(Math.random() * 3);
}

export function applyShot(
  state: PenaltyServerState,
  zone: number,
  normalisedPower: number,
  nowMs: number,
): ShotResult {
  if (state.shotsTaken >= PENALTY_SHOTS) {
    return { ok: false, reason: "session-completed" };
  }
  if (!Number.isInteger(zone) || zone < 0 || zone > 5) {
    return { ok: false, reason: "invalid-zone" };
  }
  const power = Math.max(0, Math.min(1, normalisedPower));
  if (power < 0.05) return { ok: false, reason: "power-too-low" };

  const col     = zone % 3;
  const row     = zone < 3 ? 0 : 1;
  const isTopCorner = row === 0 && col !== 1;   // zones 0 and 2
  const isSide      = col !== 1;                // any non-centre column
  const offsetMs    = nowMs - state.startedAtMs;

  const diveCol        = keeperDiveCol();
  const keeperGuessed  = diveCol === col;
  const powerQuality    = Math.max(0, Math.min(1, (power - 0.18) / 0.72));
  const rowRiskPenalty  = row === 0 ? 0.08 : 0;
  const centrePenalty   = col === 1 ? 0.06 : 0;

  // Power now matters:
  // - weak shots are easier to save and can miss high zones;
  // - corners are higher reward but carry a small accuracy tax;
  // - if the keeper reads the column correctly, only strong well-placed shots beat him.
  let goalChance: number;
  if (keeperGuessed) {
    goalChance = (isTopCorner ? 0.14 : 0.03) + powerQuality * (isTopCorner ? 0.18 : 0.09);
  } else {
    goalChance = 0.48 + powerQuality * 0.28 - rowRiskPenalty - centrePenalty;
  }
  if (power > 0.94 && row === 0) goalChance -= 0.07; // blasted high shots can miss.
  const goal = Math.random() < Math.max(0.03, Math.min(0.96, goalChance));

  const pts = goal
    ? scorePenaltyShot({ isTopCorner, isSide, normalisedPower: power, streak: state.streak })
    : 0;
  const newStreak = goal ? state.streak + 1 : 0;

  state.columnHistory.push(col);
  state.shotResults.push({ zone: zone as PenaltyZone, normalisedPower: power, goal, keeperDiveCol: diveCol, points: pts, offsetMs });
  state.shotsTaken += 1;
  if (goal) state.goalsScored += 1;
  state.streak     = newStreak;
  state.totalScore += pts;

  const completed = state.shotsTaken >= PENALTY_SHOTS;

  return {
    ok: true,
    goal,
    keeperDiveCol: diveCol,
    points: pts,
    state: {
      shotsTaken:  state.shotsTaken,
      goalsScored: state.goalsScored,
      totalScore:  state.totalScore,
      completed,
    },
    completed,
  };
}

export function finalizePenaltyPressure(state: PenaltyServerState, nowMs: number): PenaltyFinalResult {
  const elapsedMs  = Math.min(PENALTY_DURATION_MS, Math.max(0, nowMs - state.startedAtMs));
  const completed  = state.shotsTaken >= PENALTY_SHOTS;
  const flags: string[] = [];

  if (state.shotsTaken >= 2 && elapsedMs < MIN_COMPLETION_MS) {
    flags.push("impossible_completion_time");
  }

  const accepted = flags.length === 0;
  const reward   = rewardForPenaltyGoals(state.goalsScored);

  return {
    score:       state.totalScore,
    rewardMiles: accepted ? reward.rewardMiles : 0,
    rewardStable: accepted ? reward.rewardStable : 0,
    goalsScored: state.goalsScored,
    shotsTaken:  state.shotsTaken,
    completed,
    elapsedMs,
    flags,
    accepted,
  };
}

export function newPenaltyState(startedAtMs: number): PenaltyServerState {
  return {
    shotsTaken:    0,
    goalsScored:   0,
    streak:        0,
    totalScore:    0,
    columnHistory: [],
    shotResults:   [],
    startedAtMs,
  };
}

export function stateFromPenaltyRow(row: {
  shots_taken:    number | null;
  goals_scored:   number | null;
  pp_streak:      number | null;
  total_score:    number | null;
  column_history: number[] | null;
  shot_results:   ShotRecord[] | null;
  started_at_ms:  number | string;
}): PenaltyServerState {
  return {
    shotsTaken:    row.shots_taken    ?? 0,
    goalsScored:   row.goals_scored   ?? 0,
    streak:        row.pp_streak      ?? 0,
    totalScore:    row.total_score    ?? 0,
    columnHistory: row.column_history ?? [],
    shotResults:   (row.shot_results as ShotRecord[]) ?? [],
    startedAtMs:   Number(row.started_at_ms),
  };
}
