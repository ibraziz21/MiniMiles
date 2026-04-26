"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONFIGS } from "@/lib/games/config";
import { generateRuleTapSession } from "@/lib/games/replay-validation";
import { scoreRuleTap } from "@/lib/games/score";
import type { GamePhase, RuleTapAction, RuleTapReplay, RuleTapTile } from "@/lib/games/types";

export function useRuleTapGame(seed?: string, sessionId?: string) {
  const config = GAME_CONFIGS.rule_tap;
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [remainingMs, setRemainingMs] = useState(config.durationSeconds * 1000);
  const [score, setScore] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lastDelta, setLastDelta] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Record<number, "good" | "bad">>({});
  const [actions, setActions] = useState<RuleTapAction[]>([]);
  const startedAtRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generated = useMemo(() => generateRuleTapSession(seed ?? "idle"), [seed]);
  const elapsedMs = Math.max(0, config.durationSeconds * 1000 - remainingMs);
  const activeTiles = useMemo(
    () =>
      generated.timeline
        .flat()
        .filter((tile) => elapsedMs >= tile.activeFromMs && elapsedMs <= tile.activeToMs),
    [elapsedMs, generated.timeline]
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setCountdown(3);
    setRemainingMs(config.durationSeconds * 1000);
    setScore(0);
    setMistakes(0);
    setCombo(0);
    setLastDelta(null);
    setFeedback({});
    setActions([]);
  }, [config.durationSeconds]);

  const begin = useCallback(() => {
    reset();
    setPhase("countdown");
    let next = 3;
    const countdownTimer = setInterval(() => {
      next -= 1;
      setCountdown(next);
      if (next <= 0) {
        clearInterval(countdownTimer);
        startedAtRef.current = Date.now();
        setPhase("playing");
      }
    }, 650);
  }, [reset]);

  useEffect(() => {
    if (phase !== "playing") return;
    intervalRef.current = setInterval(() => {
      const left = Math.max(0, config.durationSeconds * 1000 - (Date.now() - startedAtRef.current));
      setRemainingMs(left);
      if (left <= 0) {
        setPhase("submitting");
      }
    }, 80);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [config.durationSeconds, phase]);

  const tapTile = useCallback(
    (index: number) => {
      if (phase !== "playing") return;
      const offsetMs = Date.now() - startedAtRef.current;
      const tile = activeTiles.find((candidate: RuleTapTile) => candidate.index === index);
      const correct = !!tile && generated.rule.targets.some((target) => target.color === tile.color && target.kind === tile.kind);
      setActions((prev) => [...prev, { type: "tap", offsetMs, tileIndex: index }]);
      setFeedback((prev) => ({ ...prev, [index]: correct ? "good" : "bad" }));
      setTimeout(() => setFeedback((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      }), 180);
      if (correct) {
        setScore((prev) => prev + 1);
        setCombo((prev) => prev + 1);
        setLastDelta(1);
      } else {
        setMistakes((prev) => prev + 1);
        setCombo(0);
        setLastDelta(-2);
      }
    },
    [activeTiles, generated.rule.targets, phase]
  );

  const replay: RuleTapReplay | null =
    seed && sessionId
      ? {
          sessionId,
          seed,
          startedAt: new Date(startedAtRef.current || Date.now()).toISOString(),
          // Cap at the full round duration — the timer fires every 80ms so remainingMs
          // may be slightly above 0 when the phase transitions to "submitting".
          durationMs: Math.min(
            config.durationSeconds * 1000,
            config.durationSeconds * 1000 - Math.max(0, remainingMs)
          ),
          actions,
        }
      : null;

  return {
    phase,
    setPhase,
    countdown,
    remainingMs,
    elapsedMs,
    score: scoreRuleTap(score, mistakes),
    rawScore: score,
    mistakes,
    combo,
    lastDelta,
    feedback,
    rule: generated.rule,
    activeTiles,
    tapTile,
    begin,
    reset,
    replay,
  };
}
