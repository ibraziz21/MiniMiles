"use client";

import { useEffect, useRef, useState } from "react";
import { MachineState, RewardClass, REWARD_META } from "@/lib/clawTypes";

type Props = {
  machineState: MachineState;
  rewardClass: RewardClass;
  showConfetti?: boolean;
};

const BRAND_PRIMARY = "#238D9D";
const BRAND_SECONDARY = "#2BA9B8";
const BRAND_DEEP = "#176B76";
const BRAND_SOFT = "#ADF4FF";
const CABINET_DARK = "#072A30";
const CABINET_MID = "#0C434B";
const CABINET_PANEL = "#0A353C";
const LED_COLORS = ["#F59E0B", "#2BA9B8", "#238D9D", "#6ED6E3", "#176B76"];

const STATE_MSG: Record<MachineState, string> = {
  idle:     "Pick a tier and pull the claw!",
  starting: "Submitting transaction…",
  pending:  "Claw is moving… revealing prize",
  ready:    "Reward ready!",
  settling: "Lifting the prize…",
  settled:  "",
};

// ── Prize pile — seeded pseudo-random positions so they look tumbled in ──────
// Each item gets a fixed (x, y, rotate, size) derived from its index so the
// pile is stable across renders but looks natural, not grid-aligned.

type PrizeItem = {
  emoji: string;
  rc: RewardClass;
  // absolute % coords within the glass window
  x: number;   // left %
  y: number;   // top  % — all clustered toward bottom
  rotate: number; // deg
  scale: number;
  zIndex: number;
};

// Simple deterministic LCG so we get the same "random" layout every render
function lcg(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function buildPrizePile(): PrizeItem[] {
  const rng  = lcg(0xdeadbeef);
  const raw: { emoji: string; rc: RewardClass }[] = [
    // ~60 % coins / misses (common + lose = majority)
    { emoji: "🪙", rc: RewardClass.Common },
    { emoji: "🪙", rc: RewardClass.Common },
    { emoji: "🪙", rc: RewardClass.Common },
    { emoji: "🪙", rc: RewardClass.Common },
    { emoji: "🪙", rc: RewardClass.Common },
    { emoji: "🪙", rc: RewardClass.Common },
    { emoji: "🪙", rc: RewardClass.Common },
    { emoji: "💨", rc: RewardClass.Lose    },
    { emoji: "💨", rc: RewardClass.Lose    },
    { emoji: "💨", rc: RewardClass.Lose    },
    { emoji: "💨", rc: RewardClass.Lose    },
    // ~6 % vouchers
    { emoji: "🎟️", rc: RewardClass.Rare   },
    { emoji: "🎟️", rc: RewardClass.Rare   },
    // ~2 % epic USDT
    { emoji: "💎", rc: RewardClass.Epic    },
    { emoji: "💎", rc: RewardClass.Epic    },
    // ~0.2 % legendary — one visible as a tease
    { emoji: "⭐", rc: RewardClass.Legendary },
    // extra bulk to fill the pot
    { emoji: "🪙", rc: RewardClass.Common },
    { emoji: "💨", rc: RewardClass.Lose    },
    { emoji: "🪙", rc: RewardClass.Common },
    { emoji: "🎟️", rc: RewardClass.Rare   },
    { emoji: "🪙", rc: RewardClass.Common },
    { emoji: "💨", rc: RewardClass.Lose    },
  ];

  // The glass window is ~180 px tall; prizes pile into the bottom 38 %.
  // Items in the very bottom layer sit at y≈88-94 %, the layer above at 78-87 %,
  // and a sparse top scatter at 68-77 %. Each layer is slightly narrower (walls
  // of the container) to fake perspective.
  const layers = [
    { yMin: 88, yMax: 94, xMin: 6,  xMax: 88, count: 9,  scaleBase: 1.05 },
    { yMin: 78, yMax: 87, xMin: 10, xMax: 84, count: 8,  scaleBase: 0.95 },
    { yMin: 68, yMax: 77, xMin: 15, xMax: 78, count: 5,  scaleBase: 0.82 },
  ];

  const items: PrizeItem[] = [];
  let idx = 0;

  layers.forEach((layer, li) => {
    for (let i = 0; i < layer.count && idx < raw.length; i++, idx++) {
      const item = raw[idx];
      // Spread x uniformly across the layer band with small random nudge
      const slot = layer.xMin + ((i + 0.5) / layer.count) * (layer.xMax - layer.xMin);
      const nudgeX = (rng() - 0.5) * 14;
      const nudgeY = (rng() - 0.5) * 5;
      items.push({
        ...item,
        x:       Math.min(Math.max(slot + nudgeX, layer.xMin), layer.xMax),
        y:       layer.yMin + rng() * (layer.yMax - layer.yMin) + nudgeY,
        rotate:  (rng() - 0.5) * 52,   // –26°..+26°
        scale:   layer.scaleBase + (rng() - 0.5) * 0.18,
        zIndex:  li * 10 + i,
      });
    }
  });

  return items;
}

const PRIZE_POOL: PrizeItem[] = buildPrizePile();

// Color per reward class
const RC_COLOR: Record<RewardClass, string> = {
  [RewardClass.None]:      "#9CA3AF",
  [RewardClass.Lose]:      "#6B7280",
  [RewardClass.Common]:    BRAND_PRIMARY,
  [RewardClass.Rare]:      BRAND_SECONDARY,
  [RewardClass.Epic]:      "#59C7D4",
  [RewardClass.Legendary]: "#F59E0B",
};

function ConfettiPiece({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="absolute rounded-sm pointer-events-none"
      style={{ width: 7, height: 7, ...style }}
    />
  );
}

// ── Claw animation state machine ───────────────────────────────────────────
// Phase 0: idle at top
// Phase 1: descend toward target col
// Phase 2: grab (close)
// Phase 3: ascend with prize
// Phase 4: deliver to chute / show prize

type ClawPhase = "idle" | "descend" | "grab" | "ascend" | "deliver";

export function ClawMachineDisplay({ machineState, rewardClass, showConfetti }: Props) {
  const [ledPhase, setLedPhase]           = useState(0);
  // Claw x position (0–100 as % of track width)
  const [clawX, setClawX]                 = useState(50);
  // Claw y (0 = top rail, 100 = floor)
  const [clawY, setClawY]                 = useState(0);
  const [clawOpen, setClawOpen]           = useState(true);
  const [clawPhase, setClawPhase]         = useState<ClawPhase>("idle");
  // Which prize the claw is holding (null = none)
  const [heldPrize, setHeldPrize]         = useState<typeof PRIZE_POOL[0] | null>(null);
  // Prizes still in the bin (remove one when grabbed)
  const [prizes, setPrizes]               = useState(PRIZE_POOL);
  // Whether to show the "prize in chute" glow
  const [chutePrize, setChutePrize]       = useState<typeof PRIZE_POOL[0] | null>(null);

  const animRef  = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const ledRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const reward    = REWARD_META[rewardClass];
  const glowColor = RC_COLOR[rewardClass] ?? BRAND_PRIMARY;

  // ── LED blink ──────────────────────────────────────────────────────────
  useEffect(() => {
    ledRef.current = setInterval(() => setLedPhase((p) => (p + 1) % 6), 300);
    return () => { if (ledRef.current) clearInterval(ledRef.current); };
  }, []);

  // ── Main claw animation triggered by machineState ──────────────────────
  useEffect(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);

    if (machineState === "idle" || machineState === "starting") {
      setClawPhase("idle");
      setClawY(0);
      setClawOpen(true);
      setHeldPrize(null);
      return;
    }

    if (machineState === "pending" || machineState === "settling") {
      // Pick a random x within the reachable prize area (10–85 %)
      const targetX   = 10 + Math.random() * 75;
      const targetCol = 0; // kept for compat; not used for prize lookup anymore

      let phase: ClawPhase    = "idle";
      let x                   = 50;
      let y                   = 0;
      let open                = true;
      let grabbed             = false;
      let targetPrize: typeof PRIZE_POOL[0] | null = null;

      const SPEED = 0.8; // px per frame (smooth)
      const FLOOR = 78;  // y% at which claw reaches prizes

      const tick = () => {
        if (phase === "idle") {
          phase = "descend";
        }

        if (phase === "descend") {
          // Glide X toward target, simultaneously drop Y
          const dx = targetX - x;
          x += Math.sign(dx) * Math.min(Math.abs(dx), SPEED);
          y = Math.min(y + SPEED * 0.7, FLOOR);

          if (y >= FLOOR && Math.abs(dx) < 1) {
            phase = "grab";
            // Find the prize whose x position is closest to the claw's current x
            const nearby = prizes.filter((p) => Math.abs(p.x - x) <= 20);
            targetPrize = nearby[0] ?? prizes[0] ?? null;
          }
        }

        if (phase === "grab") {
          open = false;
          if (!grabbed) {
            grabbed = true;
            if (targetPrize) {
              setHeldPrize(targetPrize);
              setPrizes((prev) => prev.filter((p) => p !== targetPrize));
            }
            setTimeout(() => { phase = "ascend"; }, 300);
          }
        }

        if (phase === "ascend") {
          y = Math.max(y - SPEED * 1.2, 0);
          if (y <= 0) {
            phase = "deliver";
          }
        }

        if (phase === "deliver") {
          // Glide to chute (right side, ~85%)
          const dx = 85 - x;
          x += Math.sign(dx) * Math.min(Math.abs(dx), SPEED * 1.5);
          if (Math.abs(dx) < 1) {
            open = true;
            if (targetPrize) {
              setChutePrize(targetPrize);
            }
            setHeldPrize(null);
            // Loop back after a pause
            setTimeout(() => {
              if (machineState === "pending" || machineState === "settling") {
                grabbed    = false;
                phase      = "idle";
                x          = 50;
                y          = 0;
                open       = true;
                targetPrize = null;
                setChutePrize(null);
              }
            }, 1200);
          }
        }

        setClawX(x);
        setClawY(y);
        setClawOpen(open);
        setClawPhase(phase);

        if (machineState === "pending" || machineState === "settling") {
          animRef.current = requestAnimationFrame(tick);
        }
      };

      animRef.current = requestAnimationFrame(tick);
    }

    if (machineState === "settled") {
      // Reset claw to top-center, show the actual reward
      setClawPhase("idle");
      setClawY(0);
      setClawX(50);
      setClawOpen(true);
      setHeldPrize(null);
      setChutePrize(null);
    }

    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineState]);

  // ── Wire length: from top rail to claw head ────────────────────────────
  const wireLength = 18 + (clawY / 100) * 120; // px

  // (prize positions are baked into each PrizeItem — no grid constants needed)

  return (
    <div className="relative flex flex-col items-center select-none w-full max-w-[19rem]">

      {/* ── Cabinet body ─────────────────────────────────────────── */}
      <div
        className="relative w-full rounded-3xl overflow-hidden border-[3px] shadow-2xl"
        style={{
          height: 252,
          background: `linear-gradient(175deg, ${CABINET_DARK} 0%, ${CABINET_MID} 35%, ${CABINET_PANEL} 70%, #062328 100%)`,
          borderColor: BRAND_PRIMARY,
          boxShadow: machineState !== "idle"
            ? `0 0 40px 6px ${glowColor}44, 0 0 0 1px ${glowColor}33, 0 24px 60px -8px rgba(0,0,0,0.6)`
            : `0 0 0 1px ${BRAND_PRIMARY}44, 0 20px 60px -8px rgba(0,0,0,0.5)`,
          transition: "box-shadow 0.6s ease",
        }}
      >

        {/* ── Top neon marquee ────────────────────────────────────── */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-3"
          style={{ height: 32, background: "rgba(0,0,0,0.45)", borderBottom: `1px solid ${BRAND_PRIMARY}55` }}
        >
          {/* Left LEDs */}
          <div className="flex items-center gap-1">
            {[0,1,2,3,4].map((i) => {
              const on = i === ledPhase % 5;
              return (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full transition-all duration-100"
                  style={{
                    background: on ? LED_COLORS[i] : "#1f2937",
                    boxShadow: on ? `0 0 6px ${LED_COLORS[i]}` : "none",
                  }}
                />
              );
            })}
          </div>

          {/* Title */}
          <div className="flex items-center gap-1">
            <span
              className="font-black text-[11px] tracking-[0.2em]"
              style={{
                color: BRAND_SOFT,
                textShadow: `0 0 12px ${BRAND_SOFT}, 0 0 24px ${BRAND_PRIMARY}`,
              }}
            >
              AKIBA CLAW
            </span>
          </div>

          {/* Right LEDs */}
          <div className="flex items-center gap-1">
            {[5,6,7,8,9].map((i) => {
              const on = (i - 5) === (4 - ledPhase % 5);
              return (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full transition-all duration-100"
                  style={{
                    background: on ? LED_COLORS[i - 5] : "#1f2937",
                    boxShadow: on ? `0 0 6px ${LED_COLORS[i - 5]}` : "none",
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* ── Glass window (main play area) ───────────────────────── */}
        <div
          className="absolute left-2 right-2"
          style={{
            top: 36,
            bottom: 36,
            background: "linear-gradient(180deg, rgba(35,141,157,0.16) 0%, rgba(7,42,48,0.72) 100%)",
            borderRadius: 16,
            border: `1px solid ${BRAND_SOFT}33`,
            overflow: "hidden",
          }}
        >
          {/* Glass sheen */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 50%)",
              borderRadius: 16,
            }}
          />

          {/* ── Claw rail ─────────────────────────────────────── */}
          <div
            className="absolute top-3 left-4 right-4 h-1 rounded-full"
            style={{
              background: `linear-gradient(90deg, ${BRAND_DEEP}, ${BRAND_PRIMARY}, ${BRAND_DEEP})`,
              boxShadow: `0 0 8px ${BRAND_PRIMARY}`,
            }}
          />

          {/* ── Claw assembly ─────────────────────────────────── */}
          <div
            className="absolute flex flex-col items-center"
            style={{
              top: 10,
              left: `calc(${clawX}% - 14px)`,
              width: 28,
              transition: "none",
            }}
          >
            {/* Trolley on rail */}
            <div
              className="w-5 h-2.5 rounded-sm mb-0"
              style={{
                background: `linear-gradient(135deg, ${BRAND_SOFT}, ${BRAND_PRIMARY})`,
                boxShadow: `0 0 6px ${BRAND_PRIMARY}`,
              }}
            />
            {/* Wire */}
            <div
              className="w-px"
              style={{
                height: wireLength,
                background: `linear-gradient(180deg, ${BRAND_PRIMARY}, ${BRAND_SOFT}88)`,
                boxShadow: `0 0 3px ${BRAND_PRIMARY}`,
              }}
            />
            {/* Claw head */}
            <div className="relative" style={{ width: 28, height: 22 }}>
              {/* Hub */}
              <div
                className="absolute left-1/2 top-0 -translate-x-1/2 w-4 h-4 rounded-full z-10"
                style={{
                  background: `linear-gradient(135deg, ${BRAND_SOFT}, ${BRAND_PRIMARY})`,
                  boxShadow: `0 0 8px ${BRAND_SOFT}`,
                }}
              />
              {/* Left finger */}
              <div
                className="absolute rounded-b-full"
                style={{
                  width: 4,
                  height: 16,
                  left: 3,
                  top: 6,
                  background: `linear-gradient(180deg, ${BRAND_SOFT}, ${BRAND_PRIMARY})`,
                  transformOrigin: "top center",
                  transform: `rotate(${clawOpen ? -38 : -8}deg)`,
                  transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1)",
                  boxShadow: `0 0 4px ${BRAND_PRIMARY}`,
                }}
              />
              {/* Right finger */}
              <div
                className="absolute rounded-b-full"
                style={{
                  width: 4,
                  height: 16,
                  right: 3,
                  top: 6,
                  background: `linear-gradient(180deg, ${BRAND_SOFT}, ${BRAND_PRIMARY})`,
                  transformOrigin: "top center",
                  transform: `rotate(${clawOpen ? 38 : 8}deg)`,
                  transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1)",
                  boxShadow: `0 0 4px ${BRAND_PRIMARY}`,
                }}
              />
              {/* Middle finger */}
              <div
                className="absolute rounded-b-full"
                style={{
                  width: 3,
                  height: 14,
                  left: "50%",
                  transform: "translateX(-50%)",
                  top: 8,
                  background: `linear-gradient(180deg, ${BRAND_SOFT}, ${BRAND_PRIMARY})`,
                  boxShadow: `0 0 4px ${BRAND_PRIMARY}`,
                }}
              />
              {/* Held prize (dangles below claw when grabbed) */}
              {heldPrize && (
                <div
                  className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xl"
                  style={{
                    filter: `drop-shadow(0 0 6px ${RC_COLOR[heldPrize.rc]})`,
                    animation: "held-sway 0.4s ease-in-out infinite alternate",
                  }}
                >
                  {heldPrize.emoji}
                </div>
              )}
            </div>
          </div>

          {/* ── Prize grid (bottom of window) ─────────────────── */}
          {/* Floor glow */}
          <div
            className="absolute bottom-0 left-0 right-0 h-24"
            style={{
              background: `linear-gradient(0deg, ${BRAND_PRIMARY}55 0%, transparent 100%)`,
            }}
          />

          {prizes.map((p, i) => (
            <div
              key={i}
              className="absolute text-center pointer-events-none"
              style={{
                left:      `${p.x}%`,
                top:       `${p.y}%`,
                zIndex:    p.zIndex,
                fontSize:  `${p.scale * 1.05}rem`,
                // items deeper in the pile are slightly dimmer
                opacity:   p.y < 78 ? 0.55 : p.y < 86 ? 0.80 : 1,
                filter:    `drop-shadow(0 1px 3px rgba(0,0,0,0.55)) drop-shadow(0 0 3px ${RC_COLOR[p.rc]}66)`,
                transform: `translate(-50%, -50%) rotate(${p.rotate}deg)`,
                animation: `item-bob ${1.8 + (i * 0.23) % 1.4}s ease-in-out infinite alternate`,
                animationDelay: `${(i * 0.17) % 1.2}s`,
              }}
            >
              {p.emoji}
            </div>
          ))}

          {/* ── Settled: big prize reveal ──────────────────────── */}
          {machineState === "settled" && rewardClass > RewardClass.Lose && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center"
              style={{ background: `radial-gradient(circle at 50% 50%, ${glowColor}22 0%, transparent 70%)` }}
            >
              <div
                className="text-6xl mb-2"
                style={{
                  filter: `drop-shadow(0 0 20px ${glowColor})`,
                  animation: "prize-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards",
                }}
              >
                {reward.emoji}
              </div>
              <span
                className="font-black text-sm px-3 py-1 rounded-full"
                style={{
                  background: `${glowColor}33`,
                  color: glowColor,
                  border: `1px solid ${glowColor}66`,
                  textShadow: `0 0 8px ${glowColor}`,
                }}
              >
                {reward.label}
              </span>
            </div>
          )}

          {machineState === "settled" && rewardClass === RewardClass.Lose && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-5xl mb-2" style={{ animation: "prize-pop 0.5s forwards" }}>💨</div>
              <span className="text-gray-400 text-sm font-semibold">Better luck next time</span>
            </div>
          )}

          {/* ── Chute glow (prize delivered) ──────────────────── */}
          {chutePrize && (
            <div
              className="absolute right-2 bottom-6 text-2xl"
              style={{
                filter: `drop-shadow(0 0 10px ${RC_COLOR[chutePrize.rc]})`,
                animation: "chute-drop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
              }}
            >
              {chutePrize.emoji}
            </div>
          )}
        </div>

        {/* ── Bottom panel ────────────────────────────────────────── */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4"
          style={{
            height: 36,
            background: `linear-gradient(0deg, ${CABINET_DARK} 0%, rgba(10,53,60,0.92) 100%)`,
            borderTop: `1px solid ${BRAND_PRIMARY}44`,
          }}
        >
          {/* Prize chute opening */}
          <div
            className="flex items-center gap-1.5"
          >
            <div
              className="w-8 h-4 rounded-sm"
              style={{
                background: "rgba(0,0,0,0.6)",
                border: `1px solid ${BRAND_PRIMARY}55`,
                boxShadow: "inset 0 1px 4px rgba(0,0,0,0.8)",
              }}
            />
            <span className="text-[9px] font-medium tracking-widest" style={{ color: `${BRAND_SOFT}bb` }}>PRIZE</span>
          </div>

          {/* Status pill */}
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded-full"
            style={{
              background: "rgba(35,141,157,0.18)",
              border: `1px solid ${BRAND_PRIMARY}44`,
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: machineState === "idle" ? "#6B7280"
                  : machineState === "pending" || machineState === "settling" ? BRAND_PRIMARY
                  : machineState === "settled" ? glowColor
                  : "#F59E0B",
                boxShadow: machineState !== "idle"
                  ? `0 0 6px ${machineState === "settled" ? glowColor : BRAND_PRIMARY}`
                  : "none",
                animation: (machineState === "pending" || machineState === "settling")
                  ? "pulse-dot 1s ease-in-out infinite"
                  : "none",
              }}
            />
            <span className="text-[9px] font-medium tracking-wider uppercase" style={{ color: `${BRAND_SOFT}dd` }}>
              {machineState === "idle"    ? "ready"
               : machineState === "starting" ? "starting"
               : machineState === "pending"  ? "active"
               : machineState === "settling" ? "active"
               : machineState === "settled"  ? "done"
               : "—"}
            </span>
          </div>

          {/* Coin slot */}
          <div
            className="w-8 h-2 rounded-full"
            style={{
              background: "rgba(0,0,0,0.7)",
              border: `1px solid ${BRAND_PRIMARY}55`,
            }}
          />
        </div>

        {/* ── Side accent strips ──────────────────────────────────── */}
        <div
          className="absolute left-0 top-8 bottom-8 w-1.5"
          style={{
            background: `linear-gradient(180deg, transparent, ${machineState !== "idle" ? glowColor : BRAND_PRIMARY}, transparent)`,
            opacity: 0.6,
          }}
        />
        <div
          className="absolute right-0 top-8 bottom-8 w-1.5"
          style={{
            background: `linear-gradient(180deg, transparent, ${machineState !== "idle" ? glowColor : BRAND_PRIMARY}, transparent)`,
            opacity: 0.6,
          }}
        />
      </div>

      {/* ── State message ───────────────────────────────────────────── */}
      <div className="mt-3 min-h-[20px] text-center px-4">
        {machineState === "settled" && rewardClass > RewardClass.Lose ? (
          <p className="text-sm font-semibold" style={{ color: glowColor, textShadow: `0 0 10px ${glowColor}88` }}>
            {reward.description}
          </p>
        ) : (
          <p className="text-xs text-gray-400">{STATE_MSG[machineState]}</p>
        )}
      </div>

      {/* ── Confetti ────────────────────────────────────────────────── */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 30 }).map((_, i) => (
            <ConfettiPiece
              key={i}
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 30}%`,
                background: ["#F59E0B", BRAND_SECONDARY, BRAND_PRIMARY, "#59C7D4", "#176B76", "#EF4444", BRAND_SOFT][i % 7],
                animationDelay: `${Math.random() * 0.4}s`,
                animationDuration: `${0.9 + Math.random() * 0.7}s`,
                transform: `rotate(${Math.random() * 360}deg)`,
                animation: "confetti-fall 1.2s ease-out forwards",
              }}
            />
          ))}
        </div>
      )}

      {/* ── All keyframe animations ─────────────────────────────────── */}
      <style>{`
        @keyframes item-bob {
          from { transform: translate(-50%, -50%) translateY(0px); }
          to   { transform: translate(-50%, -50%) translateY(-3px); }
        }
        @keyframes held-sway {
          from { transform: translateX(-50%) rotate(-6deg); }
          to   { transform: translateX(-50%) rotate(6deg); }
        }
        @keyframes prize-pop {
          0%   { transform: scale(0.4) rotate(-15deg); opacity: 0; }
          60%  { transform: scale(1.25) rotate(5deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes chute-drop {
          0%   { transform: translateY(-20px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes confetti-fall {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(140px) rotate(540deg); opacity: 0; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>
    </div>
  );
}
