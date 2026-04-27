"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONFIGS } from "@/lib/games/config";
import { generateMemoryDeck } from "@/lib/games/replay-validation";
import { scoreMemoryFlip } from "@/lib/games/score";
import type { GamePhase, MemoryFlipAction, MemoryFlipReplay } from "@/lib/games/types";

export function useMemoryFlipGame(seed?: string, sessionId?: string) {
  const config = GAME_CONFIGS.memory_flip;
  const deck = useMemo(() => generateMemoryDeck(seed ?? "idle"), [seed]);
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [remainingMs, setRemainingMs] = useState(config.durationSeconds * 1000);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [actions, setActions] = useState<MemoryFlipAction[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setCountdown(3);
    setRemainingMs(config.durationSeconds * 1000);
    setRevealed(new Set());
    setMatched(new Set());
    setSelected([]);
    setMoves(0);
    setMistakes(0);
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
    timerRef.current = setInterval(() => {
      const left = Math.max(0, config.durationSeconds * 1000 - (Date.now() - startedAtRef.current));
      setRemainingMs(left);
      if (left <= 0) setPhase("submitting");
    }, 100);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [config.durationSeconds, phase]);

  useEffect(() => {
    if (matched.size === deck.length && phase === "playing") {
      setPhase("submitting");
    }
  }, [deck.length, matched.size, phase]);

  const flip = useCallback(
    (index: number) => {
      if (phase !== "playing" || revealed.has(index) || matched.has(index) || selected.includes(index)) return;
      const offsetMs = Date.now() - startedAtRef.current;
      setActions((prev) => [...prev, { type: "flip", offsetMs, cardIndex: index }]);
      const nextSelected = [...selected, index];
      setRevealed((prev) => new Set(prev).add(index));
      setSelected(nextSelected);
      if (nextSelected.length !== 2) return;
      setMoves((prev) => prev + 1);
      const [a, b] = nextSelected;
      setPhase("evaluating");
      setTimeout(() => {
        if (deck[a].value === deck[b].value) {
          setMatched((prev) => new Set(prev).add(a).add(b));
        } else {
          setMistakes((prev) => prev + 1);
          setRevealed((prev) => {
            const copy = new Set(prev);
            copy.delete(a);
            copy.delete(b);
            return copy;
          });
        }
        setSelected([]);
        setPhase("playing");
      }, 560);
    },
    [deck, matched, phase, revealed, selected]
  );

  const elapsedMs = config.durationSeconds * 1000 - remainingMs;
  const score = scoreMemoryFlip({
    completed: matched.size === deck.length,
    matches: matched.size / 2,
    moves,
    mistakes,
    elapsedMs,
    durationMs: config.durationSeconds * 1000,
  });

  const replay: MemoryFlipReplay | null =
    seed && sessionId
      ? {
          sessionId,
          seed,
          startedAt: new Date(startedAtRef.current || Date.now()).toISOString(),
          // Use wall-clock elapsed rather than timer-derived to avoid polling drift
          durationMs: startedAtRef.current
            ? Math.min(config.durationSeconds * 1000, Date.now() - startedAtRef.current)
            : elapsedMs,
          actions,
        }
      : null;

  return {
    phase,
    setPhase,
    countdown,
    remainingMs,
    elapsedMs,
    deck,
    revealed,
    matched,
    selected,
    moves,
    mistakes,
    matches: matched.size / 2,
    score,
    flip,
    begin,
    reset,
    replay,
  };
}
