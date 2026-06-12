import { GAME_CONFIGS } from "./config";
import type { GameType } from "./types";

export function rewardForScore(gameType: GameType, score: number) {
  const thresholds = [...GAME_CONFIGS[gameType].thresholds].sort((a, b) => b.minScore - a.minScore);
  const achieved = thresholds.find((threshold) => score >= threshold.minScore);
  return {
    rewardMiles: achieved?.miles ?? 0,
    rewardStable: achieved?.stable ?? 0,
  };
}

export function rewardForPenaltyGoals(goals: number): { rewardMiles: number; rewardStable: number } {
  if (goals >= 5) return { rewardMiles: 12, rewardStable: 0 };
  if (goals >= 4) return { rewardMiles: 9,  rewardStable: 0 };
  if (goals >= 3) return { rewardMiles: 6,  rewardStable: 0 };
  if (goals >= 2) return { rewardMiles: 5,  rewardStable: 0 };
  return { rewardMiles: 0, rewardStable: 0 };
}

export function scorePenaltyShot(params: {
  isTopCorner: boolean;
  isSide: boolean;
  normalisedPower: number;
  streak: number;        // consecutive goals BEFORE this shot (0 = first in run)
}): number {
  let pts = 100;
  if (params.isTopCorner) pts += 30;
  else if (params.isSide) pts += 20;
  if (params.normalisedPower >= 0.8) pts += 50;
  pts += params.streak * 15;
  return pts;
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
  const timeBonus = params.completed ? Math.max(0, Math.round((params.durationMs - params.elapsedMs) / 100)) : 0;
  const efficiencyBonus = Math.max(0, 240 - params.moves * 10);
  return Math.max(0, completion + timeBonus + efficiencyBonus - params.mistakes * 15);
}
