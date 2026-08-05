"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAMEPLAY_CONFIGS } from "../core/config";
import { scoreRuleTap } from "../core/score";
import type { GamePhase, RuleTapAction, RuleTapReplay, RuleTapRule, RuleTapTile } from "../core/types";
import { generateRuleTapSession } from "./mockGenerators";
import type { RuleTapPlayTransport } from "./transport";

const TICK_POLL_MS = 250;

type BeginOverride = { sessionId?: string; seed?: string; transport?: RuleTapPlayTransport };

/**
 * Rule Tap play hook.
 *
 * Server mode (a `transport` is supplied): the timeline lives on the host's
 * server. `begin()` calls `transport.init()` (returns only the rule), then
 * the hook polls `transport.tick()` for tiles that have already activated —
 * future tiles are never disclosed, so the board can't be precomputed. Each
 * tap is sent via `transport.tap()` and scored on the server clock. The
 * local render loop is aligned to the server's elapsed time so tiles
 * appear/disappear in step with how taps will be judged.
 *
 * Mock mode (no `transport`): the timeline is generated locally from the
 * seed and play is resolved client-side. This path carries no anti-cheat
 * guarantees and must never be treated as an authoritative result.
 */
export function useRuleTapGame(sessionId?: string, seed?: string, transport?: RuleTapPlayTransport) {
  const config = GAMEPLAY_CONFIGS.rule_tap;
  const durationMs = config.durationSeconds * 1000;
  const serverMode = !!sessionId && !!transport;

  const [phase, setPhase] = useState<GamePhase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [score, setScore] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lastDelta, setLastDelta] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Record<number, "good" | "bad">>({});
  const [actions, setActions] = useState<RuleTapAction[]>([]);
  const [serverTiles, setServerTiles] = useState<RuleTapTile[]>([]);
  const [serverRule, setServerRule] = useState<RuleTapRule | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const startedAtRef = useRef<number>(0);
  // Aligns the local clock to the server's elapsed time (corrected each poll).
  const serverSyncRef = useRef<{ serverElapsedMs: number; atLocal: number }>({ serverElapsedMs: 0, atLocal: 0 });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Captured at begin() so init/tick/tap in a round all use the SAME id/transport,
  // immune to stale closures from the page's deferred begin() call.
  const activeRef = useRef<{ sessionId?: string; transport?: RuleTapPlayTransport; serverMode: boolean }>({ serverMode: false });

  // Mock-mode timeline (client-side).
  const generated = useMemo(() => generateRuleTapSession(seed ?? "idle"), [seed]);

  const remainingMs = Math.max(0, durationMs - elapsedMs);
  const rule = serverMode ? serverRule ?? generated.rule : generated.rule;

  const activeTiles = useMemo(() => {
    const source = serverMode ? serverTiles : generated.timeline.flat();
    const byIndex = new Map<number, RuleTapTile>();
    source
      .filter((tile) => elapsedMs >= tile.activeFromMs && elapsedMs <= tile.activeToMs)
      .forEach((tile) => byIndex.set(tile.index, tile));
    return Array.from(byIndex.values());
  }, [elapsedMs, generated.timeline, serverMode, serverTiles]);

  const reset = useCallback(() => {
    setPhase("idle");
    setCountdown(3);
    setElapsedMs(0);
    setScore(0);
    setMistakes(0);
    setCombo(0);
    setLastDelta(null);
    setFeedback({});
    setActions([]);
    setServerTiles([]);
    setServerRule(null);
    setInitError(null);
    serverSyncRef.current = { serverElapsedMs: 0, atLocal: 0 };
  }, []);

  const effectiveElapsed = useCallback(() => {
    const sync = serverSyncRef.current;
    if (serverMode && sync.atLocal > 0) {
      return sync.serverElapsedMs + (Date.now() - sync.atLocal);
    }
    return Date.now() - startedAtRef.current;
  }, [serverMode]);

  const pollTick = useCallback(async () => {
    const t = activeRef.current.transport;
    if (!t) return;
    try {
      const data = await t.tick();
      serverSyncRef.current = { serverElapsedMs: data.elapsedMs ?? 0, atLocal: Date.now() };
      if (Array.isArray(data.tiles)) setServerTiles(data.tiles);
    } catch {
      /* transient — next poll recovers */
    }
  }, []);

  const beginPlaying = useCallback(() => {
    startedAtRef.current = Date.now();
    setPhase("playing");
  }, []);

  const begin = useCallback((override?: BeginOverride) => {
    // Resolve the round's id/transport at call time (the page passes the
    // freshly created session in) and pin it for the round.
    const sid = override?.sessionId ?? sessionId;
    const t = override?.transport ?? transport;
    const sm = !!sid && !!t;
    activeRef.current = { sessionId: sid, transport: t, serverMode: sm };

    reset();
    setPhase("countdown");
    let next = 3;
    const countdownTimer = setInterval(() => {
      next -= 1;
      setCountdown(next);
      if (next > 0) return;
      clearInterval(countdownTimer);

      if (!sm || !t) {
        beginPlaying();
        return;
      }

      void (async () => {
        try {
          const data = await t.init();
          if (data.rule) setServerRule(data.rule);
          serverSyncRef.current = { serverElapsedMs: 0, atLocal: Date.now() };
          beginPlaying();
          void pollTick();
        } catch (err: any) {
          console.error("[rule-tap] init failed", err);
          setInitError(err?.message ?? "Could not start the round");
          setPhase("error");
        }
      })();
    }, 650);
  }, [beginPlaying, pollTick, reset, sessionId, transport]);

  // Render loop — advance the clock (server-aligned in server mode).
  useEffect(() => {
    if (phase !== "playing") return;
    timerRef.current = setInterval(() => {
      const eff = effectiveElapsed();
      setElapsedMs(eff);
      if (eff >= durationMs) setPhase("submitting");
    }, 80);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [durationMs, effectiveElapsed, phase]);

  // Reveal poll (server mode only).
  useEffect(() => {
    if (!serverMode || phase !== "playing") return;
    pollRef.current = setInterval(() => { void pollTick(); }, TICK_POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [phase, pollTick, serverMode]);

  const flashFeedback = useCallback((index: number, kind: "good" | "bad") => {
    setFeedback((prev) => ({ ...prev, [index]: kind }));
    setTimeout(() => setFeedback((prev) => {
      const nextFb = { ...prev };
      delete nextFb[index];
      return nextFb;
    }), 180);
  }, []);

  const tapServer = useCallback(
    async (index: number) => {
      const t = activeRef.current.transport;
      const tile = activeTiles.find((tl) => tl.index === index);
      const target = (serverRule ?? generated.rule).targets[0];
      const optimisticHit = !!tile && tile.color === target.color && tile.kind === target.kind;
      // Optimistic feedback for snappiness; score/mistakes reconcile from server.
      flashFeedback(index, optimisticHit ? "good" : "bad");
      setCombo((prev) => (optimisticHit ? prev + 1 : 0));
      setLastDelta(optimisticHit ? 1 : -2);

      if (!t) return;
      try {
        // The moment we tapped (server-aligned). The server judges against
        // this, not the request arrival time, so the round-trip doesn't make a
        // valid tap land after the tile's window.
        const data = await t.tap(index, Math.round(effectiveElapsed()));
        // Server is authoritative on the running totals.
        setScore(Number(data.correct ?? 0));
        setMistakes(Number(data.mistakes ?? 0));
        if (!data.hit) setCombo(0);
      } catch {
        /* transient — totals reconcile on the next successful tap/finish */
      }
    },
    [activeTiles, effectiveElapsed, flashFeedback, generated.rule, serverRule]
  );

  const tapMock = useCallback(
    (index: number) => {
      const offsetMs = Date.now() - startedAtRef.current;
      const tile = activeTiles.find((t) => t.index === index);
      const correct = !!tile && generated.rule.targets.some((t) => t.color === tile.color && t.kind === tile.kind);
      setActions((prev) => [...prev, { type: "tap", offsetMs, tileIndex: index }]);
      flashFeedback(index, correct ? "good" : "bad");
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
    [activeTiles, flashFeedback, generated.rule.targets]
  );

  const tapTile = useCallback(
    (index: number) => {
      if (phase !== "playing") return;
      if (serverMode) void tapServer(index);
      else tapMock(index);
    },
    [phase, serverMode, tapServer, tapMock]
  );

  const replay: RuleTapReplay | null =
    !serverMode && seed && sessionId
      ? {
          sessionId,
          seed,
          startedAt: new Date(startedAtRef.current || Date.now()).toISOString(),
          durationMs: Math.min(durationMs, durationMs - Math.max(0, remainingMs)),
          actions,
        }
      : null;

  return {
    phase,
    setPhase,
    countdown,
    remainingMs,
    elapsedMs,
    // `score` is the display score; the authoritative score comes from the
    // host's finish call. In server mode (score, mistakes) are the server's
    // running totals.
    score: scoreRuleTap(score, mistakes),
    rawScore: score,
    mistakes,
    combo,
    lastDelta,
    feedback,
    rule,
    activeTiles,
    tapTile,
    begin,
    reset,
    replay,
    serverMode,
    initError,
  };
}
