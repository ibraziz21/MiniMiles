"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONFIGS } from "@/lib/games/config";
import { generateMemoryDeck } from "@/lib/games/replay-validation";
import { scoreMemoryFlip } from "@/lib/games/score";
import type { GamePhase, MemoryFlipAction, MemoryFlipReplay } from "@/lib/games/types";

const EVAL_LOCK_MS = 560;
// Server-authoritative play is used whenever a real contract is configured.
// Without it (local dev) we fall back to a client-side deck so the game is
// still playable, but that path carries no anti-cheat guarantees.
// Server-authoritative play is used when a contract is configured. Set
// NEXT_PUBLIC_SKILL_GAMES_SERVER_AUTH="false" to fall back to the legacy
// client-side flow (kill-switch if the /session/* backend has issues).
const SERVER_AUTH =
  !!process.env.NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS &&
  process.env.NEXT_PUBLIC_SKILL_GAMES_SERVER_AUTH !== "false";

type Card = { id: string; value: string };

type FlipResponse = {
  value: string;
  pair: null | { a: number; b: number; matched: boolean; aValue: string; bValue: string };
  state: {
    revealed: number[];
    matched: number[];
    selected: number[];
    moves: number;
    matches: number;
    mistakes: number;
    completed: boolean;
  };
  completed: boolean;
};

/**
 * Memory Flip play hook.
 *
 * Server-auth mode (production): the deck lives on the backend. `begin()` calls
 * /session/init, each `flip()` calls /session/flip and renders only the value
 * the server returns. The hook never knows unflipped cards, so a modified client
 * cannot precompute the board. Scoring/settlement happen at /session/finish.
 *
 * Mock mode (no contract / dev): a local deck is generated from the seed and
 * play is resolved client-side, producing a `replay` for the legacy verifier.
 */
export function useMemoryFlipGame(sessionId?: string, walletAddress?: string, seed?: string) {
  const config = GAME_CONFIGS.memory_flip;
  const durationMs = config.durationSeconds * 1000;
  const serverMode = SERVER_AUTH && !!sessionId && !!walletAddress;

  // Mock-mode deck (client-side). In server mode this is unused for play but the
  // grid still renders from `deck`, whose values get filled in as cards reveal.
  const mockDeck = useMemo(() => generateMemoryDeck(seed ?? "idle"), [seed]);

  const [phase, setPhase] = useState<GamePhase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const [deck, setDeck] = useState<Card[]>(mockDeck);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [matches, setMatches] = useState(0);
  const [actions, setActions] = useState<MemoryFlipAction[]>([]);
  const [initError, setInitError] = useState<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setCountdown(3);
    setRemainingMs(durationMs);
    setDeck(serverMode ? [] : mockDeck);
    setRevealed(new Set());
    setMatched(new Set());
    setSelected([]);
    setMoves(0);
    setMistakes(0);
    setMatches(0);
    setActions([]);
    setInitError(null);
  }, [durationMs, mockDeck, serverMode]);

  // Re-seed the mock deck when the seed changes (mock mode only).
  useEffect(() => {
    if (!serverMode) setDeck(mockDeck);
  }, [mockDeck, serverMode]);

  const beginPlaying = useCallback(() => {
    startedAtRef.current = Date.now();
    setPhase("playing");
  }, []);

  const begin = useCallback(() => {
    reset();
    setPhase("countdown");
    let next = 3;
    const countdownTimer = setInterval(() => {
      next -= 1;
      setCountdown(next);
      if (next > 0) return;
      clearInterval(countdownTimer);

      if (!serverMode) {
        beginPlaying();
        return;
      }

      // Initialise the server-side deck right as play starts so the server clock
      // and the player's clock stay aligned (no countdown skew eating the timer).
      void (async () => {
        try {
          const res = await fetch("/api/games/session/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, walletAddress, gameType: "memory_flip" }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? `init-${res.status}`);
          const count: number = data.cardCount ?? 16;
          setDeck(Array.from({ length: count }, (_, i) => ({ id: `card-${i}`, value: "" })));
          beginPlaying();
        } catch (err: any) {
          console.error("[memory-flip] init failed", err);
          setInitError(err?.message ?? "Could not start the board");
          setPhase("error");
        }
      })();
    }, 650);
  }, [beginPlaying, reset, serverMode, sessionId, walletAddress]);

  // Countdown timer drives remainingMs and the time-out transition.
  useEffect(() => {
    if (phase !== "playing") return;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, durationMs - (Date.now() - startedAtRef.current));
      setRemainingMs(left);
      if (left <= 0) setPhase("submitting");
    }, 100);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [durationMs, phase]);

  // All pairs matched → end the round.
  useEffect(() => {
    if (matched.size > 0 && matched.size === deck.length && phase === "playing") {
      setPhase("submitting");
    }
  }, [deck.length, matched.size, phase]);

  const flipServer = useCallback(
    async (index: number) => {
      const offsetMs = Date.now() - startedAtRef.current;
      // Optimistic flip: show the card face-up (value arrives from the server).
      setActions((prev) => [...prev, { type: "flip", offsetMs, cardIndex: index }]);
      setSelected((prev) => [...prev, index]);
      setRevealed((prev) => new Set(prev).add(index));

      try {
        const res = await fetch("/api/games/session/flip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, walletAddress, cardIndex: index }),
        });
        const data: FlipResponse & { error?: string } = await res.json();
        if (!res.ok) {
          // Roll back the optimistic flip on rejection.
          setSelected((prev) => prev.filter((i) => i !== index));
          setRevealed((prev) => {
            const copy = new Set(prev);
            copy.delete(index);
            return copy;
          });
          return;
        }

        // Learn the flipped card's value.
        setDeck((prev) => {
          const copy = [...prev];
          if (copy[index]) copy[index] = { ...copy[index], value: data.value };
          if (data.pair) {
            const { a, b, aValue, bValue } = data.pair;
            if (copy[a]) copy[a] = { ...copy[a], value: aValue };
            if (copy[b]) copy[b] = { ...copy[b], value: bValue };
          }
          return copy;
        });

        if (!data.pair) {
          // First pick of a move — sync from authoritative state.
          setSelected(data.state.selected);
          setRevealed(new Set(data.state.revealed));
          return;
        }

        setMoves(data.state.moves);
        setMatches(data.state.matches);
        setMistakes(data.state.mistakes);

        if (data.pair.matched) {
          setMatched(new Set(data.state.matched));
          setRevealed(new Set(data.state.revealed));
          setSelected([]);
          return;
        }

        // Mismatch: keep both cards visible for the flash, then hide per server state.
        setPhase("evaluating");
        setTimeout(() => {
          setRevealed(new Set(data.state.revealed));
          setSelected([]);
          setPhase((p) => (p === "evaluating" ? "playing" : p));
        }, EVAL_LOCK_MS);
      } catch (err) {
        console.error("[memory-flip] flip failed", err);
        setSelected((prev) => prev.filter((i) => i !== index));
        setRevealed((prev) => {
          const copy = new Set(prev);
          copy.delete(index);
          return copy;
        });
      }
    },
    [sessionId, walletAddress]
  );

  const flipMock = useCallback(
    (index: number) => {
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
          setMatches((prev) => prev + 1);
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
      }, EVAL_LOCK_MS);
    },
    [deck, selected]
  );

  const flip = useCallback(
    (index: number) => {
      if (phase !== "playing") return;
      if (revealed.has(index) || matched.has(index) || selected.includes(index)) return;
      if (selected.length >= 2) return;
      if (serverMode) void flipServer(index);
      else flipMock(index);
    },
    [phase, revealed, matched, selected, serverMode, flipServer, flipMock]
  );

  const elapsedMs = durationMs - remainingMs;
  // Display-only score; the authoritative score comes from /session/finish.
  const score = scoreMemoryFlip({
    completed: matches === 8,
    matches,
    moves,
    mistakes,
    elapsedMs,
    durationMs,
  });

  // Replay is only meaningful in mock mode (legacy verifier). Null in server mode.
  const replay: MemoryFlipReplay | null =
    !serverMode && seed && sessionId
      ? {
          sessionId,
          seed,
          startedAt: new Date(startedAtRef.current || Date.now()).toISOString(),
          durationMs: startedAtRef.current
            ? Math.min(durationMs, Date.now() - startedAtRef.current)
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
    matches,
    score,
    flip,
    begin,
    reset,
    replay,
    serverMode,
    initError,
  };
}
