import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";

export const Scene2Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ease = Easing.bezier(0.16, 1, 0.3, 1);
  const fi = (s: number, e: number) =>
    interpolate(frame, [s * fps, e * fps], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const su = (s: number, e: number, d = 40) =>
    interpolate(frame, [s * fps, e * fps], [d, 0], { extrapolateRight: "clamp", extrapolateLeft: "clamp", easing: ease });

  const GameCard = ({
    emoji, title, subtitle, reward, rewardColor, gradient, shadow, delay,
  }: {
    emoji: string; title: string; subtitle: string;
    reward: string; rewardColor: string; gradient: string; shadow: string; delay: number;
  }) => (
    <div style={{
      borderRadius: 32, overflow: "hidden",
      background: gradient,
      boxShadow: shadow,
      padding: "0 52px",
      height: 320,
      display: "flex",
      alignItems: "center",
      position: "relative",
      opacity: fi(delay, delay + 0.7),
      transform: `translateY(${su(delay, delay + 0.7, 50)}px)`,
    }}>
      <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
      <div style={{ position: "absolute", bottom: -30, right: 80, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <span style={{ fontSize: 48 }}>{emoji}</span>
            <span style={{ color: "white", fontSize: 44, fontWeight: 800, fontFamily: "system-ui, sans-serif" }}>{title}</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 26, fontFamily: "system-ui, sans-serif" }}>{subtitle}</div>
        </div>
        <div style={{ textAlign: "right", marginLeft: 24, flexShrink: 0 }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 22, fontFamily: "system-ui, sans-serif" }}>Up to</div>
          <div style={{ color: rewardColor, fontSize: 56, fontWeight: 800, fontFamily: "system-ui, sans-serif", lineHeight: 1 }}>{reward}</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 22, fontFamily: "system-ui, sans-serif" }}>Miles</div>
        </div>
      </div>
    </div>
  );

  return (
    <AbsoluteFill style={{ background: "linear-gradient(170deg, #050E1C 0%, #091A30 40%, #0D3040 70%, #050E1C 100%)" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 900px 600px at 50% 45%, rgba(35,141,157,0.14) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* HEADLINE — top */}
      <div style={{
        position: "absolute", top: 260, left: 60, right: 60, textAlign: "center",
        opacity: fi(0, 0.7),
        transform: `translateY(${su(0, 0.7, -24)}px)`,
      }}>
        <div style={{ color: "white", fontSize: 80, fontWeight: 800, fontFamily: "system-ui, sans-serif", lineHeight: 1.0 }}>Play &amp; Earn</div>
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 30, fontFamily: "system-ui, sans-serif", marginTop: 18, lineHeight: 1.5 }}>
          Short skill rounds · On-chain entry<br />Verifier-backed rewards
        </div>
      </div>

      {/* GAME CARDS — center */}
      <div style={{ position: "absolute", top: 840, left: 60, right: 60, display: "flex", flexDirection: "column", gap: 40 }}>
        <GameCard
          emoji="⚡" title="Rule Tap" subtitle="Tap only the correct shape"
          reward="35" rewardColor="#F59E0B"
          gradient="linear-gradient(135deg, #0A6070 0%, #238D9D 55%, #1AABBD 100%)"
          shadow="0 12px 50px rgba(35,141,157,0.4)"
          delay={0.3}
        />
        <GameCard
          emoji="🧠" title="Memory Flip" subtitle="Match pairs before time runs out"
          reward="20" rewardColor="#C084FC"
          gradient="linear-gradient(135deg, #2D1558 0%, #5B35A0 55%, #7B4CC0 100%)"
          shadow="0 12px 50px rgba(91,53,160,0.4)"
          delay={0.6}
        />
      </div>

      {/* STAT STRIP */}
      <div style={{
        position: "absolute", top: 1600, left: 0, right: 0,
        display: "flex", justifyContent: "center", gap: 0,
        opacity: fi(0.9, 1.7),
        transform: `translateY(${su(0.9, 1.7, 30)}px)`,
      }}>
        {[
          { label: "Entry fee", value: "5 Miles" },
          { label: "Duration", value: "20–60s" },
          { label: "Verified", value: "On-chain" },
        ].map(({ label, value }, i) => (
          <div key={label} style={{
            textAlign: "center", flex: 1,
            borderRight: i < 2 ? "1px solid rgba(255,255,255,0.08)" : "none",
            padding: "0 20px",
          }}>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 20, fontFamily: "system-ui, sans-serif", textTransform: "uppercase", letterSpacing: 2 }}>{label}</div>
            <div style={{ color: "white", fontSize: 30, fontWeight: 700, fontFamily: "system-ui, sans-serif", marginTop: 6 }}>{value}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
