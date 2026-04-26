import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import {
  ArrowRight,
  Brain,
  CheckCircle,
  Clock,
  GameController,
  Lightning,
  ShieldCheck,
  Sparkle,
  Ticket,
  Trophy,
} from "@phosphor-icons/react";
import { SkillGameCard } from "./game-components/game-card";
import { MemoryGrid } from "./game-components/memory-flip/memory-grid";
import { MemoryStats } from "./game-components/memory-flip/memory-stats";
import { MilesAmount } from "./game-components/miles-amount";
import { RuleBanner } from "./game-components/rule-tap/rule-banner";
import { RuleTapBoard } from "./game-components/rule-tap/rule-tap-board";
import { RuleTapScorePanel } from "./game-components/rule-tap/rule-tap-score-panel";
import type { GameConfig, RuleTapRule, RuleTapTile } from "./game-components/types";

const COLORS = {
  teal: "#238D9D",
  deep: "#0D7A8A",
  cyan: "#ADF4FF",
  pale: "#F0FDFF",
  text: "#111827",
  muted: "#525252",
  soft: "#817E7E",
  green: "#4EFFA0",
  line: "rgba(35,141,157,0.18)",
};

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const RULE_TAP_CONFIG: GameConfig = {
  type: "rule_tap",
  chainGameType: 1,
  name: "Rule Tap",
  shortName: "Rule Tap",
  description: "Read the rule, tap only the matching tiles, and avoid traps.",
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
  description: "Match 8 hidden pairs before time runs out.",
  route: "/games/memory-flip",
  entryCostMiles: 5,
  maxRewardMiles: 20,
  maxRewardStable: 0,
  durationSeconds: 60,
  dailyPlayCap: 15,
  cooldownSeconds: 20,
  leaderboardSort: "score_desc",
  weeklyPrizeUsd: 10,
  weeklyPrizeMiles: 250,
  thresholds: [
    { label: "Complete", minScore: 420, miles: 10, stable: 0 },
    { label: "Clean run", minScore: 780, miles: 20, stable: 0 },
  ],
};

const RULE: RuleTapRule = {
  instruction: "Tap blue stars. Avoid red squares.",
  targets: [{ color: "blue", kind: "star" }],
  avoids: [{ color: "red", kind: "square" }],
};

const RULE_TILES: RuleTapTile[] = [
  { id: "0", index: 0, kind: "star", color: "blue", activeFromMs: 0, activeToMs: 900 },
  { id: "1", index: 2, kind: "circle", color: "green", activeFromMs: 0, activeToMs: 900 },
  { id: "2", index: 4, kind: "star", color: "blue", activeFromMs: 0, activeToMs: 900 },
  { id: "3", index: 6, kind: "square", color: "red", activeFromMs: 0, activeToMs: 900 },
  { id: "4", index: 8, kind: "diamond", color: "gold", activeFromMs: 0, activeToMs: 900 },
];

const MEMORY_DECK = [
  { id: "0", value: "sun" },
  { id: "1", value: "moon" },
  { id: "2", value: "bolt" },
  { id: "3", value: "key" },
  { id: "4", value: "spark" },
  { id: "5", value: "leaf" },
  { id: "6", value: "gem" },
  { id: "7", value: "wave" },
  { id: "8", value: "moon" },
  { id: "9", value: "sun" },
  { id: "10", value: "key" },
  { id: "11", value: "bolt" },
  { id: "12", value: "leaf" },
  { id: "13", value: "spark" },
  { id: "14", value: "wave" },
  { id: "15", value: "gem" },
];

function useEntrance(start = 0) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [start, start + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const y = interpolate(frame, [start, start + 22], [36, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  return { frame, opacity, y };
}

const AkibaLogo: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <Img src={staticFile("minimiles-symbol.svg")} style={{ width: size, height: size }} />
);

const SceneShell: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
  caption?: string;
}> = ({ eyebrow, title, children, caption }) => {
  const { opacity, y } = useEntrance();

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 18% 12%, rgba(173,244,255,0.9), transparent 26%), radial-gradient(circle at 85% 78%, rgba(35,141,157,0.12), transparent 30%), #F7FEFF",
        fontFamily: "Sterling, ui-sans-serif, system-ui, sans-serif",
        color: COLORS.text,
        overflow: "hidden",
      }}
    >
      <style>
        {`
          @font-face {
            font-family: Sterling;
            src: url("${staticFile("storyboards/assets/fonts/FTSterlingTrial-Regular.woff")}") format("woff");
            font-weight: 300;
          }
          @font-face {
            font-family: Sterling;
            src: url("${staticFile("storyboards/assets/fonts/FTSterlingTrial-Semi-Bold.woff")}") format("woff");
            font-weight: 600;
          }
        `}
      </style>

      <div style={{ position: "absolute", top: 68, left: 68, right: 68, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: 18, background: "#fff", display: "grid", placeItems: "center", boxShadow: "0 14px 30px rgba(35,141,157,0.14)" }}>
            <AkibaLogo size={34} />
          </div>
          <div>
            <div style={{ fontSize: 13, letterSpacing: 2.4, color: COLORS.soft, fontWeight: 600 }}>AKIBAMILES</div>
            <div style={{ fontSize: 26, fontWeight: 600 }}>Office Hours</div>
          </div>
        </div>
        <div style={{ padding: "12px 18px", borderRadius: 999, background: "#fff", color: COLORS.teal, border: `1px solid ${COLORS.line}`, fontSize: 21, fontWeight: 600 }}>
          Episode 01
        </div>
      </div>

      <div style={{ position: "absolute", top: 178, left: 68, right: 68, opacity, transform: `translateY(${y}px)` }}>
        <div style={{ display: "inline-flex", gap: 8, alignItems: "center", background: "rgba(35,141,157,0.10)", color: COLORS.teal, borderRadius: 999, padding: "10px 14px", fontSize: 18, fontWeight: 600, marginBottom: 20 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: COLORS.teal }} />
          {eyebrow}
        </div>
        <h1 style={{ margin: 0, fontSize: 74, lineHeight: 0.93, letterSpacing: -1, fontWeight: 600, maxWidth: 900 }}>{title}</h1>
      </div>

      {children}

      {caption && (
        <div style={{ position: "absolute", left: 68, right: 68, bottom: 62, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 30 }}>
          <p style={{ margin: 0, maxWidth: 740, fontSize: 34, lineHeight: 1.16, fontWeight: 500 }}>{caption}</p>
          <div style={{ width: 270, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 22, background: COLORS.teal, color: "#fff", padding: "17px 20px", fontSize: 22, fontWeight: 600, whiteSpace: "nowrap", boxShadow: "0 18px 42px rgba(35,141,157,0.24)" }}>
            Open AkibaMiles <ArrowRight size={22} weight="bold" />
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

const PhoneCanvas: React.FC<{ children: React.ReactNode; scale?: number; y?: number }> = ({ children, scale = 1, y = 0 }) => (
  <div
    style={{
      position: "absolute",
      left: "50%",
      top: 470 + y,
      width: 430,
      height: 930,
      transform: `translateX(-50%) scale(${scale})`,
      transformOrigin: "top center",
      borderRadius: 58,
      background: "#101318",
      padding: 15,
      boxShadow: "0 56px 120px rgba(17,24,39,0.24)",
    }}
  >
    <div style={{ position: "absolute", top: 15, left: "50%", transform: "translateX(-50%)", width: 132, height: 25, background: "#101318", borderRadius: "0 0 16px 16px", zIndex: 3 }} />
    <div style={{ width: "100%", height: "100%", borderRadius: 45, overflow: "hidden", background: "#F7FEFF" }}>
      {children}
    </div>
  </div>
);

const BottomNavMini: React.FC<{ active?: "earn" | "games" | "home" | "spend" }> = ({ active = "home" }) => {
  const items = [
    { key: "earn", label: "Earn", icon: "earn.svg" },
    { key: "games", label: "Games", icon: "gamepad-icon.svg" },
    { key: "home", label: "Home", icon: "home.svg", center: true },
    { key: "spend", label: "Spend", icon: "ticket-alt.svg" },
  ];

  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 78, background: "#fff", borderTop: "1px solid #E8F5F0", display: "flex", justifyContent: "space-around", alignItems: "center", padding: "0 18px" }}>
      {items.map((item) => {
        const on = item.key === active;
        return (
          <div key={item.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: on ? COLORS.teal : "#A0A0A0", fontSize: 12, fontWeight: on ? 600 : 500, transform: item.center ? "translateY(-14px)" : undefined }}>
            <div style={{ width: item.center ? 62 : 24, height: item.center ? 62 : 24, borderRadius: item.center ? 999 : 0, background: item.center ? COLORS.teal : "transparent", border: item.center ? `4px solid ${COLORS.teal}` : "none", display: "grid", placeItems: "center", boxShadow: item.center ? "0 8px 22px rgba(35,141,157,0.26)" : "none" }}>
              <Img src={staticFile(item.icon)} style={{ width: item.center ? 30 : 21, height: item.center ? 30 : 21, filter: item.center ? "brightness(0) invert(1)" : on ? "none" : "grayscale(1) opacity(0.7)" }} />
            </div>
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
};

const BalanceCard: React.FC = () => (
  <div style={{ margin: "24px 18px 0", borderRadius: 24, background: COLORS.teal, color: "#fff", overflow: "hidden", boxShadow: "0 18px 40px rgba(35,141,157,0.23)", position: "relative" }}>
    <Img src={staticFile("balance-card-bg.svg")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.58 }} />
    <div style={{ padding: 22, position: "relative" }}>
      <div style={{ fontSize: 15, fontWeight: 500 }}>Total AkibaMiles</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
        <Img src={staticFile("minimiles-symbol-alt.svg")} style={{ width: 38, height: 38 }} />
        <div style={{ fontSize: 42, fontWeight: 600, letterSpacing: -0.5 }}>12,340</div>
      </div>
    </div>
    <div style={{ background: "#fff", padding: 16, borderRadius: "22px 22px 0 0", position: "relative" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <ActionButton icon="earn.svg" label="Earn" />
        <ActionButton icon="ticket-alt.svg" label="Spend" solid />
      </div>
      <div style={{ marginTop: 12, color: COLORS.teal, fontSize: 16, fontWeight: 600, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Img src={staticFile("transcript.svg")} style={{ width: 22, height: 22 }} /> View History
      </div>
    </div>
  </div>
);

const ActionButton: React.FC<{ icon: string; label: string; solid?: boolean }> = ({ icon, label, solid }) => (
  <div style={{ height: 52, borderRadius: 16, background: solid ? COLORS.teal : "rgba(35,141,157,0.10)", color: solid ? "#fff" : COLORS.teal, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 16, fontWeight: 600 }}>
    <Img src={staticFile(icon)} style={{ width: 24, height: 24, filter: solid ? "brightness(0) invert(1)" : "none" }} />
    {label}
  </div>
);

const ChallengeCard: React.FC<{ icon: string; title: string; meta: string; reward: number; color?: string }> = ({ icon, title, meta, reward, color = "#DCFCE7" }) => (
  <div style={{ minWidth: 168, borderRadius: 18, padding: 16, background: color, boxShadow: "0 8px 22px rgba(17,24,39,0.07)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <Img src={staticFile(icon)} style={{ width: 27, height: 27 }} />
      <MilesAmount value={`+${reward}`} size={16} className="text-[#238D9D] font-bold" />
    </div>
    <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.1 }}>{title}</div>
    <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 6 }}>{meta}</div>
  </div>
);

const HomeComponentShot: React.FC = () => (
  <div style={{ position: "relative", width: "100%", height: "100%", paddingTop: 34, background: "#F7FEFF", overflow: "hidden" }}>
    <BalanceCard />
    <div style={{ padding: "26px 18px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 600 }}>Daily challenges</div>
      <div style={{ fontSize: 14, color: COLORS.teal, fontWeight: 600 }}>See all</div>
    </div>
    <div style={{ display: "flex", gap: 12, padding: "12px 18px" }}>
      <ChallengeCard icon="streak.svg" title="Daily streak" meta="Day 4 active" reward={50} />
      <ChallengeCard icon="check-icon.svg" title="Complete task" meta="Partner quest" reward={20} color="#E7FBEF" />
    </div>
    <BottomNavMini active="home" />
  </div>
);

const GamesComponentShot: React.FC = () => (
  <div style={{ width: "100%", height: "100%", background: "#F7FEFF", overflow: "hidden" }}>
    <div style={{ padding: "38px 18px 22px", color: "#fff", background: `linear-gradient(135deg, ${COLORS.deep}, ${COLORS.teal}, #2CBDD4)`, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 150, height: 150, borderRadius: 999, background: "rgba(255,255,255,0.12)", right: -45, top: -35 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600 }}>
        <Img src={staticFile("minimiles-symbol-alt.svg")} style={{ width: 24, height: 24 }} /> AkibaMiles
      </div>
      <div style={{ marginTop: 12, display: "inline-flex", gap: 7, alignItems: "center", background: "rgba(255,255,255,0.18)", borderRadius: 999, padding: "6px 10px", fontSize: 12, fontWeight: 600 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: COLORS.green }} /> Skill Games · Live
      </div>
      <div style={{ marginTop: 10, fontSize: 33, lineHeight: 1, fontWeight: 600 }}>Play & Earn</div>
      <div style={{ marginTop: 7, fontSize: 15, opacity: 0.82 }}>Short skill rounds. Verified rewards.</div>
    </div>
    <div style={{ padding: 18 }}>
      <div style={{ fontSize: 12, letterSpacing: 3, color: COLORS.soft, fontWeight: 600, marginBottom: 12 }}>CHOOSE A GAME</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <SkillGameCard config={RULE_TAP_CONFIG} />
        <SkillGameCard config={MEMORY_CONFIG} />
      </div>
    </div>
    <BottomNavMini active="games" />
  </div>
);

const RuleTapShot: React.FC = () => (
  <div style={{ width: "100%", height: "100%", background: "#F7FEFF", paddingTop: 32 }}>
    <div style={{ margin: "0 16px 12px", borderRadius: 24, background: `linear-gradient(135deg, ${COLORS.deep}, ${COLORS.teal})`, padding: 18, color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, opacity: 0.75 }}>Skill Game · 20s</div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>Rule Tap</div>
        </div>
        <Lightning size={36} weight="fill" color="#FACC15" />
      </div>
    </div>
    <RuleTapScorePanel score={14} mistakes={1} remainingMs={9300} combo={3} lastDelta={2} />
    <div style={{ height: 10 }} />
    <RuleBanner rule={RULE} />
    <div style={{ height: 14 }} />
    <RuleTapBoard activeTiles={RULE_TILES} feedback={{ 0: "good", 6: "bad" }} onTap={() => undefined} />
  </div>
);

const MemoryShot: React.FC = () => (
  <div style={{ width: "100%", height: "100%", background: "#F7F4FF", paddingTop: 32 }}>
    <div style={{ margin: "0 16px 12px", borderRadius: 24, background: "linear-gradient(135deg, #3B1F6E, #7B4CC0)", padding: 18, color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, opacity: 0.75 }}>Skill Game · 60s</div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>Memory Flip</div>
        </div>
        <Brain size={36} weight="fill" color="#DDD6FE" />
      </div>
    </div>
    <MemoryStats score={640} moves={18} matches={5} remainingMs={27000} />
    <div style={{ height: 16 }} />
    <MemoryGrid deck={MEMORY_DECK} revealed={new Set([0, 1, 8, 9])} matched={new Set([0, 9])} onFlip={() => undefined} />
  </div>
);

const ResultCard: React.FC = () => (
  <div style={{ width: 430, borderRadius: 34, background: "#fff", padding: 26, boxShadow: "0 34px 90px rgba(17,24,39,0.18)", border: `1px solid ${COLORS.line}` }}>
    <div style={{ textAlign: "center" }}>
      <div style={{ width: 74, height: 74, margin: "0 auto", borderRadius: 999, background: "rgba(35,141,157,0.10)", display: "grid", placeItems: "center" }}>
        <ShieldCheck size={42} weight="duotone" color={COLORS.teal} />
      </div>
      <div style={{ marginTop: 14, color: COLORS.teal, fontSize: 13, letterSpacing: 2.2, fontWeight: 600 }}>VERIFIED RESULT</div>
      <div style={{ marginTop: 8, fontSize: 42, fontWeight: 600 }}>Score 18</div>
      <div style={{ marginTop: 8, fontSize: 18, color: COLORS.muted }}>Replay checked. Reward ready.</div>
    </div>
    <div style={{ marginTop: 22, borderRadius: 24, background: `linear-gradient(135deg, ${COLORS.deep}, ${COLORS.teal})`, color: "#fff", padding: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ opacity: 0.75, fontSize: 13 }}>Reward</div>
        <div style={{ fontSize: 28, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <MilesAmount value="+35" size={27} variant="alt" /> + $0.25
        </div>
      </div>
      <CheckCircle size={42} weight="fill" color={COLORS.green} />
    </div>
  </div>
);

const FloatingTag: React.FC<{ icon: React.ReactNode; text: string; style?: React.CSSProperties }> = ({ icon, text, style }) => (
  <div style={{ position: "absolute", borderRadius: 999, background: "#fff", border: `1px solid ${COLORS.line}`, padding: "13px 17px", display: "flex", alignItems: "center", gap: 10, color: COLORS.teal, fontSize: 19, fontWeight: 600, boxShadow: "0 16px 36px rgba(35,141,157,0.14)", ...style }}>
    {icon}
    {text}
  </div>
);

const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const cardScale = interpolate(frame, [0, 70, 110], [0.94, 1, 1.04], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  return (
    <SceneShell
      eyebrow="AkibaMiles Office Hours"
      title={<>What are<br />AkibaMiles?</>}
      caption="A fast product explainer for the rewards loop inside AkibaMiles."
    >
      <div style={{ position: "absolute", left: 92, right: 92, top: 540, height: 660 }}>
        <div style={{ transform: `scale(${cardScale})`, transformOrigin: "center", position: "absolute", left: 145, top: 40 }}>
          <ResultCard />
        </div>
        <FloatingTag icon={<Lightning size={24} weight="fill" />} text="Earn" style={{ left: 40, top: 70 }} />
        <FloatingTag icon={<GameController size={24} weight="fill" />} text="Play" style={{ right: 20, top: 235 }} />
        <FloatingTag icon={<Ticket size={24} weight="fill" />} text="Use rewards" style={{ left: 20, bottom: 108 }} />
      </div>
    </SceneShell>
  );
};

const BalanceScene: React.FC = () => (
  <SceneShell eyebrow="Balance" title={<>Miles start with<br />your balance.</>} caption="Earn points, track progress, and jump into the next action without leaving the app.">
    <PhoneCanvas scale={1.18} y={-8}>
      <HomeComponentShot />
    </PhoneCanvas>
  </SceneShell>
);

const GamesScene: React.FC = () => (
  <SceneShell eyebrow="New games" title={<>Two skill games.<br />Built for quick sessions.</>} caption="Rule Tap and Memory Flip are short, repeatable, and easy to understand from the first play.">
    <PhoneCanvas scale={1.12} y={-12}>
      <GamesComponentShot />
    </PhoneCanvas>
  </SceneShell>
);

const RuleTapScene: React.FC = () => (
  <SceneShell eyebrow="Rule Tap" title={<>Read the rule.<br />Tap with skill.</>} caption="Not just tapping highlighted tiles. The player has to follow rules and avoid traps.">
    <PhoneCanvas scale={1.15} y={-18}>
      <RuleTapShot />
    </PhoneCanvas>
  </SceneShell>
);

const MemoryScene: React.FC = () => (
  <SceneShell eyebrow="Memory Flip" title={<>Match pairs.<br />Beat the clock.</>} caption="Clean, casual, mobile-first gameplay with moves, matches, timer, and score.">
    <PhoneCanvas scale={1.15} y={-18}>
      <MemoryShot />
    </PhoneCanvas>
  </SceneShell>
);

const VerificationScene: React.FC = () => (
  <SceneShell eyebrow="Verified rewards" title={<>Play fast.<br />Settle fairly.</>} caption="Gameplay stays smooth. Sessions, verifier checks, and rewards follow the onchain-backed flow.">
    <div style={{ position: "absolute", left: 112, right: 112, top: 560, display: "flex", justifyContent: "center" }}>
      <ResultCard />
    </div>
    <FloatingTag icon={<Clock size={24} weight="duotone" />} text="20s session" style={{ left: 96, top: 860 }} />
    <FloatingTag icon={<ShieldCheck size={24} weight="duotone" />} text="Replay verified" style={{ right: 92, top: 650 }} />
    <FloatingTag icon={<Trophy size={24} weight="duotone" />} text="Best score counts" style={{ right: 118, top: 1010 }} />
  </SceneShell>
);

const CtaScene: React.FC = () => (
  <SceneShell eyebrow="Your next play" title={<>Open AkibaMiles.<br />Try the new games.</>} caption="Drop your next Office Hours question in the comments.">
    <div style={{ position: "absolute", top: 560, left: 88, right: 88, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
      {[
        { icon: <Sparkle size={34} weight="fill" color={COLORS.teal} />, label: "Earn Miles", sub: "Challenges and activities" },
        { icon: <GameController size={34} weight="fill" color={COLORS.teal} />, label: "Play games", sub: "Rule Tap + Memory Flip" },
        { icon: <Trophy size={34} weight="fill" color={COLORS.teal} />, label: "Win rewards", sub: "Miles + bonus prizes" },
      ].map((item) => (
        <div key={item.label} style={{ minHeight: 270, borderRadius: 30, background: "#fff", border: `1px solid ${COLORS.line}`, boxShadow: "0 24px 64px rgba(35,141,157,0.12)", padding: 24, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ width: 68, height: 68, borderRadius: 22, background: "rgba(35,141,157,0.10)", display: "grid", placeItems: "center" }}>{item.icon}</div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.05 }}>{item.label}</div>
            <div style={{ marginTop: 8, fontSize: 17, color: COLORS.muted, lineHeight: 1.2 }}>{item.sub}</div>
          </div>
        </div>
      ))}
    </div>
    <div style={{ position: "absolute", left: 220, right: 220, top: 1010, borderRadius: 32, background: COLORS.teal, color: "#fff", padding: "24px 30px", display: "flex", justifyContent: "center", alignItems: "center", gap: 14, fontSize: 34, fontWeight: 600, boxShadow: "0 28px 70px rgba(35,141,157,0.30)" }}>
      Open AkibaMiles <ArrowRight size={34} weight="bold" />
    </div>
  </SceneShell>
);

export const AkibaMilesOfficeHoursProducerCut: React.FC = () => {
  return (
    <>
      <Sequence durationInFrames={150}>
        <HookScene />
      </Sequence>
      <Sequence from={150} durationInFrames={210}>
        <BalanceScene />
      </Sequence>
      <Sequence from={360} durationInFrames={210}>
        <GamesScene />
      </Sequence>
      <Sequence from={570} durationInFrames={210}>
        <RuleTapScene />
      </Sequence>
      <Sequence from={780} durationInFrames={210}>
        <MemoryScene />
      </Sequence>
      <Sequence from={990} durationInFrames={180}>
        <VerificationScene />
      </Sequence>
      <Sequence from={1170} durationInFrames={180}>
        <CtaScene />
      </Sequence>
    </>
  );
};
