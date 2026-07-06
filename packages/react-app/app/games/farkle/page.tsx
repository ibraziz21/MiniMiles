"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useWeb3 } from "@/contexts/useWeb3";
import {
  ArrowLeft, Trophy, Sword,
  WarningCircle, SpinnerGap, Info, X,
} from "@phosphor-icons/react";
import { MilesAmount } from "@/components/games/miles-amount";
import { akibaMilesSymbol, usdtSymbol } from "@/lib/svg";
import type { BalancesResponse, FarkleMode, TurnState } from "@/lib/farkle/types";
import { scoreDice, getScoringIndices } from "@/lib/farkle/engine";
import type { DiceValue } from "@/lib/farkle/engine";
import { useFarkleTickets } from "@/hooks/farkle/useFarkleTickets";
import { useFarkleCredits } from "@/hooks/farkle/useFarkleCredits";
import { useFarkleClaim } from "@/hooks/farkle/useFarkleClaim";

type Screen = "mode-select" | "matchmaking" | "game" | "result";
type QueueType = "public" | "invite";
type FarkleSettlementStatus = "settled" | "pending";
type FarkleResult = {
  matchId: string;
  winnerId: string;
  yourScore: number;
  oppScore: number;
  settlementStatus?: FarkleSettlementStatus;
  voided?: boolean;
  message?: string;
};

type LeaderboardEntry = {
  rank: number;
  walletAddress: string;
  username: string | null;
  wins: number;
  losses: number;
  record: string;
};
type LeaderboardData = {
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
};

const QUICK_DUEL_MODE: FarkleMode = "FARKLE_QUICK_1500_AKIBA";
const REWARD_DUEL_MODE: FarkleMode = "FARKLE_REWARD_3000_USDT";
const PRO_DUEL_MODE: FarkleMode = "FARKLE_PRO_5000_USDT";
const CREDIT_MODE_KEYS = new Set<FarkleMode>([REWARD_DUEL_MODE, PRO_DUEL_MODE]);

function isCreditFarkleMode(mode: FarkleMode) {
  return CREDIT_MODE_KEYS.has(mode);
}

function creditEntryAmount(mode: FarkleMode) {
  return mode === PRO_DUEL_MODE ? 10 : mode === REWARD_DUEL_MODE ? 1 : 0;
}

function creditPackIdForMode(mode: FarkleMode) {
  return mode === PRO_DUEL_MODE ? 1 : 0;
}

function modeDisplayLabel(mode: FarkleMode) {
  if (mode === PRO_DUEL_MODE) return "Pro Duel · 5,000 pts";
  if (mode === REWARD_DUEL_MODE) return "Reward Duel · 2,500 pts";
  return "Quick Duel · 1,500 pts";
}

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

// ─── Static mini die (used in scoring sheet) ─────────────────────────────────

function MiniDie({ value, size = 28 }: { value: number; size?: number }) {
  return (
    <div
      className="rounded-md bg-white border-2 border-gray-200 flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" style={{ width: size * 0.68, height: size * 0.68 }}>
        {(DOTS[value] ?? DOTS[1]).map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={11} fill="#1A1A1A"
            style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.18))" }} />
        ))}
      </svg>
    </div>
  );
}

// ─── How to Play bottom sheet ─────────────────────────────────────────────────

const SCORING_ROWS: { dice: number[]; label: string; pts: string }[] = [
  { dice: [1],          label: "Single 1",        pts: "100 pts" },
  { dice: [5],          label: "Single 5",         pts: "50 pts"  },
  { dice: [1, 1, 1],    label: "Three 1s",         pts: "500 pts" },
  { dice: [2, 2, 2],    label: "Three of a Kind",  pts: "200 pts" },
  { dice: [2, 3, 4, 5, 6], label: "Straight 2–6",  pts: "400 pts" },
  { dice: [1, 2, 3, 4, 5, 6], label: "Full Straight", pts: "1000 pts" },
];

function HowToPlaySheet({ onClose }: { onClose: () => void }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white px-4 pt-4 pb-10 max-h-[88dvh] overflow-y-auto"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" />
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-extrabold text-[#1A1A1A]">How to Play</h2>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>

        <div className="rounded-2xl bg-[#E8F7F9] border border-[#238D9D]/20 px-4 py-3 mb-5">
          <p className="text-[10px] font-extrabold text-[#238D9D] uppercase tracking-widest mb-2">Turn Flow</p>
          {[
            "🎲  Roll all 6 dice",
            "✋  Select at least one scoring die to hold",
            "🔄  Roll remaining dice OR bank your points",
            "🏦  First player to the target score wins!",
          ].map((step, i) => (
            <p key={i} className="text-xs text-[#1A1A1A] font-poppins py-0.5">{step}</p>
          ))}
        </div>

        <p className="text-[10px] font-extrabold text-[#A0A0A0] uppercase tracking-widest mb-3">Scoring Combos</p>
        <div className="space-y-2 mb-5">
          {SCORING_ROWS.map((row, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5 gap-2">
              <div className="flex items-center gap-1 flex-wrap">
                {row.dice.map((v, j) => <MiniDie key={j} value={v} size={28} />)}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[10px] text-[#717171] font-poppins">{row.label}</p>
                <p className="text-sm font-extrabold text-[#238D9D]">{row.pts}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5">
            <p className="text-xs font-bold text-red-600 mb-0.5">💥 Farkle</p>
            <p className="text-[11px] text-[#717171] font-poppins">No scoring dice — you lose all unbanked points for that turn</p>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
            <p className="text-xs font-bold text-amber-600 mb-0.5">🔥 Hot Dice</p>
            <p className="text-[11px] text-[#717171] font-poppins">All 6 dice score — roll all 6 again and keep stacking points!</p>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ─── Akiba Game Nights ───────────────────────────────────────────────────────

const GN_REQUIRED = 20; // server-authoritative; used as UI fallback before data loads
const GN_WINNER_PRIZE_USD = 15;
const GN_RUNNER_UP_PRIZE_USD = 5;
const GN_BRACKET_SIZE = 16;

function TokenIcon({
  token,
  size,
  className = "",
}: {
  token: "miles" | "usdt";
  size: number;
  className?: string;
}) {
  return (
    <Image
      src={token === "usdt" ? usdtSymbol : akibaMilesSymbol}
      alt={token === "usdt" ? "USDT" : "MiniMiles"}
      width={size}
      height={size}
      className={["inline-block", className].filter(Boolean).join(" ")}
    />
  );
}

function GameNightsSheet({
  onClose,
  onSelectRewardDuel,
}: {
  onClose: () => void;
  onSelectRewardDuel: () => void;
}) {
  const windowLabel = "Monday-Sunday UTC";

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white px-4 pt-4 pb-10 max-h-[88dvh] overflow-y-auto"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" />

        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold text-[#1A1A1A]">Akiba Game Nights</h2>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-700">
                Coming soon
              </span>
            </div>
            <p className="text-xs text-[#717171] font-poppins mt-0.5">Weekly Farkle PvP bracket</p>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>

        <div className="rounded-2xl bg-[#E8F7F9] border border-[#238D9D]/20 px-4 py-3.5 mb-4">
          <p className="text-xs font-extrabold text-[#238D9D] mb-1">Registration opens soon</p>
          <p className="text-[11px] text-[#40737A] font-poppins leading-relaxed">
            Keep playing Reward Duel now. Your weekly completed games count toward qualification while the bracket is being prepared.
          </p>
        </div>

        {/* Prize pool */}
        <div className="rounded-2xl bg-gradient-to-br from-[#1A0A3A] to-[#312E81] px-4 py-3.5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-extrabold text-white/60 uppercase tracking-widest">Weekly Rewards</p>
            <p className="text-[10px] font-bold text-white/60">Top {GN_BRACKET_SIZE} bracket</p>
          </div>
          <div className="flex gap-3">
            <div className="flex-1 rounded-xl bg-white/10 px-3 py-2.5 text-center">
              <Trophy size={18} weight="fill" className="text-amber-300 mx-auto mb-1" />
              <p className="text-base font-black text-white">${GN_WINNER_PRIZE_USD}</p>
              <p className="text-[10px] text-white/60 font-poppins">Winner</p>
            </div>
            <div className="flex-1 rounded-xl bg-white/10 px-3 py-2.5 text-center">
              <Trophy size={18} weight="fill" className="text-white/40 mx-auto mb-1" />
              <p className="text-base font-black text-white">${GN_RUNNER_UP_PRIZE_USD}</p>
              <p className="text-[10px] text-white/60 font-poppins">Runner-up</p>
            </div>
          </div>
          <p className="text-[11px] text-white/60 font-poppins mt-3">
            ${GN_WINNER_PRIZE_USD + GN_RUNNER_UP_PRIZE_USD} weekly prize pool for the final bracket.
          </p>
        </div>

        <div className="rounded-2xl bg-gray-50 border border-gray-100 px-4 py-3.5 mb-4">
          <p className="text-xs font-bold text-[#1A1A1A] mb-2">How to qualify</p>
          <div className="space-y-2 text-[11px] text-[#717171] font-poppins leading-relaxed">
            <p>Complete {GN_REQUIRED} Reward Duel matches during the weekly {windowLabel} window.</p>
            <p>Qualified players enter the coming Game Nights registration pool. The final bracket is seeded from qualified players when registration opens.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="rounded-2xl border border-gray-100 bg-white px-3 py-3">
            <p className="text-[10px] font-extrabold uppercase text-[#A0A0A0]">Entry path</p>
            <p className="mt-1 text-xs font-bold text-[#1A1A1A]">Reward Duel only</p>
            <p className="mt-0.5 text-[11px] text-[#717171] font-poppins">Completed matches count</p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white px-3 py-3">
            <p className="text-[10px] font-extrabold uppercase text-[#A0A0A0]">Registration cap</p>
            <p className="mt-1 text-xs font-bold text-[#1A1A1A]">40 players</p>
            <p className="mt-0.5 text-[11px] text-[#717171] font-poppins">First qualified players</p>
          </div>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={onSelectRewardDuel}
          className="w-full rounded-2xl border-2 border-[#238D9D] bg-white py-3.5 text-sm font-bold text-[#238D9D]"
        >
          Play Reward Duel to qualify
        </motion.button>
      </motion.div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FarklePage() {
  const { address, waitForAuth } = useWeb3() as any;
  const router      = useRouter();

  const [screen,   setScreen]   = useState<Screen>("mode-select");
  const [mode,     setMode]     = useState<FarkleMode>(QUICK_DUEL_MODE);
  const [queueType, setQueueType] = useState<QueueType>("public");
  const [initialInviteCode, setInitialInviteCode] = useState<string | null>(null);
  const [balances, setBalances] = useState<BalancesResponse | null>(null);
  const [matchId,  setMatchId]  = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(true);

  // Game result
  const [result, setResult] = useState<FarkleResult | null>(null);

  const [balanceTick,      setBalanceTick]      = useState(0);
  const [leaderboardTick,  setLeaderboardTick]  = useState(0);
  const refreshBalances = useCallback(() => setBalanceTick((n) => n + 1), []);

  // Pre-fetch leaderboard data in the background as soon as a Reward Duel result appears,
  // so the data is warm when the user returns to mode-select and opens the sheet.
  useEffect(() => {
    if (screen === "result" && mode === REWARD_DUEL_MODE) {
      setLeaderboardTick((n) => n + 1);
    }
  }, [screen, mode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedMode = params.get("mode") ?? params.get("modeKey");
    if (requestedMode === "pro" || requestedMode === PRO_DUEL_MODE) {
      setMode(PRO_DUEL_MODE);
    } else if (requestedMode === "reward" || requestedMode === REWARD_DUEL_MODE) {
      setMode(REWARD_DUEL_MODE);
    }
  }, []);

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

  const finishMatch = useCallback((res: FarkleResult) => {
    leaveGame();
    setResult(res);
    setScreen("result");
    try {
      localStorage.setItem("farkle:lastResult", JSON.stringify({
        wallet: address?.toLowerCase() ?? "",
        mode,
        result: res,
        savedAt: Date.now(),
      }));
    } catch {}
  }, [address, leaveGame, mode]);

  const resetToFarkleStart = useCallback(() => {
    setResult(null);
    setMatchId(null);
    setScreen("mode-select");
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
            enterGame(active.matchId, (active.modeKey ?? hinted?.mode ?? QUICK_DUEL_MODE) as FarkleMode);
            setReconnecting(false);
            return;
          }
        }
      } catch {}

      // No active server match — restore the latest completed result if it still
      // needs recovery, otherwise clear the stale active-match hint.
      try {
        const raw = localStorage.getItem("farkle:lastResult");
        const saved = raw ? JSON.parse(raw) : null;
        const fresh = typeof saved?.savedAt === "number" && Date.now() - saved.savedAt < 24 * 60 * 60 * 1000;
        if (!cancelled && fresh && saved?.wallet === address.toLowerCase() && saved?.result?.matchId) {
          setMode((saved.mode ?? hinted?.mode ?? QUICK_DUEL_MODE) as FarkleMode);
          setResult(saved.result as FarkleResult);
          setScreen("result");
          setReconnecting(false);
          return;
        }
      } catch {}

      if (!cancelled) { leaveGame(); setReconnecting(false); }
    })();

    return () => { cancelled = true; };
  }, [address, enterGame, leaveGame]);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/games/farkle/balances?address=${address.toLowerCase()}`)
      .then((r) => r.json()).then(setBalances).catch(() => {});
  }, [address, screen, balanceTick]);

  async function joinLobby(nextQueueType: QueueType) {
    if (!address) return;
    setError(null);
    setInitialInviteCode(null);
    setQueueType(nextQueueType);
    setScreen("matchmaking");
    const r = await fetch("/api/games/farkle/matches/find", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: address.toLowerCase(), modeKey: mode, queueType: nextQueueType }),
    });
    const data = await r.json();
    if (!r.ok) { setError(data.error ?? "failed to join lobby"); setScreen("mode-select"); return; }
    if (data.matchId) enterGame(data.matchId, (data.modeKey ?? mode) as FarkleMode);
    if (data.inviteCode) setInitialInviteCode(data.inviteCode);
  }

  return (
    <main className="pb-28 font-sterling bg-onboarding min-h-screen">
      <div className="px-4 pt-8 pb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (screen === "result") {
              resetToFarkleStart();
              return;
            }
            if (screen === "matchmaking") {
              // Matchmaking's cleanup effect cancels the queue when it unmounts.
              setScreen("mode-select");
              return;
            }
            router.push("/games");
          }}
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
          onFindLobby={() => joinLobby("public")} onChallengeFriend={() => joinLobby("invite")}
          address={address} onBalanceRefresh={refreshBalances}
          leaderboardTick={leaderboardTick} />
      )}

      {screen === "matchmaking" && (
        <Matchmaking mode={mode} queueType={queueType} initialInviteCode={initialInviteCode}
          myAddress={address?.toLowerCase() ?? ""}
          onMatchStart={enterGame} onCancel={() => setScreen("mode-select")} />
      )}

      {screen === "game" && matchId && address && (
        <GameBoard
          matchId={matchId}
          myAddress={address.toLowerCase()}
          mode={mode}
          waitForAuth={waitForAuth}
          onMatchEnd={finishMatch}
        />
      )}

      {screen === "result" && result && (
        <ResultScreen
          result={result}
          myAddress={address?.toLowerCase() ?? ""}
          mode={mode}
          onPlayAgain={resetToFarkleStart}
          onBackToFarkle={resetToFarkleStart}
        />
      )}
    </main>
  );
}

// ─── Reward Duel Leaderboard sheet ───────────────────────────────────────────

function RewardDuelLeaderboardSheet({
  address,
  onClose,
  onSelectRewardDuel,
  data,
  loading,
  error,
  onRetry,
}: {
  address: string | null;
  onClose: () => void;
  onSelectRewardDuel: () => void;
  data: LeaderboardData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const myAddr = address?.toLowerCase() ?? null;
  const outsideTop10 = !!data?.me && !data.entries.some((e) => e.walletAddress === myAddr);
  const shorten = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white px-4 pt-4 pb-10 max-h-[80dvh] overflow-y-auto"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Trophy size={18} weight="fill" className="text-amber-500" />
            <h2 className="text-lg font-extrabold text-[#1A1A1A]">Reward Duel Leaderboard</h2>
            {/* Subtle spinner while refreshing with stale data already shown */}
            {loading && data && (
              <SpinnerGap size={14} className="text-[#238D9D] animate-spin" />
            )}
          </div>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>

        {/* Initial loading — no data yet */}
        {loading && !data && (
          <div className="flex flex-col items-center gap-3 py-10">
            <SpinnerGap size={24} className="text-[#238D9D] animate-spin" />
            <p className="text-sm text-[#717171] font-poppins">Loading…</p>
          </div>
        )}

        {/* First-load error (no stale data to show) */}
        {!loading && error && !data && (
          <div className="flex flex-col items-center gap-4 py-10">
            <WarningCircle size={32} className="text-gray-300" />
            <div className="text-center">
              <p className="text-sm font-semibold text-[#1A1A1A]">Couldn't load leaderboard</p>
              <p className="text-[11px] text-[#717171] font-poppins mt-1">Check your connection and try again</p>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-2xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-[#1A1A1A] active:scale-95 transition-transform"
            >
              Try again
            </button>
          </div>
        )}

        {/* Refresh error banner — shown on top of stale data */}
        {error && data && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
            <WarningCircle size={14} className="text-amber-600 flex-shrink-0" />
            <p className="flex-1 text-xs text-amber-700 font-poppins">Couldn't refresh</p>
            <button
              type="button"
              onClick={onRetry}
              className="text-xs font-bold text-amber-700 underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && data && data.entries.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-10">
            <Trophy size={40} className="text-gray-200" />
            <div className="text-center">
              <p className="text-sm font-semibold text-[#1A1A1A]">No Reward Duel records yet</p>
              <p className="text-[11px] text-[#717171] font-poppins mt-1">Be the first to climb the ranks</p>
            </div>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={onSelectRewardDuel}
              className="rounded-2xl bg-[#238D9D] px-6 py-3 text-sm font-bold text-white"
            >
              Play Reward Duel
            </motion.button>
          </div>
        )}

        {/* Leaderboard entries */}
        {data && data.entries.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {data.entries.map((entry) => {
              const isMe = entry.walletAddress === myAddr;
              return (
                <div
                  key={entry.walletAddress}
                  className={[
                    "flex items-center gap-3 rounded-xl px-3 py-2.5",
                    isMe ? "bg-[#E8F7F9] border border-[#238D9D]/20" : "bg-gray-50",
                  ].join(" ")}
                >
                  <span className={[
                    "w-7 flex-shrink-0 text-center font-extrabold leading-none",
                    entry.rank <= 3 ? "text-sm" : "text-xs text-[#A0A0A0]",
                  ].join(" ")}>
                    {MEDAL[entry.rank] ?? `#${entry.rank}`}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate text-[#1A1A1A]">
                      {entry.username ?? shorten(entry.walletAddress)}
                      {isMe && (
                        <span className="ml-1.5 rounded-full bg-[#238D9D]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#238D9D]">
                          you
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-xs font-bold text-[#1A1A1A] tabular-nums">
                    {entry.record}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* "Your record" row — only when connected wallet is outside the top 10 */}
        {outsideTop10 && data?.me && (
          <>
            <div className="my-3 border-t border-dashed border-gray-200" />
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-[#A0A0A0]">Your record</p>
            <div className="flex items-center gap-3 rounded-xl bg-[#E8F7F9] border border-[#238D9D]/20 px-3 py-2.5">
              <span className="w-7 flex-shrink-0 text-center text-xs font-bold text-[#238D9D]">
                #{data.me.rank}
              </span>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-semibold text-[#1A1A1A]">
                  {data.me.username ?? shorten(data.me.walletAddress)}
                  <span className="ml-1.5 rounded-full bg-[#238D9D]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#238D9D]">
                    you
                  </span>
                </p>
              </div>
              <span className="flex-shrink-0 text-xs font-bold text-[#1A1A1A] tabular-nums">
                {data.me.record}
              </span>
            </div>
          </>
        )}
      </motion.div>
    </>
  );
}

// ─── Mode Select ──────────────────────────────────────────────────────────────

function ModeSelect({ balances, selectedMode, onSelectMode, onFindLobby, onChallengeFriend, address, onBalanceRefresh, leaderboardTick }: {
  balances: BalancesResponse | null; selectedMode: FarkleMode;
  onSelectMode: (m: FarkleMode) => void; onFindLobby: () => void; onChallengeFriend: () => void;
  address: string | null; onBalanceRefresh: () => void;
  leaderboardTick: number;
}) {
  const { buyPack,       buying: buyingTickets, buyError: ticketError }       = useFarkleTickets(address);
  const { buyCreditPack, buying: buyingCredits, buyError: creditError, step } = useFarkleCredits(address);
  const { claimable, claimEnabled, claiming, claimError, claim } = useFarkleClaim(address);
  const [showRules,        setShowRules]        = useState(false);
  const [showGameNights,   setShowGameNights]   = useState(false);
  const [showLeaderboard,  setShowLeaderboard]  = useState(false);
  const [justBought,       setJustBought]       = useState(false);
  const [lbData,           setLbData]           = useState<LeaderboardData | null>(null);
  const [lbLoading,        setLbLoading]        = useState(false);
  const [lbError,          setLbError]          = useState<string | null>(null);
  const lbFetchingRef                           = useRef(false);

  const claimableUsd = Number(claimable) / 1e6; // 6-dp USDT base units → dollars

  const fetchLeaderboard = useCallback(async () => {
    if (lbFetchingRef.current) return;
    lbFetchingRef.current = true;
    setLbLoading(true);
    setLbError(null);
    const params = new URLSearchParams({ modeKey: REWARD_DUEL_MODE, limit: "10" });
    if (address) params.set("address", address.toLowerCase());
    try {
      const r = await fetch(`/api/games/farkle/leaderboard?${params.toString()}`);
      if (!r.ok) throw new Error(String(r.status));
      setLbData((await r.json()) as LeaderboardData);
    } catch {
      setLbError("Couldn't load leaderboard");
    } finally {
      lbFetchingRef.current = false;
      setLbLoading(false);
    }
  }, [address]);

  // Fetch fresh data each time the sheet opens
  useEffect(() => {
    if (showLeaderboard) void fetchLeaderboard();
  }, [showLeaderboard, fetchLeaderboard]);

  // Pre-fetch when the parent signals a result was just shown (background refresh)
  useEffect(() => {
    if (leaderboardTick > 0) void fetchLeaderboard();
  }, [leaderboardTick, fetchLeaderboard]);

  async function handleClaim() {
    if (claiming) return;
    const ok = await claim();
    if (ok) {
      onBalanceRefresh();
      celebrate();
    }
  }

  const isCreditMode = isCreditFarkleMode(selectedMode);
  const isProMode = selectedMode === PRO_DUEL_MODE;
  const requiredCredits = creditEntryAmount(selectedMode);
  const tickets  = balances?.akibaTickets ?? 0;
  const credits  = balances?.gameCredits ?? 0;

  function celebrate() {
    import("canvas-confetti").then(({ default: confetti }) => {
      confetti({ particleCount: 70, spread: 65, origin: { y: 0.4 }, colors: ["#238D9D", "#fbbf24", "#34d399"] });
    }).catch(() => {});
  }

  async function runBuy(fn: () => Promise<boolean>, busy: boolean) {
    if (busy) return;
    const ok = await fn();
    if (ok) {
      onBalanceRefresh();
      setJustBought(true);
      setTimeout(() => setJustBought(false), 2200);
      celebrate();
    }
  }
  const handleBuy        = () => runBuy(buyPack, buyingTickets);
  const handleBuyCredits = () => runBuy(() => buyCreditPack(creditPackIdForMode(selectedMode)), buyingCredits);

  // Everything the hero + CTA need, derived from the selected mode's currency
  const need = isCreditMode
    ? {
        balance:  credits,
        unit:     "credit",
        empty:    balances !== null && credits < requiredCredits,
        buy:      handleBuyCredits,
        busy:     buyingCredits,
        error:    creditError,
        busyLabel: step === "approving" ? "Approving…" : step === "syncing" ? "Confirming…" : "Buying…",
        costNode: isProMode ? <>+10 · $1.00</> : <>+5 · $0.50</>,
        perMatch: isProMode ? "10 credits per match" : "1 credit per match",
        emptyHint: isProMode ? "Buy 10 credits with USDT to enter Pro Duel" : "Buy credits with USDT to enter",
        addedMsg:  isProMode ? "✓ Added 10 credits!" : "✓ Added 5 credits!",
        icon:      <TokenIcon token="usdt" size={26} className="drop-shadow-sm" />,
        heroBg:    "bg-gradient-to-br from-[#1A4A2A] to-[#2A7040] border border-white/10",
        accentBtn: "bg-white/15 text-white border border-white/20",
        ctaIcon:   <TokenIcon token="usdt" size={16} />,
        ctaLabel:  isProMode ? "Buy 10 credits to play" : "Buy credits to play",
      }
    : {
        balance:  tickets,
        unit:     "ticket",
        empty:    balances !== null && tickets === 0,
        buy:      handleBuy,
        busy:     buyingTickets,
        error:    ticketError,
        busyLabel: "Buying…",
        costNode: <>+5 · <MilesAmount value={25} size={11} variant="alt" /></>,
        perMatch: "1 ticket per match",
        emptyHint: "Buy a pack to start dueling",
        addedMsg:  "✓ Added 5 tickets!",
        icon:      <TokenIcon token="miles" size={26} className="drop-shadow-sm" />,
        heroBg:    "bg-gradient-to-br from-[#0A6B7A] to-[#127C8C] border border-white/10",
        accentBtn: "bg-white/15 text-white border border-white/20",
        ctaIcon:   <TokenIcon token="miles" size={16} />,
        ctaLabel:  "Buy tickets to play",
      };

  const modes: {
    key: FarkleMode;
    tabLabel: string;
    tabMeta: string;
    label: string;
    target: string;
    entry: string;
    reward: ReactNode;
    token: "miles" | "usdt";
    panelClass: string;
    badgeClass: string;
    badgeText: string;
  }[] = [
    {
      key:        QUICK_DUEL_MODE,
      tabLabel:   "Quick",
      tabMeta:    "Miles",
      label:      "Quick Duel",
      target:     "1,500 pts",
      entry:      "1 ticket",
      reward:     <span className="inline-flex items-center gap-1">10 <MilesAmount value={10} size={11} variant="alt" /></span>,
      token:      "miles",
      panelClass: "bg-[#E8F7F9] border-[#238D9D]/20",
      badgeClass: "bg-[#238D9D]/10 text-[#238D9D]",
      badgeText:  "Fastest",
    },
    {
      key:        REWARD_DUEL_MODE,
      tabLabel:   "Reward",
      tabMeta:    "$0.15",
      label:      "Reward Duel",
      target:     "2,500 pts",
      entry:      "1 credit",
      reward:     <span>$0.15 USDT</span>,
      token:      "usdt",
      panelClass: "bg-[#EEF8EF] border-[#2A7040]/20",
      badgeClass: "bg-[#2A7040]/10 text-[#2A7040]",
      badgeText:  "USDT",
    },
    {
      key:        PRO_DUEL_MODE,
      tabLabel:   "Pro",
      tabMeta:    "$1.85",
      label:      "Pro Duel",
      target:     "5,000 pts",
      entry:      "10 credits",
      reward:     <span>$1.85 USDT</span>,
      token:      "usdt",
      panelClass: "bg-[#FFF7E6] border-amber-300",
      badgeClass: "bg-amber-400/25 text-amber-800",
      badgeText:  "Higher stakes",
    },
  ];
  const selectedModeConfig = modes.find((m) => m.key === selectedMode) ?? modes[0];

  return (
    <>
    <AnimatePresence>
      {showRules && <HowToPlaySheet onClose={() => setShowRules(false)} />}
    </AnimatePresence>
    <AnimatePresence>
      {showGameNights && (
        <GameNightsSheet
          onClose={() => setShowGameNights(false)}
          onSelectRewardDuel={() => {
            onSelectMode(REWARD_DUEL_MODE);
            setShowGameNights(false);
          }}
        />
      )}
    </AnimatePresence>
    <AnimatePresence>
      {showLeaderboard && (
        <RewardDuelLeaderboardSheet
          address={address}
          onClose={() => setShowLeaderboard(false)}
          onSelectRewardDuel={() => {
            onSelectMode(REWARD_DUEL_MODE);
            setShowLeaderboard(false);
          }}
          data={lbData}
          loading={lbLoading}
          error={lbError}
          onRetry={fetchLeaderboard}
        />
      )}
    </AnimatePresence>

    <div className="px-4 mt-2 flex flex-col" style={{ minHeight: "calc(100dvh - 190px)" }}>
      {/* ── Currency hero (adapts to selected mode) ─────────────── */}
      <motion.div
        animate={justBought ? { scale: [1, 1.03, 1] } : {}}
        transition={{ duration: 0.5 }}
        className={[
          "relative overflow-hidden rounded-2xl px-4 py-3.5 mb-3 flex items-center gap-3 transition-colors",
          need.empty
            ? "bg-gradient-to-br from-[#FFF3D6] to-[#FFE7A8] border border-amber-300"
            : need.heroBg,
        ].join(" ")}
      >
        <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${need.empty ? "bg-amber-400/40" : "bg-white/15"}`}>
          {need.empty
            ? (isCreditMode
                ? <TokenIcon token="usdt" size={26} />
                : <TokenIcon token="miles" size={26} />)
            : need.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <motion.span
              key={`${need.unit}-${need.balance}`}
              initial={{ scale: 1.3, opacity: 0.5 }} animate={{ scale: 1, opacity: 1 }}
              className={`text-2xl font-black leading-none ${need.empty ? "text-amber-900" : "text-white"}`}
            >
              {need.balance}
            </motion.span>
            <span className={`text-xs font-semibold ${need.empty ? "text-amber-800" : "text-white/80"}`}>
              {need.unit}{need.balance === 1 ? "" : "s"}
            </span>
          </div>
          <p className={`text-[11px] font-poppins mt-0.5 ${need.empty ? "text-amber-700" : "text-white/60"}`}>
            {justBought ? need.addedMsg : need.empty ? need.emptyHint : need.perMatch}
          </p>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={need.buy}
          disabled={need.busy || !address}
          className={[
            "flex-shrink-0 rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-center gap-1.5 disabled:opacity-60 transition-colors",
            need.empty ? "bg-amber-500 text-white" : need.accentBtn,
          ].join(" ")}
        >
          {need.busy ? (
            <><SpinnerGap size={14} className="animate-spin" /> {need.busyLabel}</>
          ) : (
            need.costNode
          )}
        </motion.button>
      </motion.div>

      {need.error && (
        <p className="text-[11px] text-red-600 font-poppins mb-2 px-1 flex items-center gap-1">
          <WarningCircle size={12} /> {need.error}
        </p>
      )}

      {/* ── Mode picker: compact tabs + selected-mode summary ─────── */}
      <p className="text-[10px] font-extrabold text-[#A0A0A0] uppercase tracking-widest mb-2 px-0.5">Choose a table</p>
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white border border-gray-100 p-1 mb-2.5 shadow-sm">
        {modes.map((m) => {
          const active = selectedMode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onSelectMode(m.key)}
              className={[
                "h-[74px] rounded-xl px-1.5 py-2 text-center transition-all",
                active ? "bg-[#1A1A1A] text-white shadow-sm" : "text-[#717171] active:bg-gray-50",
              ].join(" ")}
            >
              <span
                className={[
                  "mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-lg",
                  active ? "bg-white/15" : "bg-gray-50",
                ].join(" ")}
              >
                <TokenIcon token={m.token} size={17} />
              </span>
              <span className="block text-[11px] font-extrabold leading-tight">{m.tabLabel}</span>
              <span className={`block text-[9px] font-poppins leading-tight mt-0.5 ${active ? "text-white/55" : "text-[#A0A0A0]"}`}>
                {m.tabMeta}
              </span>
            </button>
          );
        })}
      </div>

      <div className={`rounded-2xl border px-4 py-3 mb-3 ${selectedModeConfig.panelClass}`}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
            <TokenIcon token={selectedModeConfig.token} size={23} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-[#1A1A1A] leading-tight">{selectedModeConfig.label}</p>
            <p className="text-[11px] text-[#717171] font-poppins mt-0.5">Real-player PvP duel</p>
          </div>
          <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold ${selectedModeConfig.badgeClass}`}>
            {selectedModeConfig.badgeText}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="rounded-xl bg-white/70 px-2.5 py-2">
            <p className="text-[9px] font-extrabold uppercase text-[#A0A0A0]">Goal</p>
            <p className="text-[11px] font-bold text-[#1A1A1A] leading-tight mt-0.5">{selectedModeConfig.target}</p>
          </div>
          <div className="rounded-xl bg-white/70 px-2.5 py-2">
            <p className="text-[9px] font-extrabold uppercase text-[#A0A0A0]">Entry</p>
            <p className="text-[11px] font-bold text-[#1A1A1A] leading-tight mt-0.5">{selectedModeConfig.entry}</p>
          </div>
          <div className="rounded-xl bg-white/70 px-2.5 py-2">
            <p className="text-[9px] font-extrabold uppercase text-[#A0A0A0]">Win</p>
            <p className="text-[11px] font-bold text-[#1A1A1A] leading-tight mt-0.5">{selectedModeConfig.reward}</p>
          </div>
        </div>
      </div>

      {/* secondary balances — the other currency + on-chain claimable winnings */}
      {balances && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 px-0.5 text-[11px] font-poppins text-[#717171]">
          {isCreditMode
            ? <span className="flex items-center gap-1"><TokenIcon token="miles" size={12} /> {tickets} tickets</span>
            : <span className="flex items-center gap-1"><TokenIcon token="usdt" size={12} /> {credits} credits</span>}
          <span className="flex items-center gap-1"><Trophy size={12} weight="fill" className="text-amber-500" /> ${claimableUsd.toFixed(2)} winnings</span>
        </div>
      )}

      {/* Claimable USDT winnings (on-chain balance is source of truth) */}
      {claimable > 0n && (
        <div className="rounded-2xl bg-gradient-to-br from-[#1A4A2A] to-[#2A7040] border border-white/10 px-4 py-3 mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/15">
            <Trophy size={20} weight="fill" className="text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-black text-white leading-none">${claimableUsd.toFixed(2)}</p>
            <p className="text-[11px] text-white/60 font-poppins mt-0.5">
              {claimEnabled ? "USDT winnings ready to claim" : "USDT winnings · claims open soon"}
            </p>
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={handleClaim}
            disabled={!claimEnabled || claiming || !address}
            className="flex-shrink-0 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-[#1A1A1A] disabled:opacity-50 flex items-center gap-1.5"
          >
            {claiming ? <><SpinnerGap size={14} className="animate-spin" /> Claiming…</>
                      : claimEnabled ? "Claim USDT" : "Locked"}
          </motion.button>
        </div>
      )}
      {claimError && (
        <p className="text-[11px] text-red-600 font-poppins mb-2 px-1 flex items-center gap-1">
          <WarningCircle size={12} /> {claimError}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          type="button"
          onClick={() => setShowLeaderboard(true)}
          className="rounded-2xl bg-white border border-gray-100 px-3 py-3 text-left shadow-sm active:scale-[0.99] transition-transform"
        >
          <Trophy size={18} weight="fill" className="text-amber-500 mb-2" />
          <p className="text-xs font-extrabold text-[#1A1A1A] leading-tight">Leaderboard</p>
          <p className="text-[10px] text-[#A0A0A0] font-poppins mt-0.5">Reward Duel records</p>
        </button>
        <button
          type="button"
          onClick={() => setShowGameNights(true)}
          className="rounded-2xl bg-[#F4F0FF] border border-[#D8CCFF] px-3 py-3 text-left shadow-sm active:scale-[0.99] transition-transform"
        >
          <Trophy size={18} weight="fill" className="text-[#6D5BD0] mb-2" />
          <p className="text-xs font-extrabold text-[#1A1A1A] leading-tight">Game Nights</p>
          <p className="text-[10px] text-[#6D5BD0]/75 font-poppins mt-0.5">Coming soon · ${GN_WINNER_PRIZE_USD + GN_RUNNER_UP_PRIZE_USD} weekly</p>
        </button>
      </div>

      {/* ── Spacer pushes actions to the bottom (no-scroll layout) ── */}
      <div className="flex-1 min-h-2" />

      {/* How to Play */}
      <button
        type="button"
        onClick={() => setShowRules(true)}
        className="w-full mb-2.5 flex items-center justify-center gap-2 rounded-2xl bg-white border border-gray-200 py-3 text-sm font-semibold text-[#238D9D] shadow-sm active:scale-[0.98] transition-transform"
      >
        <Info size={16} />
        How to Play
      </button>

      {!address && <p className="text-xs text-[#717171] font-poppins text-center mb-2">Connect wallet to play</p>}

      {/* Play actions — turns into a Buy prompt when the mode's currency is empty */}
      {need.empty ? (
        <motion.button
          type="button"
          onClick={need.buy}
          disabled={need.busy || !address}
          whileTap={{ scale: 0.97 }}
          className="w-full rounded-2xl bg-amber-500 py-4 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {need.busy ? <><SpinnerGap size={16} className="animate-spin" /> {need.busyLabel}</>
                     : <>{need.ctaIcon} {need.ctaLabel}</>}
        </motion.button>
      ) : (
        <div className="space-y-2">
          <motion.button
            type="button"
            onClick={onChallengeFriend}
            disabled={!address}
            whileTap={{ scale: 0.97 }}
            className="w-full rounded-2xl border-2 border-[#238D9D] bg-white py-3.5 text-sm font-bold text-[#238D9D] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Sword size={16} weight="fill" />
            Challenge Friend
          </motion.button>
          <motion.button
            type="button"
            onClick={onFindLobby}
            disabled={!address}
            whileTap={{ scale: 0.97 }}
            className="w-full rounded-2xl bg-[#238D9D] py-4 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Sword size={16} weight="fill" />
            Find Lobby Match
          </motion.button>
        </div>
      )}
    </div>
    </>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

type WaitingPlayer = { address: string; username: string | null; queuedAt: string };

function Matchmaking({ mode, queueType, initialInviteCode, myAddress, onMatchStart, onCancel }: {
  mode: FarkleMode;
  queueType: QueueType;
  initialInviteCode: string | null;
  myAddress: string;
  onMatchStart: (matchId: string, mode: FarkleMode) => void;
  onCancel: () => void;
}) {
  const [waiters,        setWaiters]        = useState<WaitingPlayer[]>([]);
  const [challenging,    setChallenging]    = useState<string | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [dots,           setDots]           = useState(".");
  const [myInviteCode,   setMyInviteCode]   = useState<string | null>(initialInviteCode);
  const [codeCopied,     setCodeCopied]     = useState(false);
  const [codeInput,      setCodeInput]      = useState("");
  const [codeError,      setCodeError]      = useState<string | null>(null);
  const [joiningCode,    setJoiningCode]    = useState(false);
  const [pollError,      setPollError]      = useState(false);
  const pollFailCount = useRef(0);
  const matchedRef    = useRef(false);
  const isInviteOnly = queueType === "invite";

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
    if (initialInviteCode) setMyInviteCode(initialInviteCode);
  }, [initialInviteCode]);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`/api/games/farkle/matches/queue?modeKey=${mode}&address=${myAddress}`);
        if (!r.ok) {
          pollFailCount.current += 1;
          if (pollFailCount.current >= 3) setPollError(true);
          return;
        }
        pollFailCount.current = 0;
        setPollError(false);
        const data = await r.json();
        setWaiters(isInviteOnly ? [] : data.waiters ?? []);
        if (data.myInviteCode) setMyInviteCode(data.myInviteCode);
        if (data.matchId && !matchedRef.current) {
          matchedRef.current = true;
          onMatchStart(data.matchId, mode);
        }
      } catch {
        pollFailCount.current += 1;
        if (pollFailCount.current >= 3) setPollError(true);
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [isInviteOnly, mode, myAddress, onMatchStart]);

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

  async function challengePlayer(addr: string) {
    if (challenging) return;
    setChallenging(addr);
    setChallengeError(null);
    try {
      const r = await fetch("/api/games/farkle/matches/find", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modeKey: mode, targetAddress: addr }),
      });
      const data = await r.json();
      if (!r.ok) {
        setChallengeError(data.error ?? "Challenge failed — try again");
        return;
      }
      if (data.matchId) {
        matchedRef.current = true;
        onMatchStart(data.matchId, (data.modeKey ?? mode) as FarkleMode);
      }
    } catch {
      setChallengeError("Network error — please try again");
    } finally {
      setChallenging(null);
    }
  }

  async function joinWithCode() {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setCodeError(null);
    setJoiningCode(true);
    try {
      const r = await fetch("/api/games/farkle/matches/find", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modeKey: mode, inviteCode: code }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.error === "invite_not_found" || data.error === "code_expired") {
          setCodeError("Code not found or expired — ask your friend for a fresh one.");
        } else if (data.error === "mode_mismatch") {
          setCodeError("That code is for a different game mode.");
        } else {
          setCodeError(data.message ?? data.error ?? "Failed to join — try again.");
        }
        return;
      }
      if (data.matchId) {
        matchedRef.current = true;
        onMatchStart(data.matchId, (data.modeKey ?? mode) as FarkleMode);
      }
    } catch {
      setCodeError("Network error — please try again.");
    } finally {
      setJoiningCode(false);
    }
  }

  function copyCode() {
    if (!myInviteCode) return;
    navigator.clipboard.writeText(myInviteCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }).catch(() => {});
  }

  const modeLabel = modeDisplayLabel(mode);
  const isTransitioning = joiningCode || !!challenging;

  return (
    <div className="px-4 mt-5">

      {/* ── Status banner ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 rounded-2xl bg-[#E8F7F9] border border-[#238D9D]/20 px-4 py-3 mb-4">
        {isTransitioning ? (
          <SpinnerGap size={18} className="text-[#238D9D] animate-spin flex-shrink-0" />
        ) : (
          <motion.div
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ repeat: Infinity, duration: 1.2 }}
            className="h-2 w-2 rounded-full bg-[#238D9D] flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#238D9D]">
            {joiningCode
              ? "Joining with code…"
              : challenging
              ? "Challenging player…"
              : isInviteOnly
              ? `Waiting for friend${dots}`
              : `Searching lobby${dots}`}
          </p>
          <p className="text-xs text-[#238D9D]/70 font-poppins mt-0.5">
            {modeLabel} · {isInviteOnly ? "Private invite" : "Public lobby"}
          </p>
        </div>
      </div>

      {/* ── Poll error ─────────────────────────────────────────────────── */}
      {pollError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
          <WarningCircle size={14} className="text-amber-600 flex-shrink-0" />
          <p className="text-[11px] text-amber-700 font-poppins">
            Trouble reaching the server — still retrying…
          </p>
        </div>
      )}

      {/* ── Private invite code ─────────────────────────────────────────── */}
      {isInviteOnly && (
        myInviteCode ? (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-white border border-[#238D9D]/20 shadow-sm px-4 py-3 mb-4">
            <p className="text-[10px] font-extrabold text-[#A0A0A0] uppercase tracking-widest mb-1.5">
              Friend invite code
            </p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-2xl font-extrabold tracking-[0.2em] text-[#1A1A1A] font-mono leading-none">
                {myInviteCode}
              </p>
              <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={copyCode}
                className={[
                  "rounded-xl px-3 py-2 text-xs font-bold transition-colors flex-shrink-0",
                  codeCopied
                    ? "bg-green-50 border border-green-200 text-green-700"
                    : "bg-[#E8F7F9] border border-[#238D9D]/20 text-[#238D9D]",
                ].join(" ")}>
                {codeCopied ? "✓ Copied" : "Copy"}
              </motion.button>
            </div>
            <p className="text-[11px] text-[#A0A0A0] font-poppins mt-1.5">
              This code is private. You will not be matched with lobby players while waiting here.
            </p>
          </motion.div>
        ) : (
          <div className="rounded-2xl bg-gray-50 border border-gray-100 px-4 py-3 mb-4 animate-pulse">
            <div className="h-2.5 w-24 bg-gray-200 rounded mb-2.5" />
            <div className="h-7 w-36 bg-gray-200 rounded" />
          </div>
        )
      )}

      {/* ── Challenge error ────────────────────────────────────────────── */}
      {challengeError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2">
          <WarningCircle size={14} className="text-red-500 flex-shrink-0" />
          <p className="text-[11px] text-red-700 font-poppins">{challengeError}</p>
        </div>
      )}

      {/* ── Waiters list ───────────────────────────────────────────────── */}
      {!isInviteOnly && (
        <>
          <p className="text-[11px] font-extrabold text-[#A0A0A0] uppercase tracking-widest mb-2">
            {waiters.length === 0
              ? "Players in lobby"
              : `${waiters.length} player${waiters.length !== 1 ? "s" : ""} waiting`}
          </p>

          <AnimatePresence>
            {waiters.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-6 flex flex-col items-center gap-2 mb-4">
                <Sword size={24} className="text-gray-300" />
                <p className="text-sm text-[#A0A0A0] font-poppins text-center">No one else here yet</p>
                <p className="text-xs text-[#C0C0C0] font-poppins text-center">
                  Stay here to match the next public player
                </p>
              </motion.div>
            ) : (
              <div className="space-y-2 mb-4">
                {waiters.map((w) => (
                  <motion.div key={w.address}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 rounded-2xl bg-white border border-gray-100 shadow-sm px-4 py-3">
                    <div className="h-9 w-9 rounded-full bg-[#E8F7F9] flex items-center justify-center flex-shrink-0">
                      <Sword size={16} weight="fill" className="text-[#238D9D]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{w.username ?? shorten(w.address)}</p>
                      {w.username && (
                        <p className="text-[11px] text-[#A0A0A0] font-poppins">{shorten(w.address)}</p>
                      )}
                    </div>
                    <motion.button type="button" whileTap={{ scale: 0.94 }}
                      onClick={() => void challengePlayer(w.address)}
                      disabled={challenging !== null}
                      className="flex-shrink-0 rounded-xl bg-[#238D9D] px-4 py-2 text-xs font-bold text-white disabled:opacity-50 flex items-center justify-center min-w-[76px]">
                      {challenging === w.address
                        ? <SpinnerGap size={14} className="animate-spin" />
                        : "Challenge"}
                    </motion.button>
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* ── Join a friend's game ───────────────────────────────────────── */}
      <div className="rounded-2xl bg-white border border-gray-100 px-4 py-3.5 mb-3">
        <p className="text-xs font-bold text-[#1A1A1A] mb-0.5">Join a friend&apos;s game</p>
        <p className="text-[11px] text-[#A0A0A0] font-poppins mb-2.5">
          Enter their invite code to match directly.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={codeInput}
            onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setCodeError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void joinWithCode(); }}
            placeholder="FARK-XXXX"
            maxLength={9}
            className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-mono font-semibold tracking-widest uppercase placeholder:text-gray-300 focus:outline-none focus:border-[#238D9D] focus:bg-white transition-colors"
          />
          <motion.button type="button" whileTap={{ scale: 0.94 }}
            onClick={() => void joinWithCode()}
            disabled={joiningCode || codeInput.trim().length < 4}
            className="rounded-xl bg-[#238D9D] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center min-w-[56px]">
            {joiningCode ? <SpinnerGap size={16} className="animate-spin" /> : "Join"}
          </motion.button>
        </div>
        {codeError && (
          <p className="mt-1.5 text-xs text-red-500 font-poppins flex items-center gap-1">
            <WarningCircle size={12} className="flex-shrink-0" /> {codeError}
          </p>
        )}
      </div>

      <button type="button" onClick={() => void leaveLobby()}
        className="w-full rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-[#717171] active:bg-gray-50 transition-colors">
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

// ─── Reactions (tap-to-send emotes, v1) ──────────────────────────────────────

type ReactionKey = "fire" | "cry" | "laugh" | "tongue" | "angry_censored";

const REACTION_GLYPH: Record<ReactionKey, string> = {
  fire:           "🔥",
  cry:            "😢",
  laugh:          "🤣",
  tongue:         "🤪",
  angry_censored: "🤬",
};

function ReactionGlyph({ emoji }: { emoji: string }) {
  return <>{REACTION_GLYPH[emoji as ReactionKey] ?? "🔥"}</>;
}

const REACTIONS: {
  key: ReactionKey;
  suggested?: (roll: RollState | null, isMyTurn: boolean) => boolean;
}[] = [
  { key: "fire",           suggested: (roll) => Boolean(roll?.isHotDice) },
  { key: "cry" },
  { key: "laugh", suggested: (roll, isMyTurn) => !isMyTurn && Boolean(roll?.isFarkle) },
  { key: "tongue" },
  { key: "angry_censored", suggested: (roll, isMyTurn) => isMyTurn && Boolean(roll?.isFarkle) },
];

function GameBoard({ matchId, myAddress, mode, waitForAuth, onMatchEnd }: {
  matchId:    string;
  myAddress:  string;
  mode:       FarkleMode;
  waitForAuth?: (timeoutMs?: number) => Promise<void>;
  onMatchEnd: (r: FarkleResult) => void;
}) {
  const [myScore,    setMyScore]    = useState(0);
  const [oppScore,   setOppScore]   = useState(0);
  const [myScoreLabel, setMyScoreLabel] = useState(() => myAddress.slice(0, 6) + "…" + myAddress.slice(-4));
  const [oppScoreLabel, setOppScoreLabel] = useState("Opponent");
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
  const [showRules,     setShowRules]     = useState(false);

  // Reactions (tap-to-send emotes)
  const [incomingReaction, setIncomingReaction] = useState<{ emoji: string; key: number } | null>(null);
  const [reactionCooldown, setReactionCooldown] = useState(false);
  const lastReactionIdRef = useRef<string | null>(null);
  const incomingReactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const failuresRef = useRef(0);
  const busyRef    = useRef(false);
  const sseConnectedRef = useRef(false);
  const phaseRef   = useRef(phase);
  phaseRef.current = phase;

  // Spectating: track the opponent's last-seen board so we only animate on change
  const prevMyTurnRef   = useRef(false);
  const spectateSigRef  = useRef("");
  const spectateDiceRef = useRef<number[] | null>(null);
  const specRollTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const specFarkleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const TURN_TIMEOUT = 60;
  const shorten = useCallback((a: string) => a.slice(0, 6) + "…" + a.slice(-4), []);

  const applyState = useCallback((s: TurnState) => {
    failuresRef.current = 0;
    setConnection("live");

    setMyScore(s.yourScore ?? 0);
    setOppScore(s.opponentScore ?? 0);
    setMyScoreLabel(s.yourUsername || shorten(s.yourUserId || myAddress));
    setOppScoreLabel(s.opponentUsername || (s.opponentUserId ? shorten(s.opponentUserId) : "Opponent"));
    setTargetScore(s.targetScore ?? 1500);
    setMatchStatus(s.matchStatus);
    setTurnStartedAt(s.turnStartedAt ? new Date(s.turnStartedAt).getTime() : null);

    const nowMyTurn = s.isYourTurn;
    setIsMyTurn(nowMyTurn);

    if (s.lastReaction && s.lastReaction.id !== lastReactionIdRef.current) {
      lastReactionIdRef.current = s.lastReaction.id;
      if (s.lastReaction.fromUserId !== myAddress) {
        setIncomingReaction({ emoji: s.lastReaction.emoji, key: Date.now() });
        if (incomingReactionTimer.current) clearTimeout(incomingReactionTimer.current);
        incomingReactionTimer.current = setTimeout(() => setIncomingReaction(null), 2200);
      }
    }

    if (s.matchStatus === "cancelled") {
      onMatchEnd({
        matchId: s.matchId,
        winnerId: "",
        yourScore: s.yourScore,
        oppScore: s.opponentScore,
        voided: true,
        message: "Match voided. Entry refunded.",
      });
      return;
    }

    if (["completed", "settled"].includes(s.matchStatus)) {
      onMatchEnd({
        matchId: s.matchId,
        winnerId: s.winnerUserId ?? "",
        yourScore: s.yourScore,
        oppScore: s.opponentScore,
        settlementStatus: s.matchStatus === "settled" ? "settled" : "pending",
      });
      return;
    }

    const justBecameMyTurn = nowMyTurn && !prevMyTurnRef.current;
    if (justBecameMyTurn) {
      if (specRollTimer.current) clearTimeout(specRollTimer.current);
      if (specFarkleTimer.current) clearTimeout(specFarkleTimer.current);
      spectateSigRef.current = "";
      spectateDiceRef.current = null;
      setFarkleAnim(false);
      if (phaseRef.current === "rolling") setPhase("idle");
    }
    prevMyTurnRef.current = nowMyTurn;

    if (nowMyTurn && (phaseRef.current === "idle" || justBecameMyTurn)) {
      setSelected([]);
      setMoveError(null);
      if (Array.isArray(s.currentRoll) && s.currentRoll.length === 6) {
        setRollState({
          dice: s.currentRoll,
          lockedIndices: s.lockedIndices ?? [],
          rolledIndices: s.rolledIndices ?? [],
          scoringHints: s.scoringHints ?? [],
          turnPoints: s.turnPoints ?? 0,
          isFarkle: Boolean(s.isFarkle),
          isHotDice: Boolean(s.isHotDice),
        });
        setPhase(s.isFarkle ? "farkle" : "selecting");
      } else {
        setRollState(null);
      }
    } else if (!nowMyTurn) {
      setSelected([]);
      if (Array.isArray(s.currentRoll) && s.currentRoll.length === 6) {
        const dice = s.currentRoll as number[];
        const locked = (s.lockedIndices ?? []) as number[];
        const sig = JSON.stringify([dice, locked, s.turnPoints, s.isFarkle, s.isHotDice]);

        if (sig !== spectateSigRef.current) {
          const prevDice = spectateDiceRef.current;
          const changed = (prevDice
            ? dice.map((v, i) => (v !== prevDice[i] && !locked.includes(i) ? i : -1))
            : dice.map((_, i) => (locked.includes(i) ? -1 : i))
          ).filter((i) => i >= 0);

          spectateSigRef.current = sig;
          spectateDiceRef.current = dice;

          setRollState({
            dice,
            lockedIndices: locked,
            rolledIndices: changed,
            scoringHints: [],
            turnPoints: s.turnPoints ?? 0,
            isFarkle: Boolean(s.isFarkle),
            isHotDice: Boolean(s.isHotDice),
          });

          if (changed.length > 0) {
            setPhase("rolling");
            if (specRollTimer.current) clearTimeout(specRollTimer.current);
            specRollTimer.current = setTimeout(() => setPhase("idle"), 1000);
          }
          if (s.isFarkle) {
            setFarkleAnim(true);
            if (specFarkleTimer.current) clearTimeout(specFarkleTimer.current);
            specFarkleTimer.current = setTimeout(() => setFarkleAnim(false), 1800);
          }
        }
      } else {
        spectateSigRef.current = "";
        spectateDiceRef.current = null;
        setRollState(null);
      }
    }
  }, [onMatchEnd, myAddress, shorten]);

  // ── Fetch fallback: only active while the SSE stream is disconnected ──────
  const poll = useCallback(async () => {
    if (busyRef.current) return;
    try {
      const r = await fetch(`/api/games/farkle/${matchId}/state?address=${myAddress}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      applyState(await r.json());
    } catch {
      failuresRef.current += 1;
      if (failuresRef.current >= 2) setConnection("reconnecting");
    }
  }, [applyState, matchId, myAddress]);

  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) return;

    let closed = false;
    const source = new EventSource(
      `/api/games/farkle/${matchId}/events?address=${encodeURIComponent(myAddress)}`,
    );

    source.onopen = () => {
      sseConnectedRef.current = true;
      failuresRef.current = 0;
      setConnection("live");
    };

    source.onmessage = (event) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload?.error) throw new Error(payload.error);
        sseConnectedRef.current = true;
        if (busyRef.current) return;
        applyState(payload as TurnState);
      } catch {
        sseConnectedRef.current = false;
        failuresRef.current += 1;
        if (failuresRef.current >= 2) setConnection("reconnecting");
      }
    };

    source.onerror = () => {
      sseConnectedRef.current = false;
      if (!closed && failuresRef.current >= 2) setConnection("reconnecting");
    };

    return () => {
      closed = true;
      sseConnectedRef.current = false;
      source.close();
    };
  }, [applyState, matchId, myAddress]);

  useEffect(() => {
    poll();
    pollRef.current = setInterval(() => {
      if (!sseConnectedRef.current) void poll();
    }, 2000);

    // Immediately refetch when the tab regains focus (mobile backgrounding)
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (specRollTimer.current) clearTimeout(specRollTimer.current);
      if (specFarkleTimer.current) clearTimeout(specFarkleTimer.current);
      if (incomingReactionTimer.current) clearTimeout(incomingReactionTimer.current);
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
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
      });
      const data = await r.json();
      if (r.ok && data.voided) {
        onMatchEnd({
          matchId,
          winnerId: "",
          yourScore: myScore,
          oppScore,
          voided: true,
          message: data.message ?? "Opponent not online. Entry refunded.",
        });
        return;
      }
      if (r.ok && data.winnerId) {
        onMatchEnd({
          matchId,
          winnerId: data.winnerId,
          yourScore: myScore,
          oppScore,
          settlementStatus: data.settlementStatus,
        });
      }
    } catch {}
    setClaiming(false);
  }

  async function sendReaction(emoji: "fire" | "cry" | "laugh" | "tongue" | "angry_censored") {
    if (reactionCooldown) return;
    setReactionCooldown(true);
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    reactionTimerRef.current = setTimeout(() => setReactionCooldown(false), 2000);
    try {
      await waitForAuth?.();
      const r = await fetch(`/api/games/farkle/${matchId}/react`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      // On auth or server error, release the cooldown immediately so the
      // player can retry. 429 (rate_limited) keeps the cooldown in place.
      if (!r.ok && r.status !== 429) {
        if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
        setReactionCooldown(false);
      }
    } catch {
      // Network error — release cooldown so the player can retry.
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
      setReactionCooldown(false);
    }
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
        matchId,
        winnerId: data.winnerId ?? "",
        yourScore: data.bankedScore ?? myScore,
        oppScore: data.opponentScore ?? oppScore,
        settlementStatus: data.settlementStatus,
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
    <>
    <AnimatePresence>
      {showRules && <HowToPlaySheet onClose={() => setShowRules(false)} />}
    </AnimatePresence>
    <div className="px-4 mt-3">
      {/* Scoreboard */}
      <div className="flex justify-end mb-1.5">
        <button
          type="button"
          onClick={() => setShowRules(true)}
          className="flex items-center gap-1 rounded-full bg-white border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-[#238D9D] shadow-sm active:scale-95 transition-transform"
        >
          <Info size={11} />
          How to Play
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { label: myScoreLabel,  score: myScore,  pct: (myScore  / targetScore) * 100, accent: "#238D9D" },
          { label: oppScoreLabel, score: oppScore, pct: (oppScore / targetScore) * 100, accent: "#A0A0A0" },
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
        <span className="flex items-center gap-1.5">
          {isMyTurn ? "⚡ Your turn"
            : rollState ? (<><span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />Watching opponent live</>)
            : "⏳ Opponent's turn…"}
        </span>
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

      {/* Opponent idle — resolve timeout */}
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
              {claiming ? "Resolving…" : "⏰ Opponent idle — Resolve match"}
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

      {/* Incoming opponent reaction */}
      <div className="relative h-0">
        <AnimatePresence>
          {incomingReaction && (
            <motion.div
              key={incomingReaction.key}
              initial={{ opacity: 0, y: 8, scale: 0.6 }}
              animate={{ opacity: 1, y: -18, scale: 1.3 }}
              exit={{ opacity: 0, y: -34, scale: 0.9 }}
              transition={{ duration: 0.5 }}
              className="absolute right-2 -top-2 z-20 text-4xl drop-shadow-md pointer-events-none"
            >
              <ReactionGlyph emoji={incomingReaction.emoji} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Reaction tray — tap to send, never auto-sent */}
      <div className="mb-2 flex items-center justify-center gap-1.5">
        {REACTIONS.map(({ key, suggested }) => (
          <button
            key={key}
            type="button"
            onClick={() => sendReaction(key)}
            disabled={reactionCooldown}
            aria-label={`Send ${key} reaction`}
            className={`h-9 w-9 flex items-center justify-center rounded-full bg-white border shadow-sm text-lg leading-none transition-all active:scale-90 disabled:opacity-40 ${
              suggested && suggested(rollState, isMyTurn)
                ? "border-[#238D9D] ring-2 ring-[#238D9D]/40 animate-pulse"
                : "border-gray-200"
            }`}
          >
            <ReactionGlyph emoji={key} />
          </button>
        ))}
      </div>

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

        {/* Live spectating badge */}
        {!isMyTurn && rollState && (
          <div className="absolute top-2.5 right-3 z-20 flex items-center gap-1 rounded-full bg-red-500/80 px-2 py-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-[9px] font-bold text-white tracking-wide">LIVE</span>
          </div>
        )}

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
    </>
  );
}

// ─── Result Screen ────────────────────────────────────────────────────────────

function ResultScreen({ result, myAddress, mode, onPlayAgain, onBackToFarkle }: {
  result: FarkleResult;
  myAddress: string; mode: FarkleMode;
  onPlayAgain: () => void; onBackToFarkle: () => void;
}) {
  const isVoided = Boolean(result.voided);
  const isWinner = !isVoided && result.winnerId.toLowerCase() === myAddress.toLowerCase();
  const isRewardWinner = isWinner && isCreditFarkleMode(mode);
  const [checking, setChecking] = useState(false);
  const [checkedStatus, setCheckedStatus] = useState<"settled" | "pending" | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [claimedAmountUsd, setClaimedAmountUsd] = useState<number | null>(null);
  const {
    claimable,
    claimEnabled,
    claiming,
    claimError,
    claimTxHash,
    syncFailed,
    retrying,
    retrySync,
    claim,
    refresh,
  } = useFarkleClaim(myAddress);

  const claimableUsd = Number(claimable) / 1e6;
  const hasClaimableUsdt = claimable > 0n;
  const showPending = isRewardWinner && !hasClaimableUsdt && !claimed && checkedStatus !== "settled";

  const checkRewardStatus = useCallback(async () => {
    if (checking || !result.matchId) return;
    setChecking(true);
    try {
      await refresh();
      const statusRes = await fetch(`/api/games/farkle/${result.matchId}/settlement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const statusData = await statusRes.json().catch(() => null);
      if (statusRes.ok && statusData) {
        setCheckedStatus(statusData.settlementStatus === "settled" ? "settled" : "pending");
      } else {
        setCheckedStatus("pending");
      }

      await refresh();
      const r = await fetch(`/api/games/farkle/balances?address=${encodeURIComponent(myAddress)}`);
      const data = r.ok ? await r.json().catch(() => null) : null;
      if ((data?.rewardCreditsCents ?? 0) > 0) setCheckedStatus("settled");
    } catch {
      setCheckedStatus("pending");
    } finally {
      setChecking(false);
    }
  }, [checking, myAddress, refresh, result.matchId]);

  useEffect(() => {
    if (!isRewardWinner) return;
    void refresh();
    const id = setInterval(() => void refresh(), claimable > 0n ? 10_000 : 3_000);
    return () => clearInterval(id);
  }, [claimable, isRewardWinner, refresh]);

  useEffect(() => {
    if (!isRewardWinner || hasClaimableUsdt || claimed) return;
    void checkRewardStatus();
    const id = setInterval(() => void checkRewardStatus(), 10_000);
    return () => clearInterval(id);
  }, [checkRewardStatus, claimed, hasClaimableUsdt, isRewardWinner]);

  async function handleClaimUsdt() {
    if (claiming) return;
    const snapshot = claimableUsd;
    const ok = await claim();
    if (ok) {
      setClaimedAmountUsd(snapshot);
      setClaimed(true);
      setCheckedStatus("settled");
      try { localStorage.removeItem("farkle:lastResult"); } catch {}
    }
  }

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
        {isVoided ? "↺" : isWinner ? "🏆" : "😤"}
      </motion.div>

      <div className="text-center">
        <h2 className="text-2xl font-bold">{isVoided ? "Match voided" : isWinner ? "You won!" : "You lost."}</h2>
        <p className="text-sm text-[#717171] font-poppins mt-1">
          {isVoided ? result.message ?? "Opponent not online. Entry refunded." : `${result.yourScore.toLocaleString()} — ${result.oppScore.toLocaleString()}`}
        </p>
      </div>

      {!isVoided && (
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm px-6 py-4 w-full space-y-2.5">
        {isRewardWinner && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#717171] font-poppins">Reward Credit</span>
            {showPending ? (
              <span className="text-sm font-semibold text-amber-500 flex items-center gap-1">
                <SpinnerGap size={13} className="animate-spin" /> Confirming…
              </span>
            ) : (
              <span className="text-sm font-bold text-green-600">
                +${(hasClaimableUsdt ? claimableUsd : claimedAmountUsd ?? 0).toFixed(2)}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#717171] font-poppins">AkibaMiles</span>
          <span className={`text-sm font-bold ${showPending ? "text-amber-500" : "text-[#238D9D]"}`}>
            {showPending ? (
              <span className="flex items-center gap-1"><SpinnerGap size={13} className="animate-spin" /> Confirming…</span>
            ) : (
              <span>+<MilesAmount value={isWinner ? 10 : 5} size={13} /></span>
            )}
          </span>
        </div>

        {showPending && (
          <div className="pt-1 border-t border-gray-100">
            <p className="text-[11px] text-[#A0A0A0] font-poppins">
              Reward is being confirmed on-chain. It will arrive shortly.
            </p>
            <button
              type="button"
              onClick={checkRewardStatus}
              disabled={checking}
              className="mt-2 text-[11px] font-semibold text-[#238D9D] disabled:opacity-50 flex items-center gap-1"
            >
              {checking ? <><SpinnerGap size={11} className="animate-spin" /> Checking…</> : "Check reward status"}
            </button>
          </div>
        )}
      </div>
      )}

      {isRewardWinner && (
        <div className="w-full rounded-2xl bg-gradient-to-br from-[#1A4A2A] to-[#2A7040] border border-white/10 px-4 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/15">
              <TokenIcon token="usdt" size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold text-white leading-tight">USDT reward</p>
              <p className="text-[11px] text-white/65 font-poppins mt-0.5">
                {claimed
                  ? "Withdrawal submitted"
                  : hasClaimableUsdt
                    ? claimEnabled
                      ? `${claimableUsd.toFixed(2)} USDT ready to claim`
                      : `${claimableUsd.toFixed(2)} USDT confirmed · claims open soon`
                    : checkedStatus === "settled"
                      ? "Reward settled · syncing claim balance"
                      : "Waiting for on-chain reward credit"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClaimUsdt}
              disabled={!hasClaimableUsdt || !claimEnabled || claiming || claimed}
              className="flex-shrink-0 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-[#1A1A1A] disabled:opacity-50 flex items-center gap-1.5"
            >
              {claiming ? <><SpinnerGap size={14} className="animate-spin" /> Claiming…</>
                        : claimed ? "Claimed"
                        : hasClaimableUsdt && claimEnabled ? "Claim USDT"
                        : "Pending"}
            </button>
          </div>

          {claimTxHash && (
            <p className="mt-2 text-[10px] text-white/50 font-poppins truncate">
              Claim tx: {claimTxHash}
            </p>
          )}

          {(claimError || syncFailed || (!hasClaimableUsdt && !claimed)) && (
            <div className="mt-3 border-t border-white/10 pt-3">
              {claimError && (
                <p className="text-[11px] text-red-100 font-poppins mb-2 flex items-center gap-1">
                  <WarningCircle size={12} /> {claimError}
                </p>
              )}
              {syncFailed && (
                <button
                  type="button"
                  onClick={() => void retrySync()}
                  disabled={retrying}
                  className="text-[11px] font-semibold text-amber-200 disabled:opacity-50 flex items-center gap-1"
                >
                  {retrying ? <><SpinnerGap size={11} className="animate-spin" /> Syncing…</> : "Recover claim sync"}
                </button>
              )}
              {!hasClaimableUsdt && !claimed && (
                <button
                  type="button"
                  onClick={checkRewardStatus}
                  disabled={checking}
                  className="text-[11px] font-semibold text-amber-200 disabled:opacity-50 flex items-center gap-1"
                >
                  {checking ? <><SpinnerGap size={11} className="animate-spin" /> Checking…</> : "Check USDT reward"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 w-full">
        <button type="button" onClick={onBackToFarkle}
          className="flex-1 rounded-2xl border border-gray-200 bg-white py-3.5 text-sm font-semibold text-[#717171]">
          Back to Farkle
        </button>
        <motion.button type="button" onClick={onPlayAgain} whileTap={{ scale: 0.97 }}
          className="flex-1 rounded-2xl bg-[#238D9D] py-3.5 text-sm font-bold text-white">
          Play Again
        </motion.button>
      </div>
    </motion.div>
  );
}
