import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GameController, Gift, Trophy, Wallet } from "@phosphor-icons/react";
import { SkillGameCard } from "./game-components/game-card";
import { MilesAmount } from "./game-components/miles-amount";
import { MemoryGrid } from "./game-components/memory-flip/memory-grid";
import { MemoryStats } from "./game-components/memory-flip/memory-stats";
import { RuleBanner } from "./game-components/rule-tap/rule-banner";
import { RuleTapBoard } from "./game-components/rule-tap/rule-tap-board";
import { RuleTapScorePanel } from "./game-components/rule-tap/rule-tap-score-panel";
import type { GameConfig, RuleTapTile } from "./game-components/types";

const COLORS = {
  teal: "#238D9D",
  cyan: "#ADF4FF",
  pale: "#F0FDFF",
  text: "#111827",
  muted: "#525252",
  soft: "#817E7E",
  border: "rgba(35,141,157,0.22)",
  green: "#27A957",
};

const SCRIPT = [
  { start: 0, end: 120, text: "Office Hours: what are AkibaMiles?" },
  { start: 120, end: 300, text: "AkibaMiles are reward points inside the AkibaMiles app." },
  { start: 300, end: 510, text: "You earn them by completing challenges, playing skill games, and joining app activities." },
  { start: 510, end: 720, text: "Then you can use Miles for games, raffles, and reward opportunities inside the app." },
  { start: 720, end: 960, text: "The simple loop is: earn Miles, use Miles, and track your progress." },
  { start: 960, end: 1350, text: "Open AkibaMiles, check your balance, and drop your next question in the comments." },
];

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const pop = Easing.bezier(0.34, 1.56, 0.64, 1);

const RULE_TAP_CONFIG: GameConfig = {
  type: "rule_tap",
  chainGameType: 1,
  name: "Rule Tap",
  shortName: "Rule Tap",
  description: "Read the rule, tap fast, avoid mistakes.",
  route: "/games/rule-tap",
  entryCostMiles: 5,
  maxRewardMiles: 35,
  maxRewardStable: 0.25,
  durationSeconds: 20,
  dailyPlayCap: 20,
  cooldownSeconds: 15,
  leaderboardSort: "score_desc",
  weeklyPrizeUsd: 10,
  weeklyPrizeMiles: 250,
  thresholds: [
    { label: "Warm up", minScore: 10, miles: 8, stable: 0 },
    { label: "Elite", minScore: 18, miles: 35, stable: 0.25 },
  ],
};

const MEMORY_CONFIG: GameConfig = {
  type: "memory_flip",
  chainGameType: 2,
  name: "Memory Flip",
  shortName: "Memory",
  description: "Match pairs before time runs out.",
  route: "/games/memory-flip",
  entryCostMiles: 5,
  maxRewardMiles: 40,
  maxRewardStable: 0.25,
  durationSeconds: 60,
  dailyPlayCap: 15,
  cooldownSeconds: 20,
  leaderboardSort: "score_desc",
  weeklyPrizeUsd: 10,
  weeklyPrizeMiles: 250,
  thresholds: [
    { label: "Complete", minScore: 420, miles: 10, stable: 0 },
    { label: "Contender", minScore: 780, miles: 40, stable: 0.25 },
  ],
};

const RULE_TILES: RuleTapTile[] = [
  { id: "t0", index: 0, kind: "star", color: "blue", activeFromMs: 0, activeToMs: 850 },
  { id: "t1", index: 2, kind: "circle", color: "green", activeFromMs: 0, activeToMs: 850 },
  { id: "t2", index: 4, kind: "star", color: "gold", activeFromMs: 0, activeToMs: 850 },
  { id: "t3", index: 6, kind: "square", color: "red", activeFromMs: 0, activeToMs: 850 },
  { id: "t4", index: 8, kind: "star", color: "blue", activeFromMs: 0, activeToMs: 850 },
];

const MEMORY_DECK = [
  { id: "0", value: "sun" }, { id: "1", value: "moon" }, { id: "2", value: "bolt" }, { id: "3", value: "key" },
  { id: "4", value: "spark" }, { id: "5", value: "leaf" }, { id: "6", value: "gem" }, { id: "7", value: "wave" },
  { id: "8", value: "moon" }, { id: "9", value: "sun" }, { id: "10", value: "key" }, { id: "11", value: "bolt" },
  { id: "12", value: "leaf" }, { id: "13", value: "spark" }, { id: "14", value: "wave" }, { id: "15", value: "gem" },
];

function useAnim() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = (from: number, to: number) =>
    interpolate(frame, [from, to], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    });
  const exitFade = (from: number, to: number) =>
    interpolate(frame, [from, to], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    });
  const rise = (from: number, to: number, distance = 40) =>
    interpolate(frame, [from, to], [distance, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    });
  return { frame, fps, fade, exitFade, rise };
}

const AssetIcon: React.FC<{ src: string; size?: number }> = ({ src, size = 42 }) => (
  <Img src={staticFile(src)} style={{ width: size, height: size, objectFit: "contain" }} />
);

const MilesPill: React.FC<{ value: string; compact?: boolean }> = ({ value, compact = false }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: compact ? 8 : 12,
      padding: compact ? "8px 12px" : "12px 18px",
      borderRadius: 999,
      background: "#FFFFFF",
      border: `1px solid ${COLORS.border}`,
      boxShadow: "0 10px 28px rgba(35,141,157,0.12)",
      fontSize: compact ? 20 : 26,
      fontWeight: 800,
      color: COLORS.teal,
      lineHeight: 1,
    }}
  >
    <AssetIcon src="minimiles-symbol.svg" size={compact ? 24 : 34} />
    <span>{value}</span>
  </div>
);

const HostBubble: React.FC<{ question: string; delay: number }> = ({ question, delay }) => {
  const { frame, fade, rise } = useAnim();
  const scale = interpolate(frame, [delay, delay + 24], [0.96, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: pop,
  });
  return (
    <div
      style={{
        opacity: fade(delay, delay + 24),
        transform: `translateY(${rise(delay, delay + 24, 24)}px) scale(${scale})`,
        display: "flex",
        gap: 22,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 32,
          background: COLORS.teal,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 42,
          fontWeight: 900,
          boxShadow: "0 18px 40px rgba(35,141,157,0.25)",
        }}
      >
        A
      </div>
      <div
        style={{
          flex: 1,
          background: "white",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 30,
          padding: "28px 30px",
          boxShadow: "0 18px 48px rgba(17,24,39,0.08)",
        }}
      >
        <div style={{ color: COLORS.teal, fontSize: 24, fontWeight: 800, marginBottom: 8 }}>
          AkibaMiles Office Hours
        </div>
        <div style={{ color: COLORS.text, fontSize: 42, fontWeight: 900, lineHeight: 1.08 }}>
          {question}
        </div>
      </div>
    </div>
  );
};

const PhoneShell: React.FC<{ children: React.ReactNode; delay: number; top?: number }> = ({
  children,
  delay,
  top = 250,
}) => {
  const { frame, fade, rise } = useAnim();
  const scale = interpolate(frame, [delay, delay + 30], [0.92, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: pop,
  });
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 112,
        width: 856,
        height: 1250,
        opacity: fade(delay, delay + 24),
        transform: `translateY(${rise(delay, delay + 24, 44)}px) scale(${scale})`,
        borderRadius: 64,
        background: "#101820",
        padding: 18,
        boxShadow: "0 32px 90px rgba(17,24,39,0.22)",
      }}
    >
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          height: "100%",
          borderRadius: 48,
          background: "#FBFEFF",
        }}
      >
        {children}
      </div>
    </div>
  );
};

const ActionCard: React.FC<{
  icon: string;
  title: string;
  body: string;
  tag: string;
  delay: number;
  y?: number;
}> = ({ icon, title, body, tag, delay }) => {
  const { frame, fade, rise } = useAnim();
  const scale = interpolate(frame, [delay, delay + 18], [0.97, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: pop,
  });
  return (
    <div
      style={{
        opacity: fade(delay, delay + 18),
        transform: `translateY(${rise(delay, delay + 18, 30)}px) scale(${scale})`,
        display: "flex",
        alignItems: "center",
        gap: 22,
        padding: 26,
        borderRadius: 28,
        background: "white",
        border: `1px solid ${COLORS.border}`,
        boxShadow: "0 12px 34px rgba(17,24,39,0.06)",
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 24,
          background: COLORS.pale,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <AssetIcon src={icon} size={46} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ color: COLORS.text, fontSize: 30, fontWeight: 850, lineHeight: 1.1 }}>{title}</div>
        <div style={{ color: COLORS.muted, fontSize: 22, fontWeight: 500, marginTop: 7, lineHeight: 1.25 }}>
          {body}
        </div>
      </div>
      <div
        style={{
          color: COLORS.teal,
          background: "rgba(173,244,255,0.45)",
          padding: "10px 16px",
          borderRadius: 999,
          fontSize: 18,
          fontWeight: 850,
        }}
      >
        {tag}
      </div>
    </div>
  );
};

const CaptionBar: React.FC = () => {
  const { frame } = useAnim();
  const current = SCRIPT.find((line) => frame >= line.start && frame < line.end) ?? SCRIPT[SCRIPT.length - 1];
  const inFrame = current.start;
  const outFrame = current.end - 14;
  const opacity = Math.min(
    interpolate(frame, [inFrame, inFrame + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(frame, [outFrame, current.end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  );
  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        bottom: 92,
        opacity,
        background: "rgba(17,24,39,0.86)",
        color: "white",
        borderRadius: 28,
        padding: "24px 30px",
        fontSize: 34,
        fontWeight: 800,
        lineHeight: 1.18,
        textAlign: "center",
        boxShadow: "0 18px 46px rgba(17,24,39,0.18)",
      }}
    >
      {current.text}
    </div>
  );
};

const SceneHook: React.FC = () => {
  const { frame, fade, exitFade, rise } = useAnim();
  const opacity = fade(0, 20) * exitFade(108, 120);
  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", top: 96, left: 72, right: 72 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", opacity: fade(6, 24) }}>
          <Img src={staticFile("akibamiles-logo.svg")} style={{ width: 300, height: "auto" }} />
          <div
            style={{
              color: COLORS.teal,
              background: "white",
              border: `1px solid ${COLORS.border}`,
              padding: "14px 22px",
              borderRadius: 999,
              fontSize: 24,
              fontWeight: 850,
            }}
          >
            Episode 01
          </div>
        </div>
        <div
          style={{
            marginTop: 168,
            opacity: fade(10, 28),
            transform: `translateY(${rise(10, 28, 50)}px)`,
          }}
        >
          <div style={{ color: COLORS.teal, fontSize: 34, fontWeight: 900, marginBottom: 20 }}>
            AkibaMiles Office Hours
          </div>
          <div style={{ color: COLORS.text, fontSize: 96, fontWeight: 950, lineHeight: 0.98, letterSpacing: -2 }}>
            What are
            <br />
            AkibaMiles?
          </div>
          <div style={{ color: COLORS.muted, fontSize: 36, fontWeight: 600, lineHeight: 1.25, marginTop: 32, width: 780 }}>
            A quick answer for anyone opening the app for the first time.
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 1030,
          left: 72,
          right: 72,
          opacity: fade(32, 54),
          transform: `translateY(${rise(32, 54, 46)}px)`,
        }}
      >
        <HostBubble question="What are AkibaMiles, and why should I care?" delay={32} />
      </div>
      <div
        style={{
          position: "absolute",
          right: 80,
          top: 650,
          width: 220,
          height: 220,
          borderRadius: 46,
          background: "white",
          border: `1px solid ${COLORS.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 24px 70px rgba(35,141,157,0.16)",
          opacity: fade(22, 42),
          transform: `rotate(${interpolate(frame, [22, 80], [-8, 5], { extrapolateRight: "clamp" })}deg)`,
        }}
      >
        <AssetIcon src="minimiles-symbol.svg" size={112} />
      </div>
    </AbsoluteFill>
  );
};

const SceneAnswer: React.FC = () => {
  const { fade, exitFade, rise } = useAnim();
  const opacity = fade(108, 132) * exitFade(486, 510);
  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", top: 108, left: 72, right: 72 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            background: "white",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 999,
            padding: "14px 22px",
            opacity: fade(120, 144),
          }}
        >
          <AssetIcon src="success.svg" size={28} />
          <span style={{ color: COLORS.teal, fontSize: 24, fontWeight: 900 }}>Short answer</span>
        </div>
        <div
          style={{
            color: COLORS.text,
            fontSize: 70,
            fontWeight: 950,
            lineHeight: 1.02,
            marginTop: 42,
            opacity: fade(134, 160),
            transform: `translateY(${rise(134, 160, 36)}px)`,
          }}
        >
          AkibaMiles are
          <br />
          reward points for
          <br />
          your app activity.
        </div>
        <div
          style={{
            marginTop: 38,
            color: COLORS.muted,
            fontSize: 34,
            fontWeight: 600,
            lineHeight: 1.32,
            width: 850,
            opacity: fade(166, 194),
            transform: `translateY(${rise(166, 194, 32)}px)`,
          }}
        >
          You earn them by completing challenges, playing skill games, and joining supported activities in AkibaMiles.
        </div>
      </div>

      <div style={{ position: "absolute", left: 72, right: 72, top: 790, display: "flex", flexDirection: "column", gap: 22 }}>
        <ActionCard icon="earn.svg" title="Earn Miles" body="Daily challenges, partner quests, and useful app actions." tag="+ Miles" delay={202} />
        <ActionCard icon="gamepad-icon.svg" title="Play with Miles" body="Rule Tap and Memory Flip use Miles for short skill rounds." tag="Skill" delay={236} />
        <ActionCard icon="ticket.svg" title="Use Miles" body="Join eligible raffles and reward opportunities when they are live." tag="Rewards" delay={270} />
      </div>
    </AbsoluteFill>
  );
};

const MiniAppFrame: React.FC<{
  tab: "Home" | "Earn" | "Games" | "Spend";
  children: React.ReactNode;
}> = ({ tab, children }) => (
  <div
    style={{
      width: 390,
      minHeight: 620,
      transform: "scale(2.06)",
      transformOrigin: "top left",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      color: COLORS.text,
    }}
  >
    <div className="px-4 pt-5 pb-3">
      <div className="flex items-center justify-between">
        <Img src={staticFile("akibamiles-logo.svg")} style={{ width: 132, height: "auto" }} />
        <div className="rounded-full border border-[#238D9D33] bg-white px-2.5 py-1 text-xs font-bold text-[#238D9D] shadow-sm">
          <MilesAmount value="1,240" size={14} />
        </div>
      </div>
      <h1 className="mt-4 text-2xl font-medium">{tab}</h1>
    </div>
    {children}
    <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between rounded-3xl border border-[#238D9D22] bg-[#e6faee] px-8 py-3 text-[11px] font-bold">
      {[
        ["Earn", EarnIcon],
        ["Games", GameController],
        ["Spend", Wallet],
      ].map(([label, Icon]) => {
        const active = tab === label || (tab === "Home" && label === "Earn");
        const TypedIcon = Icon as React.ComponentType<{ size: number }>;
        return (
          <div key={label as string} className={`flex flex-col items-center gap-1 ${active ? "text-[#238D9D]" : "text-[#817E7E]"}`}>
            <div className={active ? "rounded-xl bg-white p-1.5 shadow-sm" : "p-1.5"}>
              <TypedIcon size={18} />
            </div>
            {label as string}
          </div>
        );
      })}
    </div>
  </div>
);

function EarnIcon({ size }: { size: number }) {
  return <Gift size={size} />;
}

const ActualHomeScreen: React.FC = () => (
  <MiniAppFrame tab="Home">
    <div className="mx-4 mb-4 rounded-2xl bg-[#238D9D] bg-cover p-3 text-white">
      <h3>Total AkibaMiles</h3>
      <div className="my-3 flex items-center justify-start">
        <Img src={staticFile("minimiles-symbol-alt.svg")} style={{ width: 32, height: 32 }} />
        <p className="pl-2 text-3xl font-medium">1,240</p>
      </div>
    </div>
    <div className="mx-4 grid grid-cols-2 gap-3">
      <div className="rounded-xl bg-green-100 p-4">
        <div className="mb-2 flex items-center justify-between">
          <Gift size={16} className="text-gray-600" />
          <span className="text-xs text-[#238D9D]">+10 Miles</span>
        </div>
        <p className="text-sm font-medium">Daily check-in</p>
        <p className="mt-1 text-xs text-gray-600">Open the app and claim.</p>
      </div>
      <div className="rounded-xl bg-[#F0FDFF] p-4 border border-[#238D9D33]">
        <div className="mb-2 flex items-center justify-between">
          <GameController size={16} className="text-[#238D9D]" />
          <span className="text-xs text-[#238D9D]">Live</span>
        </div>
        <p className="text-sm font-medium">Skill games</p>
        <p className="mt-1 text-xs text-gray-600">Play short rounds.</p>
      </div>
    </div>
    <div className="mx-4 mt-5">
      <h3 className="mb-2 text-lg font-medium">Join Raffles</h3>
      <div className="relative h-[155px] overflow-hidden rounded-xl bg-white shadow-md">
        <Img src={staticFile("raffle-phone.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 text-white">
          <p className="text-sm font-medium">Samsung Smartphone</p>
          <p className="text-xs text-gray-200">Ends in 2 days</p>
          <span className="mt-1 inline-flex items-center rounded-full bg-white px-2 py-1 text-xs font-medium text-black">
            <MilesAmount value="50" size={12} />
          </span>
        </div>
      </div>
    </div>
  </MiniAppFrame>
);

const ActualEarnScreen: React.FC = () => (
  <MiniAppFrame tab="Earn">
    <div className="px-4">
      <p className="font-poppins text-sm text-[#525252]">Complete challenges to earn AkibaMiles.</p>
    </div>
    <div className="mx-4 mt-4 rounded-2xl bg-[#238D9D] p-3 text-white">
      <h3>Total AkibaMiles</h3>
      <div className="my-3 flex items-center">
        <Img src={staticFile("minimiles-symbol-alt.svg")} style={{ width: 32, height: 32 }} />
        <p className="pl-2 text-3xl font-medium">1,260</p>
      </div>
    </div>
    <div className="mx-4 mt-5">
      <div className="mb-3 flex rounded-full bg-[#EBEBEB] p-1 text-sm font-medium">
        <span className="rounded-full bg-[#ADF4FF80] px-4 py-2 text-[#238D9D]">Active</span>
        <span className="px-4 py-2 text-[#8E8B8B]">Completed</span>
      </div>
      <h3 className="text-lg font-medium">Daily challenges</h3>
      <p className="mb-3 text-sm text-gray-500">Completed a challenge? Click & claim Miles</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-green-100 p-4">
          <div className="mb-2 flex justify-between"><Gift size={16} /><span className="text-xs text-[#238D9D]">+10</span></div>
          <p className="text-sm font-medium">Daily login</p>
          <p className="mt-1 text-xs text-gray-600">Claim today's Miles.</p>
        </div>
        <div className="rounded-xl bg-green-100 p-4">
          <div className="mb-2 flex justify-between"><Wallet size={16} /><span className="text-xs text-[#238D9D]">+20</span></div>
          <p className="text-sm font-medium">Send $1</p>
          <p className="mt-1 text-xs text-gray-600">Complete a transfer.</p>
        </div>
      </div>
    </div>
  </MiniAppFrame>
);

const ActualGamesScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const showBoard = frame > 700;
  const revealed = new Set<number>([0, 9, 2]);
  const matched = new Set<number>([0, 9]);
  return (
    <MiniAppFrame tab="Games">
      {!showBoard ? (
        <div className="space-y-3 px-4">
          <p className="font-poppins text-sm text-[#525252]">Play short skill rounds with verified rewards.</p>
          <SkillGameCard config={RULE_TAP_CONFIG} />
          <SkillGameCard config={MEMORY_CONFIG} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="px-4">
            <h2 className="text-xl font-medium">Rule Tap</h2>
            <p className="text-sm text-[#525252]">Read the rule. React fast.</p>
          </div>
          <RuleBanner rule={{ instruction: "Tap only STARS", targets: [{ color: "blue", kind: "star" }], avoids: [] }} />
          <RuleTapScorePanel score={12} mistakes={1} remainingMs={8500} combo={3} lastDelta={1} />
          <RuleTapBoard activeTiles={RULE_TILES} feedback={{ 0: "good", 2: "bad" }} onTap={() => undefined} />
          <div className="mx-4 rounded-2xl border border-[#238D9D33] bg-white p-3 shadow-sm">
            <MemoryStats score={620} moves={14} matches={6} remainingMs={31000} />
            <MemoryGrid deck={MEMORY_DECK} revealed={revealed} matched={matched} onFlip={() => undefined} />
          </div>
        </div>
      )}
    </MiniAppFrame>
  );
};

const ActualSpendScreen: React.FC = () => (
  <MiniAppFrame tab="Spend">
    <div className="px-4">
      <p className="font-poppins text-sm text-[#525252]">Use Miles for eligible raffles and reward opportunities.</p>
    </div>
    <div className="mx-4 mt-5 space-y-4">
      {[
        ["raffle-phone.png", "Samsung Smartphone", "Ends in 2 days", "50"],
        ["raffle-bag.png", "Laptop Bag", "Ends in 5 days", "25"],
      ].map(([src, title, ends, cost]) => (
        <div key={title} className="relative h-[190px] overflow-hidden rounded-xl bg-white shadow-md">
          <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-white">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-gray-200">{ends}</p>
            <div className="mt-1 flex items-center gap-1">
              <span className="inline-flex items-center rounded-full bg-[#238D9D] px-2 py-1 text-[11px] font-medium text-white">
                <Trophy size={12} className="mr-1" /> 1
              </span>
              <span className="inline-flex items-center rounded-full bg-white px-2 py-1 text-xs font-medium text-black">
                <MilesAmount value={cost} size={12} />
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  </MiniAppFrame>
);

const SceneAppDemo: React.FC = () => {
  const { frame, fade, exitFade } = useAnim();
  const opacity = fade(492, 520) * exitFade(936, 960);
  const screen =
    frame < 595 ? <ActualHomeScreen />
    : frame < 690 ? <ActualEarnScreen />
    : frame < 825 ? <ActualGamesScreen />
    : <ActualSpendScreen />;
  return (
    <AbsoluteFill style={{ opacity }}>
      <PhoneShell delay={500} top={170}>
        {screen}
      </PhoneShell>
    </AbsoluteFill>
  );
};

const SceneLoop: React.FC = () => {
  const { fade, exitFade, rise } = useAnim();
  const opacity = fade(936, 964) * exitFade(1138, 1160);
  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", top: 138, left: 72, right: 72, textAlign: "center" }}>
        <div style={{ color: COLORS.teal, fontSize: 32, fontWeight: 900, opacity: fade(950, 978) }}>The product loop</div>
        <div
          style={{
            color: COLORS.text,
            fontSize: 76,
            fontWeight: 950,
            lineHeight: 1.02,
            marginTop: 18,
            opacity: fade(970, 1000),
            transform: `translateY(${rise(970, 1000, 30)}px)`,
          }}
        >
          Earn. Use.
          <br />
          Track. Repeat.
        </div>
      </div>
      <div style={{ position: "absolute", top: 610, left: 72, right: 72, display: "flex", gap: 24 }}>
        {[
          ["earn.svg", "Earn", "Complete challenges and activities.", "+ Miles"],
          ["minimiles-symbol.svg", "Use", "Play games or join eligible raffles.", "Entry"],
          ["success.svg", "Track", "Watch your balance and progress update.", "Verified"],
        ].map(([icon, title, body, tag], index) => (
          <div
            key={title}
            style={{
              flex: 1,
              minHeight: 410,
              background: "white",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 34,
              padding: 30,
              boxShadow: "0 18px 54px rgba(17,24,39,0.08)",
              opacity: fade(1000 + index * 20, 1028 + index * 20),
              transform: `translateY(${rise(1000 + index * 20, 1028 + index * 20, 40)}px)`,
            }}
          >
            <div
              style={{
                width: 92,
                height: 92,
                borderRadius: 28,
                background: COLORS.pale,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 34,
              }}
            >
              <AssetIcon src={icon} size={54} />
            </div>
            <div style={{ color: COLORS.text, fontSize: 38, fontWeight: 950 }}>{title}</div>
            <div style={{ color: COLORS.muted, fontSize: 24, fontWeight: 600, lineHeight: 1.25, marginTop: 16 }}>{body}</div>
            <div
              style={{
                display: "inline-flex",
                marginTop: 28,
                color: COLORS.teal,
                background: "rgba(173,244,255,0.45)",
                borderRadius: 999,
                padding: "10px 16px",
                fontSize: 20,
                fontWeight: 900,
              }}
            >
              {tag}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const SceneCTA: React.FC = () => {
  const { frame, fade, rise } = useAnim();
  const pulse = 1 + 0.018 * Math.sin((frame / 30) * Math.PI * 2);
  return (
    <AbsoluteFill style={{ opacity: fade(1138, 1166) }}>
      <div style={{ position: "absolute", top: 132, left: 72, right: 72, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Img src={staticFile("akibamiles-logo.svg")} style={{ width: 312, height: "auto" }} />
        <MilesPill value="Miles" compact />
      </div>
      <div
        style={{
          position: "absolute",
          top: 430,
          left: 72,
          right: 72,
          textAlign: "center",
          opacity: fade(1160, 1190),
          transform: `translateY(${rise(1160, 1190, 42)}px)`,
        }}
      >
        <div style={{ color: COLORS.text, fontSize: 86, fontWeight: 950, lineHeight: 1.02, letterSpacing: -1.5 }}>
          Open AkibaMiles.
          <br />
          Check your balance.
        </div>
        <div style={{ color: COLORS.muted, fontSize: 34, fontWeight: 650, lineHeight: 1.3, marginTop: 32 }}>
          Then drop your next question for Office Hours.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 1030,
          left: 182,
          right: 182,
          height: 126,
          borderRadius: 34,
          background: COLORS.teal,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          fontSize: 34,
          fontWeight: 950,
          boxShadow: "0 24px 60px rgba(35,141,157,0.28)",
          opacity: fade(1210, 1238),
          transform: `scale(${pulse}) translateY(${rise(1210, 1238, 26)}px)`,
        }}
      >
        <AssetIcon src="minimiles-symbol-alt.svg" size={44} />
        Open AkibaMiles
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 250,
          left: 72,
          right: 72,
          background: "white",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 30,
          padding: "28px 34px",
          color: COLORS.text,
          fontSize: 30,
          fontWeight: 850,
          lineHeight: 1.2,
          textAlign: "center",
          opacity: fade(1260, 1290),
        }}
      >
        Next episode: How do you earn Miles?
      </div>
    </AbsoluteFill>
  );
};

export const AkibaMilesOfficeHours01: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #F7FEFF 0%, #F0FDFF 52%, #FFFFFF 100%)",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(35,141,157,0.05), transparent 45%, rgba(173,244,255,0.16))" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 18, background: COLORS.teal }} />
      <SceneHook />
      <SceneAnswer />
      <SceneAppDemo />
      <SceneLoop />
      <SceneCTA />
      <CaptionBar />
    </AbsoluteFill>
  );
};
