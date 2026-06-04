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
  ChartLineUp,
  CheckCircle,
  CurrencyCircleDollar,
  GameController,
  Gift,
  HandCoins,
  Lightning,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Storefront,
  Ticket,
  UserPlus,
  Users,
  Wallet,
} from "@phosphor-icons/react";
import { MilesAmount } from "./game-components/miles-amount";

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

function useIn(start = 0) {
  const frame = useCurrentFrame();
  return {
    frame,
    opacity: interpolate(frame, [start, start + 18], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    }),
    y: interpolate(frame, [start, start + 22], [34, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    }),
  };
}

const BrandHeader: React.FC = () => (
  <div style={{ position: "absolute", top: 68, left: 68, right: 68, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 5 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 54, height: 54, borderRadius: 18, background: "#fff", display: "grid", placeItems: "center", boxShadow: "0 14px 30px rgba(35,141,157,0.14)" }}>
        <Img src={staticFile("minimiles-symbol.svg")} style={{ width: 34, height: 34 }} />
      </div>
      <div>
        <div style={{ fontSize: 13, letterSpacing: 2.5, color: COLORS.soft, fontWeight: 600 }}>AKIBAMILES</div>
        <div style={{ fontSize: 26, fontWeight: 600 }}>Office Hours</div>
      </div>
    </div>
    <div style={{ padding: "12px 18px", borderRadius: 999, background: "#fff", border: `1px solid ${COLORS.line}`, color: COLORS.teal, fontSize: 21, fontWeight: 600 }}>
      Episode 01
    </div>
  </div>
);

const SceneShell: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  caption: string;
  children: React.ReactNode;
}> = ({ eyebrow, title, caption, children }) => {
  const { opacity, y } = useIn();

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 16% 12%, rgba(173,244,255,0.86), transparent 26%), radial-gradient(circle at 84% 76%, rgba(35,141,157,0.12), transparent 30%), #F7FEFF",
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
      <BrandHeader />
      <div style={{ position: "absolute", top: 178, left: 68, right: 68, opacity, transform: `translateY(${y}px)`, zIndex: 2 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, background: "rgba(35,141,157,0.10)", color: COLORS.teal, padding: "10px 14px", fontSize: 18, fontWeight: 600, marginBottom: 20 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: COLORS.teal }} />
          {eyebrow}
        </div>
        <h1 style={{ margin: 0, fontSize: 73, lineHeight: 0.94, letterSpacing: -1, maxWidth: 900, fontWeight: 600 }}>{title}</h1>
      </div>
      {children}
      <div style={{ position: "absolute", left: 68, right: 68, bottom: 62, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 30, zIndex: 5 }}>
        <p style={{ margin: 0, maxWidth: 735, fontSize: 34, lineHeight: 1.16, fontWeight: 500 }}>{caption}</p>
        <div style={{ width: 270, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 22, background: COLORS.teal, color: "#fff", padding: "17px 20px", fontSize: 22, fontWeight: 600, whiteSpace: "nowrap", boxShadow: "0 18px 42px rgba(35,141,157,0.24)" }}>
          Open AkibaMiles <ArrowRight size={22} weight="bold" />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const PhoneCanvas: React.FC<{ children: React.ReactNode; scale?: number; top?: number }> = ({ children, scale = 1, top = 470 }) => (
  <div
    style={{
      position: "absolute",
      left: "50%",
      top,
      width: 430,
      height: 930,
      transform: `translateX(-50%) scale(${scale})`,
      transformOrigin: "top center",
      borderRadius: 58,
      background: "#101318",
      padding: 15,
      boxShadow: "0 56px 120px rgba(17,24,39,0.24)",
      zIndex: 3,
    }}
  >
    <div style={{ position: "absolute", top: 15, left: "50%", transform: "translateX(-50%)", width: 132, height: 25, background: "#101318", borderRadius: "0 0 16px 16px", zIndex: 3 }} />
    <div style={{ width: "100%", height: "100%", borderRadius: 45, overflow: "hidden", background: "#F7FEFF", position: "relative" }}>
      {children}
    </div>
  </div>
);

const ActionButton: React.FC<{ icon: string; label: string; solid?: boolean }> = ({ icon, label, solid }) => (
  <div style={{ height: 52, borderRadius: 16, background: solid ? COLORS.teal : "rgba(35,141,157,0.10)", color: solid ? "#fff" : COLORS.teal, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 16, fontWeight: 600 }}>
    <Img src={staticFile(icon)} style={{ width: 24, height: 24, filter: solid ? "brightness(0) invert(1)" : "none" }} />
    {label}
  </div>
);

const BalanceCard: React.FC<{ points?: string }> = ({ points = "12,340" }) => (
  <div style={{ borderRadius: 24, background: COLORS.teal, color: "#fff", overflow: "hidden", boxShadow: "0 18px 40px rgba(35,141,157,0.23)", position: "relative" }}>
    <Img src={staticFile("balance-card-bg.svg")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.58 }} />
    <div style={{ padding: 22, position: "relative" }}>
      <div style={{ fontSize: 15, fontWeight: 500 }}>Total AkibaMiles</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
        <Img src={staticFile("minimiles-symbol-alt.svg")} style={{ width: 38, height: 38 }} />
        <div style={{ fontSize: 42, fontWeight: 600, letterSpacing: -0.5 }}>{points}</div>
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

const BottomNavMini: React.FC<{ active?: "earn" | "home" | "spend" }> = ({ active = "home" }) => {
  const items = [
    { key: "earn", label: "Earn", icon: "earn.svg" },
    { key: "home", label: "Home", icon: "home.svg", center: true },
    { key: "spend", label: "Spend", icon: "ticket-alt.svg" },
  ];
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 78, background: "#fff", borderTop: "1px solid #E8F5F0", display: "flex", justifyContent: "space-around", alignItems: "center", padding: "0 34px" }}>
      {items.map((item) => {
        const on = item.key === active;
        return (
          <div key={item.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: on ? COLORS.teal : "#A0A0A0", fontSize: 12, fontWeight: on ? 600 : 500, transform: item.center ? "translateY(-14px)" : undefined }}>
            <div style={{ width: item.center ? 62 : 24, height: item.center ? 62 : 24, borderRadius: item.center ? 999 : 0, background: item.center ? COLORS.teal : "transparent", display: "grid", placeItems: "center", boxShadow: item.center ? "0 8px 22px rgba(35,141,157,0.26)" : "none" }}>
              <Img src={staticFile(item.icon)} style={{ width: item.center ? 30 : 21, height: item.center ? 30 : 21, filter: item.center ? "brightness(0) invert(1)" : on ? "none" : "grayscale(1) opacity(0.7)" }} />
            </div>
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
};

const Pill: React.FC<{ icon: React.ReactNode; label: string; value: string; style?: React.CSSProperties }> = ({ icon, label, value, style }) => (
  <div style={{ borderRadius: 26, background: "#fff", border: `1px solid ${COLORS.line}`, padding: 22, boxShadow: "0 22px 58px rgba(35,141,157,0.14)", ...style }}>
    <div style={{ width: 58, height: 58, borderRadius: 20, background: "rgba(35,141,157,0.10)", color: COLORS.teal, display: "grid", placeItems: "center" }}>{icon}</div>
    <div style={{ marginTop: 18, fontSize: 28, lineHeight: 1, fontWeight: 600 }}>{label}</div>
    <div style={{ marginTop: 8, fontSize: 18, color: COLORS.muted, lineHeight: 1.2 }}>{value}</div>
  </div>
);

const AppHomeShot: React.FC = () => (
  <div style={{ width: "100%", height: "100%", padding: "34px 18px 0", background: "#F7FEFF", position: "relative" }}>
    <BalanceCard />
    <div style={{ marginTop: 26, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 600 }}>Daily challenges</div>
      <div style={{ fontSize: 14, color: COLORS.teal, fontWeight: 600 }}>See all</div>
    </div>
    <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
      <MiniChallenge icon="streak.svg" title="Daily streak" reward={50} />
      <MiniChallenge icon="check-icon.svg" title="Partner task" reward={20} color="#E7FBEF" />
    </div>
    <BottomNavMini active="home" />
  </div>
);

const MiniChallenge: React.FC<{ icon: string; title: string; reward: number; color?: string }> = ({ icon, title, reward, color = "#DCFCE7" }) => (
  <div style={{ width: 180, borderRadius: 18, background: color, padding: 16, boxShadow: "0 10px 24px rgba(17,24,39,0.07)" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Img src={staticFile(icon)} style={{ width: 27, height: 27 }} />
      <MilesAmount value={`+${reward}`} size={16} className="text-[#238D9D] font-bold" />
    </div>
    <div style={{ marginTop: 16, fontSize: 18, fontWeight: 600, lineHeight: 1.05 }}>{title}</div>
    <div style={{ marginTop: 6, fontSize: 12, color: COLORS.muted }}>Active today</div>
  </div>
);

const EarnShot: React.FC = () => (
  <div style={{ width: "100%", height: "100%", background: "#F7FEFF", padding: "38px 18px 0", position: "relative" }}>
    <div style={{ fontSize: 28, fontWeight: 600 }}>Earn</div>
    <div style={{ marginTop: 8, fontSize: 15, color: COLORS.muted }}>Everyday actions become Miles.</div>
    <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <EarnCard icon={<Receipt size={25} weight="duotone" />} title="Transactions" reward={25} />
      <EarnCard icon={<UserPlus size={25} weight="duotone" />} title="Referrals" reward={100} />
      <EarnCard icon={<CheckCircle size={25} weight="duotone" />} title="Challenges" reward={50} />
      <EarnCard icon={<Storefront size={25} weight="duotone" />} title="Partners" reward={75} />
    </div>
    <div style={{ marginTop: 18, borderRadius: 22, background: COLORS.teal, color: "#fff", padding: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: 13, opacity: 0.75 }}>Today</div>
        <div style={{ fontSize: 25, fontWeight: 600 }}>+245 Miles earned</div>
      </div>
      <Img src={staticFile("minimiles-symbol-alt.svg")} style={{ width: 42, height: 42 }} />
    </div>
    <BottomNavMini active="earn" />
  </div>
);

const EarnCard: React.FC<{ icon: React.ReactNode; title: string; reward: number }> = ({ icon, title, reward }) => (
  <div style={{ minHeight: 138, borderRadius: 22, background: "#fff", border: `1px solid ${COLORS.line}`, padding: 16, boxShadow: "0 12px 26px rgba(35,141,157,0.08)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ width: 46, height: 46, borderRadius: 16, background: "rgba(35,141,157,0.10)", color: COLORS.teal, display: "grid", placeItems: "center" }}>{icon}</div>
      <MilesAmount value={`+${reward}`} size={15} className="text-[#238D9D] font-bold" />
    </div>
    <div style={{ marginTop: 18, fontSize: 18, fontWeight: 600 }}>{title}</div>
  </div>
);

const SpendShot: React.FC = () => (
  <div style={{ width: "100%", height: "100%", background: "#F7FEFF", padding: "38px 18px 0", position: "relative" }}>
    <div style={{ fontSize: 28, fontWeight: 600 }}>Spend</div>
    <div style={{ marginTop: 8, fontSize: 15, color: COLORS.muted }}>Use Miles across the reward marketplace.</div>
    <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <RewardCard icon={<Ticket size={28} weight="duotone" />} title="Raffles" cost="5-20 Miles" />
      <RewardCard icon={<Gift size={28} weight="duotone" />} title="Vouchers" cost="Merchant deals" />
      <RewardCard icon={<GameController size={28} weight="duotone" />} title="Games" cost="Skill rounds" />
      <RewardCard icon={<ShoppingBag size={28} weight="duotone" />} title="Rewards" cost="Real value" />
    </div>
    <div style={{ marginTop: 18, borderRadius: 22, background: "#fff", border: `1px solid ${COLORS.line}`, padding: 18, display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 50, height: 50, borderRadius: 16, background: "rgba(35,141,157,0.10)", display: "grid", placeItems: "center" }}>
        <Img src={staticFile("minimiles-symbol.svg")} style={{ width: 28, height: 28 }} />
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Miles become buying power</div>
        <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 3 }}>Rewards, commerce, and campaigns.</div>
      </div>
    </div>
    <BottomNavMini active="spend" />
  </div>
);

const RewardCard: React.FC<{ icon: React.ReactNode; title: string; cost: string }> = ({ icon, title, cost }) => (
  <div style={{ minHeight: 146, borderRadius: 22, background: "#fff", border: `1px solid ${COLORS.line}`, padding: 18, boxShadow: "0 12px 26px rgba(35,141,157,0.08)" }}>
    <div style={{ width: 50, height: 50, borderRadius: 17, background: "rgba(35,141,157,0.10)", color: COLORS.teal, display: "grid", placeItems: "center" }}>{icon}</div>
    <div style={{ marginTop: 18, fontSize: 21, fontWeight: 600 }}>{title}</div>
    <div style={{ marginTop: 5, fontSize: 13, color: COLORS.muted }}>{cost}</div>
  </div>
);

const HookScene: React.FC = () => {
  const { frame } = useIn();
  const scale = interpolate(frame, [0, 70, 125], [0.94, 1, 1.035], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return (
    <SceneShell
      eyebrow="What are AkibaMiles?"
      title={<>The incentive layer<br />for MiniPay.</>}
      caption="AkibaMiles turns useful user actions into measurable, rewardable progress."
    >
      <div style={{ position: "absolute", left: 88, right: 88, top: 560, height: 600 }}>
        <div style={{ position: "absolute", left: "50%", top: 140, transform: `translateX(-50%) scale(${scale})`, width: 340, height: 340, borderRadius: 999, background: `linear-gradient(135deg, ${COLORS.deep}, ${COLORS.teal})`, display: "grid", placeItems: "center", boxShadow: "0 42px 100px rgba(35,141,157,0.25)" }}>
          <div style={{ width: 190, height: 190, borderRadius: 999, background: "#fff", display: "grid", placeItems: "center" }}>
            <Img src={staticFile("minimiles-symbol.svg")} style={{ width: 124, height: 124 }} />
          </div>
        </div>
        <Pill icon={<Receipt size={30} weight="duotone" />} label="Transactions" value="+ Miles" style={{ position: "absolute", left: 0, top: 34, width: 245 }} />
        <Pill icon={<UserPlus size={30} weight="duotone" />} label="Referrals" value="+ Miles" style={{ position: "absolute", right: 0, top: 34, width: 245 }} />
        <Pill icon={<Ticket size={30} weight="duotone" />} label="Raffles" value="Spend Miles" style={{ position: "absolute", left: 0, bottom: 28, width: 245 }} />
        <Pill icon={<Storefront size={30} weight="duotone" />} label="Merchants" value="Redeem value" style={{ position: "absolute", right: 0, bottom: 28, width: 245 }} />
      </div>
    </SceneShell>
  );
};

const EarnScene: React.FC = () => (
  <SceneShell
    eyebrow="Earn"
    title={<>Every action can<br />become Miles.</>}
    caption="Transactions, referrals, challenges, and partner activities all feed the AkibaMiles balance."
  >
    <PhoneCanvas scale={1.15} top={455}>
      <EarnShot />
    </PhoneCanvas>
  </SceneShell>
);

const BalanceScene: React.FC = () => (
  <SceneShell
    eyebrow="Progress"
    title={<>A points balance<br />users understand.</>}
    caption="AkibaMiles gives users a simple reason to come back, complete actions, and keep moving."
  >
    <PhoneCanvas scale={1.18} top={455}>
      <AppHomeShot />
    </PhoneCanvas>
  </SceneShell>
);

const SpendScene: React.FC = () => (
  <SceneShell
    eyebrow="Spend"
    title={<>Use Miles on<br />real opportunities.</>}
    caption="Raffles, games, vouchers, merchant rewards, and campaigns sit inside one rewards loop."
  >
    <PhoneCanvas scale={1.15} top={455}>
      <SpendShot />
    </PhoneCanvas>
  </SceneShell>
);

const PartnerScene: React.FC = () => (
  <SceneShell
    eyebrow="Ecosystem value"
    title={<>Users get value.<br />Partners get activity.</>}
    caption="AkibaMiles helps partners drive transactions, retention, and measurable engagement."
  >
    <div style={{ position: "absolute", left: 84, right: 84, top: 580, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <ValuePanel
        icon={<Users size={42} weight="duotone" />}
        title="For users"
        body="Earn points from everyday financial and digital actions, then redeem them for useful rewards."
        stats={[
          ["Challenges", "+50 Miles"],
          ["Referrals", "+100 Miles"],
          ["Raffles", "5-20 Miles"],
        ]}
      />
      <ValuePanel
        icon={<ChartLineUp size={42} weight="duotone" />}
        title="For partners"
        body="Turn campaigns into transaction volume, repeat engagement, and clear performance signals."
        stats={[
          ["Retention", "Repeat actions"],
          ["Commerce", "Merchant redemption"],
          ["Growth", "Measurable incentives"],
        ]}
      />
    </div>
  </SceneShell>
);

const ValuePanel: React.FC<{ icon: React.ReactNode; title: string; body: string; stats: Array<[string, string]> }> = ({ icon, title, body, stats }) => (
  <div style={{ minHeight: 520, borderRadius: 34, background: "#fff", border: `1px solid ${COLORS.line}`, padding: 30, boxShadow: "0 32px 86px rgba(35,141,157,0.14)" }}>
    <div style={{ width: 78, height: 78, borderRadius: 26, background: "rgba(35,141,157,0.10)", color: COLORS.teal, display: "grid", placeItems: "center" }}>{icon}</div>
    <div style={{ marginTop: 28, fontSize: 38, fontWeight: 600, lineHeight: 1 }}>{title}</div>
    <div style={{ marginTop: 14, fontSize: 22, lineHeight: 1.25, color: COLORS.muted }}>{body}</div>
    <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12 }}>
      {stats.map(([label, value]) => (
        <div key={label} style={{ borderRadius: 18, background: "#F7FEFF", border: `1px solid ${COLORS.line}`, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 18 }}>
          <span style={{ color: COLORS.muted }}>{label}</span>
          <span style={{ color: COLORS.teal, fontWeight: 600 }}>{value}</span>
        </div>
      ))}
    </div>
  </div>
);

const ProofScene: React.FC = () => (
  <SceneShell
    eyebrow="Reward loop"
    title={<>Earn. Spend.<br />Repeat.</>}
    caption="The loop is simple for users, but powerful for digital economies."
  >
    <div style={{ position: "absolute", left: 86, right: 86, top: 610, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
      {[
        { icon: <Lightning size={36} weight="fill" />, title: "Earn", body: "Transactions, referrals, challenges" },
        { icon: <Wallet size={36} weight="fill" />, title: "Balance", body: "Progress users can see" },
        { icon: <HandCoins size={36} weight="fill" />, title: "Redeem", body: "Raffles, games, vouchers, merchants" },
      ].map((item) => (
        <div key={item.title} style={{ minHeight: 310, borderRadius: 30, background: "#fff", border: `1px solid ${COLORS.line}`, padding: 24, boxShadow: "0 24px 64px rgba(35,141,157,0.12)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ width: 70, height: 70, borderRadius: 24, background: "rgba(35,141,157,0.10)", color: COLORS.teal, display: "grid", placeItems: "center" }}>{item.icon}</div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 600 }}>{item.title}</div>
            <div style={{ marginTop: 8, fontSize: 18, lineHeight: 1.2, color: COLORS.muted }}>{item.body}</div>
          </div>
        </div>
      ))}
    </div>
    <div style={{ position: "absolute", left: 245, right: 245, top: 1010, borderRadius: 30, background: COLORS.teal, color: "#fff", padding: "22px 26px", fontSize: 31, fontWeight: 600, display: "flex", justifyContent: "center", alignItems: "center", gap: 12, boxShadow: "0 28px 70px rgba(35,141,157,0.30)" }}>
      Start earning <ArrowRight size={30} weight="bold" />
    </div>
  </SceneShell>
);

const CtaScene: React.FC = () => (
  <SceneShell
    eyebrow="Start earning"
    title={<>Open AkibaMiles.<br />Turn actions into value.</>}
    caption="AkibaMiles is the incentive layer for digital economies inside MiniPay."
  >
    <div style={{ position: "absolute", left: 122, right: 122, top: 585 }}>
      <BalanceCard points="12,340" />
    </div>
    <div style={{ position: "absolute", left: 140, right: 140, top: 975, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      <div style={{ borderRadius: 24, background: "#fff", border: `1px solid ${COLORS.line}`, padding: 22, display: "flex", alignItems: "center", gap: 16, boxShadow: "0 20px 50px rgba(35,141,157,0.12)" }}>
        <ShieldCheck size={36} weight="duotone" color={COLORS.teal} />
        <div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>Verified actions</div>
          <div style={{ color: COLORS.muted, fontSize: 15 }}>Rewardable behavior</div>
        </div>
      </div>
      <div style={{ borderRadius: 24, background: "#fff", border: `1px solid ${COLORS.line}`, padding: 22, display: "flex", alignItems: "center", gap: 16, boxShadow: "0 20px 50px rgba(35,141,157,0.12)" }}>
        <CurrencyCircleDollar size={36} weight="duotone" color={COLORS.teal} />
        <div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>Real rewards</div>
          <div style={{ color: COLORS.muted, fontSize: 15 }}>Raffles, vouchers, commerce</div>
        </div>
      </div>
    </div>
  </SceneShell>
);

export const AkibaMilesOfficeHoursIncentiveLayer: React.FC = () => {
  return (
    <>
      <Sequence durationInFrames={150}>
        <HookScene />
      </Sequence>
      <Sequence from={150} durationInFrames={210}>
        <EarnScene />
      </Sequence>
      <Sequence from={360} durationInFrames={180}>
        <BalanceScene />
      </Sequence>
      <Sequence from={540} durationInFrames={210}>
        <SpendScene />
      </Sequence>
      <Sequence from={750} durationInFrames={210}>
        <PartnerScene />
      </Sequence>
      <Sequence from={960} durationInFrames={180}>
        <ProofScene />
      </Sequence>
      <Sequence from={1140} durationInFrames={210}>
        <CtaScene />
      </Sequence>
    </>
  );
};
