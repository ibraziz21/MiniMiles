"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONFIGS } from "@/lib/games/config";
import { generateRuleTapSession } from "@/lib/games/replay-validation";
import { scoreRuleTap } from "@/lib/games/score";
import type { GamePhase, RuleTapAction, RuleTapReplay, RuleTapRule, RuleTapTile } from "@/lib/games/types";

// Server-authoritative play is used when a contract is configured. Set
// NEXT_PUBLIC_SKILL_GAMES_SERVER_AUTH="false" to fall back to the legacy
// client-side flow (kill-switch if the /session/* backend has issues).
const SERVER_AUTH =
  !!process.env.NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS &&
  process.env.NEXT_PUBLIC_SKILL_GAMES_SERVER_AUTH !== "false";
const TICK_POLL_MS = 250;

type ServerRule = { target: { color: string; kind: string }; avoid: { color: string; kind: string } };

function toFrontendRule(r: ServerRule): RuleTapRule {
  const instruction =
    r.target.color === r.avoid.color
      ? `Tap only ${r.target.color} ${r.target.kind}s`
      : `Tap ${r.target.color} ${r.target.kind}s, avoid ${r.avoid.color} ${r.avoid.kind}s`;
  return {
    instruction,
    targets: [r.target as RuleTapRule["targets"][number]],
    avoids: [r.avoid as RuleTapRule["avoids"][number]],
  };
}

/**
 * Rule Tap play hook.
 *
 * Server-auth mode (production): the timeline lives on the backend. `begin()`
 * calls /session/init (returns only the rule), then the hook polls /session/tick
 * for tiles that have already activated — future tiles are never disclosed, so
 * the board can't be precomputed. Each tap is POSTed to /session/tap and scored
 * on the server clock. The local render loop is aligned to the server's elapsed
 * time so tiles appear/disappear in step with how taps will be judged.
 *
 * Mock mode (no contract / dev): the timeline is generated locally from the seed
 * and play is resolved client-side, producing a `replay` for the legacy verifier.
 */
export function useRuleTapGame(sessionId?: string, walletAddress?: string, seed?: string) {
  const config = GAME_CONFIGS.rule_tap;
  const durationMs = config.durationSeconds * 1000;
  const serverMode = SERVER_AUTH && !!sessionId && !!walletAddress;

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
  // Captured at begin() so init/tick/tap in a round all use the SAME id/wallet,
  // immune to stale closures from the page's deferred begin() call.
  const activeRef = useRef<{ sessionId?: string; walletAddress?: string; serverMode: boolean }>({ serverMode: false });

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
    try {
      const res = await fetch("/api/games/session/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeRef.current.sessionId ?? sessionId,
          walletAddress: activeRef.current.walletAddress ?? walletAddress,
        }),
      });
      const data = await res.json();
      if (!res.ok) return;
      serverSyncRef.current = { serverElapsedMs: data.elapsedMs ?? 0, atLocal: Date.now() };
      if (Array.isArray(data.tiles)) setServerTiles(data.tiles as RuleTapTile[]);
    } catch {
      /* transient — next poll recovers */
    }
  }, [sessionId, walletAddress]);

  const beginPlaying = useCallback(() => {
    startedAtRef.current = Date.now();
    setPhase("playing");
  }, []);

  const begin = useCallback((override?: { sessionId?: string; walletAddress?: string }) => {
    // Resolve the round's id/wallet at call time (the page passes the freshly
    // created session in) and pin it for the round.
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

      void (async () => {
        try {
          const res = await fetch("/api/games/session/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sid, walletAddress: w, gameType: "rule_tap" }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? `init-${res.status}`);
          if (data.rule) setServerRule(toFrontendRule(data.rule as ServerRule));
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
  }, [beginPlaying, pollTick, reset, sessionId, walletAddress]);

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
      const tile = activeTiles.find((t) => t.index === index);
      const target = (serverRule ?? generated.rule).targets[0];
      const optimisticHit = !!tile && tile.color === target.color && tile.kind === target.kind;
      // Optimistic feedback for snappiness; score/mistakes reconcile from server.
      flashFeedback(index, optimisticHit ? "good" : "bad");
      setCombo((prev) => (optimisticHit ? prev + 1 : 0));
      setLastDelta(optimisticHit ? 1 : -2);

      try {
        const res = await fetch("/api/games/session/tap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: activeRef.current.sessionId ?? sessionId,
            walletAddress: activeRef.current.walletAddress ?? walletAddress,
            tileIndex: index,
          }),
        });
        const data = await res.json();
        if (!res.ok) return;
        // Server is authoritative on the running totals.
        setScore(Number(data.correct ?? 0));
        setMistakes(Number(data.mistakes ?? 0));
        if (!data.hit) setCombo(0);
      } catch {
        /* transient — totals reconcile on the next successful tap/finish */
      }
    },
    [activeTiles, flashFeedback, generated.rule, serverRule, sessionId, walletAddress]
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
    // `score` is the display score; the authoritative score comes from /finish.
    // In server mode (score, mistakes) are the server's running totals.
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
