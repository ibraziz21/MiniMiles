import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig, staticFile, Easing } from "remotion";

const TRUST_ITEMS = [
  { icon: "verified-badge.svg",  title: "Sessions Verified",  sub: "Every replay is checked on Celo",           accent: "#3ECFDF", bg: "rgba(35,141,157,0.1)",  border: "rgba(35,141,157,0.25)",  delay: 0.1 },
  { icon: "onchain-badge.svg",   title: "Best Score Counts",  sub: "Daily + weekly leaderboards",               accent: "#A855F7", bg: "rgba(91,53,160,0.1)",   border: "rgba(91,53,160,0.25)",   delay: 0.3 },
  { icon: "trophy-icon.svg",     title: "Weekly Prizes",      sub: "USDT + Miles for top players",              accent: "#F59E0B", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)",  delay: 0.5 },
  { icon: "usdt-token.svg",      title: "Real Rewards",       sub: "Miles + USDT settle through AkibaMiles",   accent: "#31C76A", bg: "rgba(49,199,106,0.08)", border: "rgba(49,199,106,0.25)",  delay: 0.7 },
];

export const Scene5Trust: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ease = Easing.bezier(0.16, 1, 0.3, 1);
  const fi = (s: number, e: number) =>
    interpolate(frame, [s * fps, e * fps], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const su = (s: number, e: number, d = 40) =>
    interpolate(frame, [s * fps, e * fps], [d, 0], { extrapolateRight: "clamp", extrapolateLeft: "clamp", easing: ease });

  return (
    <AbsoluteFill style={{ background: "linear-gradient(170deg, #050E1C 0%, #091A30 40%, #050E1C 100%)" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 800px 700px at 50% 40%, rgba(35,141,157,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* HEADLINE */}
      <div style={{
        position: "absolute", top: 160, left: 60, right: 60, textAlign: "center",
        opacity: fi(0, 0.7),
        transform: `translateY(${su(0, 0.7, -20)}px)`,
      }}>
        <div style={{ color: "white", fontSize: 72, fontWeight: 800, fontFamily: "system-ui, sans-serif", lineHeight: 1.1 }}>
          Built on trust,
        </div>
        <div style={{ color: "#3ECFDF", fontSize: 72, fontWeight: 800, fontFamily: "system-ui, sans-serif", lineHeight: 1.1 }}>
          settled on-chain
        </div>
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 28, fontFamily: "system-ui, sans-serif", marginTop: 16 }}>
          Every session is fair, fast &amp; verifiable
        </div>
      </div>

      {/* TRUST CARDS — evenly spaced between headline and footer */}
      {TRUST_ITEMS.map(({ icon, title, sub, accent, bg, border, delay }, i) => (
        <div
          key={title}
          style={{
            position: "absolute",
            top: 490 + i * 290,
            left: 60, right: 60,
            height: 240,
            opacity: fi(delay, delay + 0.6),
            transform: `translateX(${interpolate(frame, [(delay) * fps, (delay + 0.6) * fps], [-60, 0], { extrapolateRight: "clamp", extrapolateLeft: "clamp", easing: ease })}px)`,
            background: bg,
            border: `1px solid ${border}`,
            borderRadius: 28,
            display: "flex",
            alignItems: "center",
            gap: 32,
            padding: "0 44px",
          }}
        >
          <div style={{
            width: 80, height: 80, borderRadius: 20,
            background: `${border}`,
            border: `1px solid ${border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <Img src={staticFile(icon)} style={{ width: 48, height: 48 }} />
          </div>
          <div>
            <div style={{ color: accent, fontSize: 34, fontWeight: 700, fontFamily: "system-ui, sans-serif", lineHeight: 1.2 }}>{title}</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 24, fontFamily: "system-ui, sans-serif", marginTop: 8 }}>{sub}</div>
          </div>
        </div>
      ))}

      {/* FOOTER BADGE */}
      <div style={{
        position: "absolute", bottom: 160, left: 0, right: 0,
        display: "flex", justifyContent: "center",
        opacity: fi(1.5, 2.2),
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 14,
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 40, padding: "16px 40px",
        }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#4EFFA0", display: "inline-block", boxShadow: "0 0 10px #4EFFA0" }} />
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 26, fontFamily: "system-ui, sans-serif", fontWeight: 600 }}>Powered by Celo blockchain</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
