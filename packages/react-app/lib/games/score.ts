import { GAME_CONFIGS } from "./config";
import type { GameType, RewardThreshold } from "./types";

export function rewardForScore(gameType: GameType, score: number) {
  const thresholds = [...GAME_CONFIGS[gameType].thresholds].sort(
    (a, b) => b.minScore - a.minScore
  );
  const achieved = thresholds.find((threshold) => score >= threshold.minScore);
  return {
    threshold: achieved ?? null,
    rewardMiles: achieved?.miles ?? 0,
    rewardStable: achieved?.stable ?? 0,
  };
}

export function scoreRuleTap(correct: number, mistakes: number) {
  return Math.max(0, correct - mistakes * 2);
}

export function scoreMemoryFlip(params: {
  completed: boolean;
  matches: number;
  moves: number;
  mistakes: number;
  elapsedMs: number;
  durationMs: number;
}) {
  const completion = params.completed ? 500 : params.matches * 45;
  const timeBonus = params.completed
    ? Math.max(0, Math.round((params.durationMs - params.elapsedMs) / 100))
    : 0;
  const efficiencyBonus = Math.max(0, 240 - params.moves * 10);
  return Math.max(0, completion + timeBonus + efficiencyBonus - params.mistakes * 15);
}

export function thresholdCopy(thresholds: RewardThreshold[]) {
  return thresholds
    .map((t) => `${t.minScore}+ score: ${t.miles} Miles${t.stable ? ` + $${t.stable.toFixed(2)}` : ""}`)
    .join(" • ");
}
