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

/**
 * Memory Flip play hook.
 *
 * Server-auth mode (production), hybrid: `begin()` calls /session/init which
 * reveals the deck, so the client renders and matches locally with zero latency.
 * Each flip is mirrored to /session/flip (fire-and-forget) so the SERVER scores
 * the real moves; /session/finish returns the authoritative score + settlement.
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
  // Captured at begin() so every server call in a round uses the SAME id/wallet,
  // immune to stale closures from the page's deferred begin() call.
  const activeRef = useRef<{ sessionId?: string; walletAddress?: string; serverMode: boolean }>({ serverMode: false });
  // Serializes mirrored flips so the server applies them in order.
  const serverFlipQueue = useRef<Promise<unknown>>(Promise.resolve());

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

  const begin = useCallback((override?: { sessionId?: string; walletAddress?: string }) => {
    // Resolve the round's id/wallet at call time (the page passes the freshly
    // created session in, avoiding a stale closure) and pin it for the round.
    const sid = override?.sessionId ?? sessionId;
    const w = override?.walletAddress ?? walletAddress;
    const sm = SERVER_AUTH && !!sid && !!w;
    activeRef.current = { sessionId: sid, walletAddress: w, serverMode: sm };

    reset();
    setPhase("countdown");
    let next = 3;
    const countdownTimer = setInterval(() => {
      next -= 1;
      setCountdown(next);
      if (next > 0) return;
      clearInterval(countdownTimer);

      if (!sm) {
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
            body: JSON.stringify({ sessionId: sid, walletAddress: w, gameType: "memory_flip" }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? `init-${res.status}`);
          // Hybrid: server reveals the deck so the client renders/matches locally
          // with zero latency; flips are mirrored to the server for scoring.
          const serverDeck: string[] = Array.isArray(data.deck) ? data.deck : [];
          const count: number = data.cardCount ?? serverDeck.length ?? 16;
          setDeck(
            serverDeck.length
              ? serverDeck.map((value, i) => ({ id: `card-${i}`, value }))
              : Array.from({ length: count }, (_, i) => ({ id: `card-${i}`, value: "" })),
          );
          beginPlaying();
        } catch (err: any) {
          console.error("[memory-flip] init failed", err);
          setInitError(err?.message ?? "Could not start the board");
          setPhase("error");
        }
      })();
    }, 650);
  }, [beginPlaying, reset, sessionId, walletAddress]);

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

  // Mirror a flip to the server for authoritative scoring. Fire-and-forget and
  // serialized so the server processes flips in order; local play never waits.
  const fireServerFlip = useCallback((index: number, offsetMs: number) => {
    const sid = activeRef.current.sessionId;
    const w = activeRef.current.walletAddress;
    if (!sid || !w) return;
    serverFlipQueue.current = serverFlipQueue.current.then(async () => {
      try {
        await fetch("/api/games/session/flip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, walletAddress: w, cardIndex: index, offsetMs }),
        });
      } catch {
        /* server scoring is best-effort; local rendering is unaffected */
      }
    });
  }, []);

  // Resolve once every mirrored flip has been delivered (call before finish).
  const flushServerFlips = useCallback(() => serverFlipQueue.current, []);

  const flip = useCallback(
    (index: number) => {
      if (phase !== "playing") return;
      if (revealed.has(index) || matched.has(index) || selected.includes(index)) return;
      if (selected.length >= 2) return;

      const offsetMs = Date.now() - startedAtRef.current;
      setActions((prev) => [...prev, { type: "flip", offsetMs, cardIndex: index }]);
      // Mirror to the server for scoring (server mode only); does not block play.
      if (activeRef.current.serverMode) fireServerFlip(index, offsetMs);

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
    [phase, revealed, matched, selected, deck, fireServerFlip]
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
    flushServerFlips,
  };
}
