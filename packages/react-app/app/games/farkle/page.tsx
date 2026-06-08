"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useWeb3 } from "@/contexts/useWeb3";
import {
  ArrowLeft, Lightning, Trophy, Sword, Ticket,
  CurrencyDollar, WarningCircle, SpinnerGap,
} from "@phosphor-icons/react";
import { MilesAmount } from "@/components/games/miles-amount";
import type { BalancesResponse, FarkleMode } from "@/lib/farkle/types";
import { scoreDice, getScoringIndices } from "@/lib/farkle/engine";
import type { DiceValue } from "@/lib/farkle/engine";
import { useFarkleTickets } from "@/hooks/farkle/useFarkleTickets";

type Screen = "mode-select" | "matchmaking" | "game" | "result";

// ─── Dot positions per face (in a 0–100 viewbox) ─────────────────────────────

const DOTS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

// Cube rotation (deg) that brings each face value toward the viewer
const FACE_ROTATION: Record<number, { x: number; y: number }> = {
  1: { x:   0, y:    0 },
  2: { x: -90, y:    0 },
  3: { x:   0, y:  -90 },
  4: { x:   0, y:   90 },
  5: { x:  90, y:    0 },
  6: { x:   0, y: -180 },
};

// Transform placing each face on the cube (half-edge = 26px)
const FACE_PLACEMENT: Record<number, string> = {
  1: "translateZ(26px)",
  6: "rotateY(180deg) translateZ(26px)",
  3: "rotateY(90deg) translateZ(26px)",
  4: "rotateY(-90deg) translateZ(26px)",
  2: "rotateX(90deg) translateZ(26px)",
  5: "rotateX(-90deg) translateZ(26px)",
};

const SIZE = 52;

function Pips({ value, color }: { value: number; color: string }) {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full p-2">
      {(DOTS[value] ?? DOTS[1]).map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={9.5} fill={color}
          style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.25))" }} />
      ))}
    </svg>
  );
}

// ─── True 3D tumbling die ─────────────────────────────────────────────────────

function Die3D({
  value, isRolling, isLocked, isSelected, isHint, index, onClick, disabled,
}: {
  value: number;
  isRolling: boolean;
  isLocked: boolean;
  isSelected: boolean;
  isHint: boolean;
  index: number;
  onClick: () => void;
  disabled: boolean;
}) {
  // Accumulated rotation so the cube always tumbles *forward* and lands on `value`
  const accX = useRef(0);
  const accY = useRef(0);
  const [rot, setRot] = useState(() => FACE_ROTATION[value] ?? FACE_ROTATION[1]);

  useEffect(() => {
    const base = FACE_ROTATION[value] ?? FACE_ROTATION[1];
    if (isRolling) {
      // Full-turn multiples keep the landing face correct; vary per die for chaos
      accX.current += 360 * (3 + (index % 3));
      accY.current += 360 * (4 + ((index + 1) % 3));
      setRot({ x: base.x + accX.current, y: base.y + accY.current });
    } else {
      setRot({ x: base.x + accX.current, y: base.y + accY.current });
    }
  }, [isRolling, value, index]);

  // Face surface styling by state
  const faceBg = isLocked
    ? "linear-gradient(145deg, #FFF7E0 0%, #FDE9B0 100%)"
    : isSelected
    ? "linear-gradient(145deg, #2BA7B8 0%, #0D7A8A 100%)"
    : isHint
    ? "linear-gradient(145deg, #FFFFFF 0%, #DBF4F8 100%)"
    : "linear-gradient(145deg, #FFFFFF 0%, #EDEDED 100%)";
  const faceBorder = isLocked ? "#F59E0B" : isSelected ? "#0A6B7A" : isHint ? "#238D9D" : "#D8D8D8";
  const pipColor   = isSelected ? "#FFFFFF" : isLocked ? "#B45309" : "#1A1A1A";

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled || isLocked}
      animate={{
        y:       isSelected ? -10 : isLocked ? -6 : 0,
        scale:   isSelected ? 1.08 : 1,
      }}
      transition={{ type: "spring", stiffness: 420, damping: 22 }}
      className={`relative ${disabled && !isLocked ? "opacity-50" : "cursor-pointer"}`}
      style={{ width: SIZE, height: SIZE, perspective: 520 }}
    >
      {/* Glow ring under selected / hint dice */}
      <AnimatePresence>
        {(isSelected || isHint) && !isRolling && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-[-6px] rounded-2xl pointer-events-none"
            style={{
              boxShadow: isSelected
                ? "0 0 18px 2px rgba(13,122,138,0.55)"
                : "0 0 12px 1px rgba(35,141,157,0.35)",
            }}
          />
        )}
      </AnimatePresence>

      {/* The 3D cube */}
      <motion.div
        animate={{ rotateX: rot.x, rotateY: rot.y }}
        transition={isRolling
          ? { duration: 0.85, ease: [0.2, 0.8, 0.3, 1], delay: index * 0.05 }
          : { type: "spring", stiffness: 260, damping: 26 }}
        style={{ width: SIZE, height: SIZE, transformStyle: "preserve-3d", position: "relative" }}
      >
        {[1, 2, 3, 4, 5, 6].map((face) => (
          <div
            key={face}
            className="absolute inset-0 rounded-[11px] overflow-hidden"
            style={{
              transform:   FACE_PLACEMENT[face],
              background:  faceBg,
              border:      `2px solid ${faceBorder}`,
              backfaceVisibility: "hidden",
              boxShadow:   "inset 0 2px 4px rgba(255,255,255,0.7), inset 0 -3px 6px rgba(0,0,0,0.12)",
            }}
          >
            <Pips value={face} color={pipColor} />
          </div>
        ))}
      </motion.div>

      {/* Shadow on the felt */}
      <motion.span
        className="absolute left-1/2 -translate-x-1/2 rounded-[50%] bg-black/25 blur-[3px] pointer-events-none"
        animate={{
          width:   isRolling ? SIZE * 0.5 : SIZE * 0.8,
          opacity: isRolling ? 0.15 : 0.3,
        }}
        style={{ height: 7, bottom: -8 }}
      />

      {isLocked && (
        <div className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-amber-400 border-2 border-white flex items-center justify-center z-20 shadow">
          <span className="text-[9px]">🔒</span>
        </div>
      )}
    </motion.button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FarklePage() {
  const { address, waitForAuth } = useWeb3() as any;
  const router      = useRouter();

  const [screen,   setScreen]   = useState<Screen>("mode-select");
  const [mode,     setMode]     = useState<FarkleMode>("FARKLE_QUICK_1500_AKIBA");
  const [balances, setBalances] = useState<BalancesResponse | null>(null);
  const [matchId,  setMatchId]  = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(true);

  // Game result
  const [result, setResult] = useState<{ winnerId: string; yourScore: number; oppScore: number } | null>(null);

  const [balanceTick, setBalanceTick] = useState(0);
  const refreshBalances = useCallback(() => setBalanceTick((n) => n + 1), []);

  // ── Persist active match so a refresh / disconnect can resume ─────────────
  const enterGame = useCallback((id: string, m: FarkleMode) => {
    setMatchId(id);
    setMode(m);
    setScreen("game");
    try { localStorage.setItem("farkle:active", JSON.stringify({ matchId: id, mode: m })); } catch {}
  }, []);

  const leaveGame = useCallback(() => {
    try { localStorage.removeItem("farkle:active"); } catch {}
  }, []);

  // ── On mount: reconnect to an in-progress match if one exists ─────────────
  useEffect(() => {
    if (!address) { setReconnecting(false); return; }
    let cancelled = false;

    (async () => {
      // Fast path: localStorage hint
      let hinted: { matchId: string; mode: FarkleMode } | null = null;
      try {
        const raw = localStorage.getItem("farkle:active");
        if (raw) hinted = JSON.parse(raw);
      } catch {}

      // Authoritative: ask the server what match (if any) we're in
      try {
        const r = await fetch(`/api/games/farkle/active?address=${address.toLowerCase()}`);
        if (r.ok) {
          const { active } = await r.json();
          if (!cancelled && active?.matchId && active.status === "in_progress") {
            enterGame(active.matchId, (active.modeKey ?? hinted?.mode ?? "FARKLE_QUICK_1500_AKIBA") as FarkleMode);
            setReconnecting(false);
            return;
          }
        }
      } catch {}

      // No active server match — clear any stale hint
      if (!cancelled) { leaveGame(); setReconnecting(false); }
    })();

    return () => { cancelled = true; };
  }, [address, enterGame, leaveGame]);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/games/farkle/balances?address=${address.toLowerCase()}`)
      .then((r) => r.json()).then(setBalances).catch(() => {});
  }, [address, screen, balanceTick]);

  async function joinLobby() {
    if (!address) return;
    setError(null);
    setScreen("matchmaking");
    const r = await fetch("/api/games/farkle/matches/find", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: address.toLowerCase(), modeKey: mode }),
    });
    const data = await r.json();
    if (!r.ok) { setError(data.error ?? "failed to join lobby"); setScreen("mode-select"); return; }
    if (data.matchId) enterGame(data.matchId, (data.modeKey ?? mode) as FarkleMode);
  }

  async function challengePlayer(targetAddress: string) {
    if (!address) return;
    setError(null);
    if (targetAddress.startsWith("__matched__:")) {
      enterGame(targetAddress.slice("__matched__:".length), mode);
      return;
    }
    const r = await fetch("/api/games/farkle/matches/find", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: address.toLowerCase(), modeKey: mode, targetAddress }),
    });
    const data = await r.json();
    if (!r.ok) { setError(data.error ?? "challenge failed"); return; }
    if (data.matchId) enterGame(data.matchId, (data.modeKey ?? mode) as FarkleMode);
  }

  return (
    <main className="pb-28 font-sterling bg-onboarding min-h-screen">
      <div className="px-4 pt-8 pb-2 flex items-center gap-3">
        <button type="button" onClick={() => router.push("/games")}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-gray-200 shadow-sm">
          <ArrowLeft size={16} className="text-[#238D9D]" />
        </button>
        <h1 className="text-xl font-bold text-[#1A1A1A]">Farkle Duel</h1>
      </div>

      {error && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
          <WarningCircle size={16} className="text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-700 font-poppins">{error}</p>
        </div>
      )}

      {reconnecting && screen === "mode-select" && (
        <div className="px-4 mt-10 flex flex-col items-center gap-3">
          <SpinnerGap size={28} className="text-[#238D9D] animate-spin" />
          <p className="text-sm text-[#717171] font-poppins">Checking for an active match…</p>
        </div>
      )}

      {!reconnecting && screen === "mode-select" && (
        <ModeSelect balances={balances} selectedMode={mode} onSelectMode={setMode}
          onPlay={joinLobby} address={address} onBalanceRefresh={refreshBalances} />
      )}

      {screen === "matchmaking" && (
        <Matchmaking mode={mode} myAddress={address?.toLowerCase() ?? ""}
          onChallenge={challengePlayer} onCancel={() => setScreen("mode-select")} />
      )}

      {screen === "game" && matchId && address && (
        <GameBoard
          matchId={matchId}
          myAddress={address.toLowerCase()}
          mode={mode}
          waitForAuth={waitForAuth}
          onMatchEnd={(res) => { leaveGame(); setResult(res); setScreen("result"); }}
        />
      )}

      {screen === "result" && result && (
        <ResultScreen
          result={result}
          myAddress={address?.toLowerCase() ?? ""}
          mode={mode}
          onPlayAgain={() => { setResult(null); setMatchId(null); setScreen("mode-select"); }}
          onHome={() => router.push("/games")}
        />
      )}
    </main>
  );
}

// ─── Mode Select ──────────────────────────────────────────────────────────────

function ModeSelect({ balances, selectedMode, onSelectMode, onPlay, address, onBalanceRefresh }: {
  balances: BalancesResponse | null; selectedMode: FarkleMode;
  onSelectMode: (m: FarkleMode) => void; onPlay: () => void;
  address: string | null; onBalanceRefresh: () => void;
}) {
  const { buyPack, buying, buyError } = useFarkleTickets(address);

  const modes = [
    {
      key:      "FARKLE_QUICK_1500_AKIBA" as FarkleMode,
      label:    "Quick Duel",
      sub:      "Casual · AkibaMiles",
      target:   "1,500 pts",
      reward:   <span className="flex items-center gap-1">Win <MilesAmount value={10} size={11} /> · Lose <MilesAmount value={5} size={11} /></span>,
      icon:     <Lightning size={18} weight="fill" className="text-yellow-300" />,
      gradient: "from-[#0A6B7A] to-[#1A9AAD]",
    },
    {
      key:      "FARKLE_REWARD_3000_USDT" as FarkleMode,
      label:    "Reward Duel",
      sub:      "Competitive · USDT Credits",
      target:   "2,500 pts",
      reward:   <span>Win $0.15 + <MilesAmount value={10} size={11} /></span>,
      icon:     <CurrencyDollar size={18} weight="fill" className="text-green-300" />,
      gradient: "from-[#1A4A2A] to-[#2A7040]",
    },
  ];

  // Scoring cheat sheet
  const rules = [
    { dice: "1", pts: "100" }, { dice: "5", pts: "50" },
    { dice: "Three 1s", pts: "500" }, { dice: "Three any", pts: "200" },
    { dice: "2-3-4-5-6", pts: "400" }, { dice: "1-2-3-4-5-6", pts: "1000" },
  ];

  return (
    <div className="px-4 mt-2">
      {balances && (
        <div className="flex gap-2 mb-4 overflow-x-auto">
          {[
            { label: "Tickets", val: balances.akibaTickets,   icon: <Ticket size={11} weight="fill" className="text-[#238D9D]" /> },
            { label: "Credits", val: balances.gameCredits,    icon: <CurrencyDollar size={11} weight="fill" className="text-green-600" /> },
            { label: "Rewards", val: `$${(balances.rewardCreditsCents / 100).toFixed(2)}`, icon: <Trophy size={11} weight="fill" className="text-amber-500" /> },
          ].map(({ label, val, icon }) => (
            <div key={label} className="flex items-center gap-1.5 rounded-full bg-white border border-gray-200 px-3 py-1.5 flex-shrink-0">
              {icon}
              <span className="text-[11px] font-semibold">{val}</span>
              <span className="text-[10px] text-[#A0A0A0] font-poppins">{label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 mb-4">
        {modes.map((m) => (
          <button key={m.key} type="button" onClick={() => onSelectMode(m.key)}
            className={[
              "w-full text-left rounded-2xl p-4 relative overflow-hidden transition-all",
              `bg-gradient-to-br ${m.gradient}`,
              selectedMode === m.key ? "ring-2 ring-white/60 scale-[1.01]" : "opacity-85",
            ].join(" ")}
          >
            <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/10" />
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg bg-white/15 p-1.5">{m.icon}</div>
                <div>
                  <p className="font-bold text-white text-sm">{m.label}</p>
                  <p className="text-[10px] text-white/60 font-poppins">{m.sub} · {m.target}</p>
                  <p className="text-[11px] text-white/70 font-poppins mt-0.5">{m.reward}</p>
                </div>
              </div>
              {selectedMode === m.key && (
                <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold text-white">✓</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Scoring reference */}
      <div className="rounded-2xl bg-white border border-gray-100 px-4 py-3 mb-4">
        <p className="text-[11px] font-bold text-[#A0A0A0] uppercase tracking-widest mb-2">Scoring</p>
        <div className="grid grid-cols-3 gap-1.5">
          {rules.map((r) => (
            <div key={r.dice} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center">
              <p className="text-[10px] text-[#717171] font-poppins">{r.dice}</p>
              <p className="text-xs font-bold text-[#238D9D]">{r.pts}pt</p>
            </div>
          ))}
        </div>
      </div>

      {!address && <p className="text-xs text-[#717171] font-poppins text-center mb-3">Connect wallet to play</p>}

      <motion.button
        type="button"
        onClick={onPlay}
        disabled={!address}
        whileTap={{ scale: 0.97 }}
        className="w-full rounded-2xl bg-[#238D9D] py-4 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Sword size={16} weight="fill" className="inline mr-2" />
        Find Opponent
      </motion.button>
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

type WaitingPlayer = { address: string; username: string | null; queuedAt: string };

function Matchmaking({ mode, myAddress, onChallenge, onCancel }: {
  mode: FarkleMode; myAddress: string;
  onChallenge: (t: string) => void; onCancel: () => void;
}) {
  const [waiters,     setWaiters]     = useState<WaitingPlayer[]>([]);
  const [challenging, setChallenging] = useState<string | null>(null);
  const [dots,        setDots]        = useState(".");
  const matchedRef = useRef(false);

  const cancelQueue = useCallback(async () => {
    if (!myAddress) return;
    await fetch("/api/games/farkle/matches/queue", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modeKey: mode, address: myAddress }),
      keepalive: true,
    }).catch(() => {});
  }, [mode, myAddress]);

  useEffect(() => {
    const id = setInterval(() => setDots((d) => d.length >= 3 ? "." : d + "."), 600);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const poll = async () => {
      const r = await fetch(`/api/games/farkle/matches/queue?modeKey=${mode}&address=${myAddress}`);
      if (!r.ok) return;
      const data = await r.json();
      setWaiters(data.waiters ?? []);
      if (data.matchId) {
        matchedRef.current = true;
        onChallenge("__matched__:" + data.matchId);
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [mode, myAddress, onChallenge]);

  useEffect(() => {
    return () => {
      if (!matchedRef.current) void cancelQueue();
    };
  }, [cancelQueue]);

  const shorten = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

  async function leaveLobby() {
    await cancelQueue();
    onCancel();
  }

  return (
    <div className="px-4 mt-5">
      <div className="flex items-center gap-3 rounded-2xl bg-[#E8F7F9] border border-[#238D9D]/20 px-4 py-3 mb-5">
        <motion.div
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ repeat: Infinity, duration: 1.2 }}
          className="h-2 w-2 rounded-full bg-[#238D9D] flex-shrink-0"
        />
        <div>
          <p className="text-sm font-bold text-[#238D9D]">You're in the lobby{dots}</p>
          <p className="text-xs text-[#238D9D]/70 font-poppins mt-0.5">
            {mode === "FARKLE_QUICK_1500_AKIBA" ? "Quick Duel · 1,500 pts" : "Reward Duel · 2,500 pts"}
          </p>
        </div>
      </div>

      <h3 className="text-sm font-extrabold mb-2">
        {waiters.length === 0 ? "No opponents yet — share the link!" : `${waiters.length} player${waiters.length !== 1 ? "s" : ""} waiting`}
      </h3>

      <AnimatePresence>
        {waiters.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 flex flex-col items-center gap-3">
            <Sword size={28} className="text-gray-300" />
            <p className="text-sm text-[#A0A0A0] font-poppins text-center">
              Waiting for someone{dots}<br />
              <span className="text-xs">Both devices need to be on this page</span>
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2">
            {waiters.map((w) => (
              <motion.div key={w.address}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-2xl bg-white border border-gray-100 shadow-sm px-4 py-3">
                <div className="h-9 w-9 rounded-full bg-[#E8F7F9] flex items-center justify-center flex-shrink-0">
                  <Sword size={16} weight="fill" className="text-[#238D9D]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{w.username ?? shorten(w.address)}</p>
                  {w.username && <p className="text-[11px] text-[#A0A0A0] font-poppins">{shorten(w.address)}</p>}
                </div>
                <motion.button type="button" whileTap={{ scale: 0.94 }}
                  onClick={() => { setChallenging(w.address); onChallenge(w.address); }}
                  disabled={challenging !== null}
                  className="flex-shrink-0 rounded-xl bg-[#238D9D] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                  {challenging === w.address ? "Starting…" : "Challenge"}
                </motion.button>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

      <button type="button" onClick={leaveLobby}
        className="mt-5 w-full rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-[#717171]">
        Leave lobby
      </button>
    </div>
  );
}

// ─── Game Board (self-contained) ──────────────────────────────────────────────

interface RollState {
  dice:          number[];
  lockedIndices: number[]; // held from previous rolls this turn
  rolledIndices: number[]; // which positions were just rolled
  scoringHints:  number[]; // scoring positions in fresh dice
  turnPoints:    number;
  isFarkle:      boolean;
  isHotDice:     boolean;
}

function GameBoard({ matchId, myAddress, mode, waitForAuth, onMatchEnd }: {
  matchId:    string;
  myAddress:  string;
  mode:       FarkleMode;
  waitForAuth?: (timeoutMs?: number) => Promise<void>;
  onMatchEnd: (r: { winnerId: string; yourScore: number; oppScore: number }) => void;
}) {
  const [myScore,    setMyScore]    = useState(0);
  const [oppScore,   setOppScore]   = useState(0);
  const [targetScore, setTargetScore] = useState(1500);
  const [isMyTurn,   setIsMyTurn]   = useState(false);
  const [matchStatus, setMatchStatus] = useState("in_progress");

  const [rollState,   setRollState]   = useState<RollState | null>(null);
  const [selected,    setSelected]    = useState<number[]>([]);
  const [phase,       setPhase]       = useState<"idle" | "rolling" | "selecting" | "farkle" | "hot_dice">("idle");
  const [busy,        setBusy]        = useState(false);
  const [farkleAnim,  setFarkleAnim]  = useState(false);
  const [combo,       setCombo]       = useState<string | null>(null);
  const [moveError,   setMoveError]   = useState<string | null>(null);

  // Robustness
  const [connection,    setConnection]    = useState<"live" | "reconnecting">("live");
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [secondsLeft,   setSecondsLeft]   = useState<number | null>(null);
  const [claiming,      setClaiming]      = useState(false);

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const failuresRef = useRef(0);
  const busyRef    = useRef(false);
  const phaseRef   = useRef(phase);
  phaseRef.current = phase;

  const TURN_TIMEOUT = 60;

  // ── Resilient poll: tolerates transient failures, never throws ────────────
  const poll = useCallback(async () => {
    // Don't clobber local optimistic state while a move is mid-flight
    if (busyRef.current) return;
    try {
      const r = await fetch(`/api/games/farkle/${matchId}/state?address=${myAddress}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const s = await r.json();

      failuresRef.current = 0;
      setConnection("live");

      setMyScore(s.yourScore ?? 0);
      setOppScore(s.opponentScore ?? 0);
      setTargetScore(s.targetScore ?? 1500);
      setMatchStatus(s.matchStatus);
      setTurnStartedAt(s.turnStartedAt ? new Date(s.turnStartedAt).getTime() : null);

      const nowMyTurn = s.isYourTurn;
      setIsMyTurn(nowMyTurn);

      if (["completed", "settled"].includes(s.matchStatus)) {
        onMatchEnd({ winnerId: s.winnerUserId ?? "", yourScore: s.yourScore, oppScore: s.opponentScore });
        return;
      }
      // Reset local board when the turn comes to us and we're idle
      if (nowMyTurn && phaseRef.current === "idle") {
        setSelected([]);
        setMoveError(null);
        if (Array.isArray(s.currentRoll) && s.currentRoll.length === 6) {
          setRollState({
            dice:          s.currentRoll,
            lockedIndices: s.lockedIndices ?? [],
            rolledIndices: s.rolledIndices ?? [],
            scoringHints:  s.scoringHints ?? [],
            turnPoints:    s.turnPoints ?? 0,
            isFarkle:      Boolean(s.isFarkle),
            isHotDice:     Boolean(s.isHotDice),
          });
          setPhase(s.isFarkle ? "farkle" : "selecting");
        } else {
          setRollState(null);
        }
      } else if (!nowMyTurn && phaseRef.current === "idle") {
        setRollState(null);
        setSelected([]);
      }
    } catch {
      failuresRef.current += 1;
      // Two consecutive failures → surface a reconnecting indicator
      if (failuresRef.current >= 2) setConnection("reconnecting");
    }
  }, [matchId, myAddress, onMatchEnd]);

  useEffect(() => {
    poll();
    pollRef.current = setInterval(poll, 2000);

    // Immediately refetch when the tab regains focus (mobile backgrounding)
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  // ── Turn countdown timer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!turnStartedAt || matchStatus !== "in_progress") { setSecondsLeft(null); return; }
    const tick = () => {
      const elapsed = (Date.now() - turnStartedAt) / 1000;
      setSecondsLeft(Math.max(0, Math.ceil(TURN_TIMEOUT - elapsed)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [turnStartedAt, matchStatus]);

  async function claimTimeout() {
    if (claiming) return;
    setClaiming(true);
    try {
      await waitForAuth?.();
      const r = await fetch(`/api/games/farkle/${matchId}/timeout`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: myAddress }),
      });
      const data = await r.json();
      if (r.ok && data.winnerId) {
        onMatchEnd({ winnerId: data.winnerId, yourScore: myScore, oppScore });
      }
    } catch {}
    setClaiming(false);
  }

  async function doRoll(holdIndices: number[] = []) {
    if (busyRef.current) return;     // synchronous guard against double-fire
    const wasReRoll = !!rollState;   // preserve the board if a re-roll fails
    setBusy(true); busyRef.current = true;
    setMoveError(null);
    setPhase("rolling");
    setSelected([]);

    let data: any = null;
    try {
      await waitForAuth?.();
      const r = await fetch(`/api/games/farkle/${matchId}/roll`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: myAddress, holdIndices }),
      });
      data = await r.json();
      if (!r.ok) {
        setBusy(false); busyRef.current = false;
        setMoveError(data?.error ?? "Roll failed — try again");
        // Keep the board so nothing "disappears"; let the user retry
        setPhase(wasReRoll ? "selecting" : "idle");
        return;
      }
    } catch {
      setBusy(false); busyRef.current = false;
      setMoveError("Network error — retrying connection");
      setPhase(wasReRoll ? "selecting" : "idle");
      return;
    }
    setBusy(false); busyRef.current = false;
    setMoveError(null);

    // Set the dice (final values) while phase is still "rolling" so the cubes
    // tumble and land on them. Then resolve after the tumble completes.
    setRollState({
      dice:          data.dice,
      lockedIndices: data.lockedIndices ?? [],
      rolledIndices: data.rolledIndices ?? [],
      scoringHints:  data.scoringHints ?? [],
      turnPoints:    data.turnPoints ?? 0,
      isFarkle:      data.isFarkle,
      isHotDice:     data.isHotDice,
    });

    // Tumble duration (matches the cube animation: 0.85s + stagger)
    const TUMBLE_MS = 1050;

    setTimeout(() => {
      if (data.isFarkle) {
        setPhase("farkle");
        setFarkleAnim(true);
        setTimeout(() => { setFarkleAnim(false); setPhase("idle"); setRollState(null); }, 2000);
      } else if (data.isHotDice) {
        setPhase("hot_dice");
        setTimeout(() => setPhase("selecting"), 1200);
      } else {
        setPhase("selecting");
      }
    }, TUMBLE_MS);
  }

  async function doBank(finalHold: number[]) {
    if (busyRef.current || finalHold.length === 0) return;  // synchronous guard
    setBusy(true); busyRef.current = true;
    let data: any = null;
    try {
      await waitForAuth?.();
      const r = await fetch(`/api/games/farkle/${matchId}/bank`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: myAddress, holdIndices: finalHold }),
      });
      data = await r.json();
      if (!r.ok) {
        setBusy(false); busyRef.current = false;
        setMoveError(data?.error ?? "Bank failed — try again");
        return; // stay in selecting phase, board intact
      }
    } catch {
      setBusy(false); busyRef.current = false;
      setMoveError("Network error — try again");
      return;
    }
    setBusy(false); busyRef.current = false;
    setMoveError(null);

    if (data.matchComplete) {
      onMatchEnd({
        winnerId: data.winnerId ?? "",
        yourScore: data.bankedScore ?? myScore,
        oppScore: data.opponentScore ?? oppScore,
      });
    } else {
      setPhase("idle");
      setRollState(null);
      setSelected([]);
      setIsMyTurn(false);
    }
  }

  function toggleDie(i: number) {
    if (!rollState) return;
    if (rollState.lockedIndices.includes(i)) return;       // can't change locked dice
    if (!rollState.scoringHints.includes(i)) return;        // only scoring dice are selectable
    const dice = rollState.dice as DiceValue[];

    setSelected((prev) => {
      // Deselect: remove this die (and any same-face group members that no longer score alone)
      if (prev.includes(i)) {
        const next = prev.filter((x) => x !== i);
        const sc = scoreDice(next.map((idx) => dice[idx]));
        if (next.length > 0 && (sc.score === 0 || sc.scoringIndices.length !== next.length)) {
          setCombo(null);
          return [];
        }
        setCombo(next.length ? sc.combos.join(" + ") : null);
        return next;
      }

      // Select: try just this die; if it doesn't score alone (e.g. a "2"), grab its whole face group
      let additions = [i];
      if (scoreDice([dice[i]]).score === 0) {
        const sameFace = rollState.scoringHints.filter((idx) => dice[idx] === dice[i] && !prev.includes(idx));
        additions = scoreDice(sameFace.map((idx) => dice[idx])).score > 0
          ? sameFace
          : rollState.scoringHints.filter((idx) => !prev.includes(idx));
      }
      const next = [...new Set([...prev, ...additions])];
      const sc = scoreDice(next.map((idx) => dice[idx]));
      if (sc.score === 0 || sc.scoringIndices.length !== next.length) return prev; // still invalid — ignore
      setCombo(sc.combos.join(" + ") || null);
      return next;
    });
  }

  const selectedScore = rollState && selected.length > 0
    ? scoreDice(selected.map((i) => (rollState.dice as DiceValue[])[i])).score
    : 0;

  const totalIfBank = (rollState?.turnPoints ?? 0) + selectedScore;
  const canRollAgain = selected.length > 0 && selectedScore > 0;
  const canBank      = selected.length > 0 && selectedScore > 0;

  return (
    <div className="px-4 mt-3">
      {/* Scoreboard */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { label: "You",      score: myScore,  pct: (myScore  / targetScore) * 100, accent: "#238D9D" },
          { label: "Opponent", score: oppScore, pct: (oppScore / targetScore) * 100, accent: "#A0A0A0" },
        ].map(({ label, score, pct, accent }) => (
          <div key={label} className="rounded-2xl bg-white border border-gray-100 shadow-sm px-4 py-3 text-center">
            <p className="text-[10px] text-[#A0A0A0] font-poppins uppercase tracking-widest">{label}</p>
            <motion.p
              key={score}
              initial={{ scale: 1.15 }} animate={{ scale: 1 }}
              className="text-2xl font-bold mt-0.5"
              style={{ color: accent }}
            >
              {score.toLocaleString()}
            </motion.p>
            <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <motion.div
                className="h-1.5 rounded-full"
                animate={{ width: `${Math.min(100, pct)}%` }}
                transition={{ duration: 0.4 }}
                style={{ background: accent }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Connection indicator */}
      <AnimatePresence>
        {connection === "reconnecting" && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mb-2 flex items-center justify-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5"
          >
            <SpinnerGap size={12} className="text-amber-600 animate-spin" />
            <span className="text-[11px] text-amber-700 font-poppins">Reconnecting…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Turn banner with timer */}
      <motion.div
        key={isMyTurn ? "yours" : "theirs"}
        initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
        className={`mb-3 rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-bold ${
          isMyTurn ? "bg-[#238D9D] text-white" : "bg-gray-100 text-[#717171]"
        }`}
      >
        <span>{isMyTurn ? "⚡ Your turn" : "⏳ Opponent's turn…"}</span>
        {secondsLeft !== null && matchStatus === "in_progress" && (
          <span className={`tabular-nums text-xs font-semibold rounded-full px-2 py-0.5 ${
            secondsLeft <= 10
              ? "bg-red-500/20 text-red-100"
              : isMyTurn ? "bg-white/20" : "bg-gray-200 text-[#717171]"
          }`}>
            {secondsLeft}s
          </span>
        )}
      </motion.div>

      {/* Opponent idle — claim win */}
      <AnimatePresence>
        {!isMyTurn && secondsLeft === 0 && matchStatus === "in_progress" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="mb-3"
          >
            <button
              type="button"
              onClick={claimTimeout}
              disabled={claiming}
              className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-white disabled:opacity-50 active:scale-[0.98] transition-all"
            >
              {claiming ? "Claiming…" : "⏰ Opponent idle — Claim win"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Turn points accumulator */}
      <AnimatePresence>
        {(rollState?.turnPoints ?? 0) > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="mb-3 flex items-center justify-between rounded-xl bg-amber-50 border border-amber-200 px-4 py-2"
          >
            <span className="text-xs text-amber-700 font-poppins">Banked this turn</span>
            <span className="text-sm font-bold text-amber-700">+{rollState!.turnPoints}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Farkle explosion */}
      <AnimatePresence>
        {farkleAnim && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.1, opacity: 0 }}
            className="mb-3 rounded-2xl bg-red-500 px-4 py-4 text-center shadow-lg"
          >
            <motion.p
              animate={{ scale: [1, 1.1, 1], rotate: [-3, 3, -3, 0] }}
              transition={{ repeat: 2, duration: 0.4 }}
              className="text-2xl font-extrabold text-white"
            >
              💥 FARKLE!
            </motion.p>
            <p className="text-sm text-white/80 font-poppins mt-1">You lose your unbanked points</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hot dice */}
      <AnimatePresence>
        {phase === "hot_dice" && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
            className="mb-3 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-400 px-4 py-3 text-center shadow-md"
          >
            <motion.p
              animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: 2, duration: 0.4 }}
              className="text-lg font-extrabold text-white"
            >
              🔥 HOT DICE!
            </motion.p>
            <p className="text-xs text-white/90 font-poppins">All dice scored — roll all 6 again!</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dice tray (felt table) */}
      <motion.div
        animate={farkleAnim
          ? { x: [0, -10, 9, -7, 6, -3, 0], rotate: [0, -1, 1, -0.6, 0] }
          : { x: 0, rotate: 0 }}
        transition={{ duration: 0.5 }}
        className="relative mb-4 rounded-3xl px-4 py-6 overflow-hidden"
        style={{
          minHeight: 132,
          background: "radial-gradient(120% 120% at 50% 0%, #1d6b56 0%, #14503f 60%, #0d3b2e 100%)",
          boxShadow: "inset 0 3px 16px rgba(0,0,0,0.45), inset 0 -2px 8px rgba(255,255,255,0.06), 0 6px 18px rgba(0,0,0,0.18)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* felt texture dots */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "10px 10px" }} />

        <div className="relative z-10 flex items-center justify-center min-h-[68px]">
          {rollState ? (
            <div className="flex flex-wrap gap-3.5 justify-center">
              {rollState.dice.map((v, i) => {
                const isLocked   = rollState.lockedIndices.includes(i);
                const isRolling  = phase === "rolling" && rollState.rolledIndices.includes(i);
                const isSelected = selected.includes(i);
                const isHint     = !isLocked && !isSelected && rollState.scoringHints.includes(i) && phase === "selecting";
                return (
                  <Die3D
                    key={i}
                    value={v}
                    index={i}
                    isRolling={isRolling}
                    isLocked={isLocked}
                    isSelected={isSelected}
                    isHint={isHint}
                    onClick={() => phase === "selecting" && toggleDie(i)}
                    disabled={!isMyTurn || phase !== "selecting" || isLocked}
                  />
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <motion.div
                animate={{ rotate: [0, 12, -12, 0], y: [0, -3, 0] }}
                transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
                className="text-3xl"
              >
                🎲
              </motion.div>
              <p className="text-xs text-white/60 font-poppins">
                {isMyTurn ? "Tap Roll to throw the dice" : "Waiting for opponent…"}
              </p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Combo flash */}
      <AnimatePresence>
        {combo && selectedScore > 0 && (
          <motion.div
            key={combo}
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mb-2 text-center"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-[#238D9D] px-3 py-1 text-xs font-bold text-white">
              ✨ {combo} = +{selectedScore} pts
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Move error */}
      <AnimatePresence>
        {moveError && (
          <motion.div
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2"
          >
            <WarningCircle size={14} className="text-red-500 flex-shrink-0" />
            <span className="text-xs text-red-700 font-poppins">{moveError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action buttons */}
      {isMyTurn && (
        <div className="space-y-2.5">
          {/* Roll / Roll again */}
          {phase !== "farkle" && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.96, y: 2 }}
              animate={phase === "rolling" ? {} : { y: [0, -1.5, 0] }}
              transition={phase === "rolling" ? {} : { repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
              onClick={() => {
                if (!rollState || phase === "hot_dice") {
                  doRoll([]);
                } else if (phase === "selecting" && canRollAgain) {
                  doRoll(selected);
                } else if (phase === "idle" || !rollState) {
                  doRoll([]);
                }
              }}
              disabled={busy || (phase === "selecting" && !canRollAgain && !!rollState) || phase === "rolling"}
              className="w-full rounded-2xl py-4 text-base font-extrabold text-white disabled:cursor-not-allowed relative overflow-hidden"
              style={{
                background: (phase === "selecting" && !canRollAgain && !!rollState)
                  ? "#9DB4B8"
                  : "linear-gradient(180deg, #2BA7B8 0%, #1d7a89 60%, #156270 100%)",
                boxShadow: "0 4px 0 #0e4e58, 0 8px 18px rgba(13,122,138,0.4), inset 0 1px 0 rgba(255,255,255,0.3)",
              }}
            >
              {(() => {
                if (phase === "rolling")
                  return <span className="flex items-center justify-center gap-2"><SpinnerGap size={18} className="animate-spin" /> Rolling…</span>;
                if (!rollState || phase === "hot_dice") return "🎲 ROLL DICE";
                if (!canRollAgain) return "Select scoring dice to continue";
                const remaining = 6 - rollState.lockedIndices.length - selected.length;
                return remaining === 0 ? "🔥 ROLL AGAIN — HOT DICE!" : `🎲 ROLL ${remaining} DICE`;
              })()}
            </motion.button>
          )}

          {/* Bank */}
          {phase === "selecting" && canBank && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => doBank(selected)}
              disabled={busy}
              className="w-full rounded-2xl border-2 border-[#238D9D] bg-white py-4 text-sm font-bold text-[#238D9D] disabled:opacity-40 shadow-sm"
            >
              {busy ? "Banking…" : `✓ Bank ${totalIfBank.toLocaleString()} pts`}
            </motion.button>
          )}

          {/* Forfeit */}
          <button type="button"
            onClick={async () => {
              if (!confirm("Forfeit? You will lose.")) return;
              await waitForAuth?.();
              await fetch(`/api/games/farkle/${matchId}/forfeit`, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ address: myAddress }),
              });
            }}
            className="w-full py-2 text-xs font-semibold text-[#A0A0A0] font-poppins"
          >
            Forfeit
          </button>
        </div>
      )}

      {/* Instruction hint */}
      {isMyTurn && phase === "selecting" && rollState && !farkleAnim && (
        <p className="text-center text-[11px] text-[#A0A0A0] font-poppins mt-3">
          Tap scoring dice to hold · Roll more or bank
        </p>
      )}

      <p className="text-center text-[11px] text-[#A0A0A0] font-poppins mt-2">
        First to {targetScore.toLocaleString()} wins
      </p>
    </div>
  );
}

// ─── Result Screen ────────────────────────────────────────────────────────────

function ResultScreen({ result, myAddress, mode, onPlayAgain, onHome }: {
  result: { winnerId: string; yourScore: number; oppScore: number };
  myAddress: string; mode: FarkleMode;
  onPlayAgain: () => void; onHome: () => void;
}) {
  const isWinner = result.winnerId === myAddress;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="px-4 mt-8 flex flex-col items-center gap-5"
    >
      <motion.div
        initial={{ scale: 0 }} animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.1 }}
        className={`h-24 w-24 rounded-full flex items-center justify-center text-5xl shadow-xl ${
          isWinner ? "bg-gradient-to-br from-[#238D9D] to-[#0A6B7A]" : "bg-gray-200"
        }`}
      >
        {isWinner ? "🏆" : "😤"}
      </motion.div>

      <div className="text-center">
        <h2 className="text-2xl font-bold">{isWinner ? "You won!" : "You lost."}</h2>
        <p className="text-sm text-[#717171] font-poppins mt-1">
          {result.yourScore.toLocaleString()} — {result.oppScore.toLocaleString()}
        </p>
      </div>

      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm px-6 py-4 w-full space-y-2.5">
        {isWinner && mode === "FARKLE_REWARD_3000_USDT" && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#717171] font-poppins">Reward Credit</span>
            <span className="text-sm font-bold text-green-600">+$0.15</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#717171] font-poppins">AkibaMiles</span>
          <span className="text-sm font-bold text-[#238D9D]">
            +<MilesAmount value={isWinner ? 10 : 5} size={13} />
          </span>
        </div>
      </div>

      <div className="flex gap-3 w-full">
        <button type="button" onClick={onHome}
          className="flex-1 rounded-2xl border border-gray-200 bg-white py-3.5 text-sm font-semibold text-[#717171]">
          Back
        </button>
        <motion.button type="button" onClick={onPlayAgain} whileTap={{ scale: 0.97 }}
          className="flex-1 rounded-2xl bg-[#238D9D] py-3.5 text-sm font-bold text-white">
          Play Again
        </motion.button>
      </div>
    </motion.div>
  );
}
