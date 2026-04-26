import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig, staticFile, Easing } from "remotion";

export const Scene1BrandIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ease = Easing.bezier(0.16, 1, 0.3, 1);
  const spring = Easing.bezier(0.34, 1.56, 0.64, 1);

  const fi = (s: number, e: number) =>
    interpolate(frame, [s * fps, e * fps], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const su = (s: number, e: number, d = 40) =>
    interpolate(frame, [s * fps, e * fps], [d, 0], { extrapolateRight: "clamp", extrapolateLeft: "clamp", easing: ease });

  const ringScale = interpolate(frame, [0, 2 * fps], [0.6, 1.5], { extrapolateRight: "clamp" });
  const ringOp = interpolate(frame, [0, 2 * fps], [0.5, 0], { extrapolateRight: "clamp" });
  const ring2Scale = interpolate(frame, [0.5 * fps, 2.5 * fps], [0.6, 1.5], { extrapolateRight: "clamp" });
  const ring2Op = interpolate(frame, [0.5 * fps, 2.5 * fps], [0.35, 0], { extrapolateRight: "clamp" });
  const logoScale = interpolate(frame, [0.1 * fps, 0.9 * fps], [0.6, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp", easing: spring });

  return (
    <AbsoluteFill style={{ background: "linear-gradient(170deg, #050E1C 0%, #091A30 40%, #0D3040 70%, #050E1C 100%)" }}>
      {/* Glows */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 900px 700px at 50% 40%, rgba(35,141,157,0.2) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 700px 500px at 50% 80%, rgba(91,53,160,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* LIVE BADGE — top */}
      <div style={{
        position: "absolute", top: 160, left: 0, right: 0,
        display: "flex", justifyContent: "center",
        opacity: fi(0.2, 0.9),
        transform: `translateY(${su(0.2, 0.9, -20)}px)`,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 40, padding: "14px 32px",
        }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#4EFFA0", boxShadow: "0 0 10px #4EFFA0", display: "inline-block" }} />
          <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 28, fontFamily: "system-ui, sans-serif", fontWeight: 600 }}>Skill Games · Live</span>
        </div>
      </div>

      {/* LOGO — upper-center */}
      <div style={{
        position: "absolute", top: 320, left: 0, right: 0,
        display: "flex", justifyContent: "center",
        opacity: fi(0.1, 0.8),
        transform: `scale(${logoScale})`,
      }}>
        <div style={{ position: "relative", width: 380, height: 380, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(35,141,157,0.5)", transform: `scale(${ringScale})`, opacity: ringOp }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(35,141,157,0.3)", transform: `scale(${ring2Scale})`, opacity: ring2Op }} />
          <div style={{
            width: 300, height: 300, borderRadius: "50%",
            background: "rgba(35,141,157,0.1)", border: "2px solid rgba(35,141,157,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 100px rgba(35,141,157,0.25)",
          }}>
            <Img src={staticFile("akibamiles-logo.svg")} style={{ width: 196, height: 196 }} />
          </div>
        </div>
      </div>

      {/* WORDMARK — just below logo */}
      <div style={{
        position: "absolute", top: 760, left: 0, right: 0, textAlign: "center",
        opacity: fi(0.3, 1.0),
        transform: `translateY(${su(0.3, 1.0, 20)}px)`,
      }}>
        <div style={{ color: "white", fontSize: 84, fontWeight: 800, fontFamily: "system-ui, sans-serif", letterSpacing: -2, lineHeight: 1 }}>AkibaMiles</div>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 28, fontFamily: "system-ui, sans-serif", fontWeight: 400, marginTop: 14, letterSpacing: 5, textTransform: "uppercase" }}>Earn with every tap</div>
      </div>

      {/* TAGLINE — lower section */}
      <div style={{
        position: "absolute", top: 1020, left: 60, right: 60, textAlign: "center",
        opacity: fi(1.0, 2.0),
        transform: `translateY(${su(1.0, 2.0, 50)}px)`,
      }}>
        <div style={{ color: "white", fontSize: 58, fontWeight: 800, fontFamily: "system-ui, sans-serif", lineHeight: 1.2 }}>
          New on <span style={{ color: "#3ECFDF" }}>AkibaMiles:</span>
        </div>
        <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 32, fontFamily: "system-ui, sans-serif", fontWeight: 400, marginTop: 16, lineHeight: 1.4 }}>
          Skill games built for quick wins
        </div>
      </div>

      {/* STAT PILLS — bottom */}
      <div style={{
        position: "absolute", bottom: 220, left: 0, right: 0,
        display: "flex", justifyContent: "center", gap: 24,
        opacity: fi(1.5, 2.5),
        transform: `translateY(${su(1.5, 2.5, 30)}px)`,
      }}>
        {[
          { label: "2 Games", color: "#238D9D" },
          { label: "Up to 35 Miles", color: "#F59E0B" },
          { label: "On-chain", color: "#4EFFA0" },
        ].map(({ label, color }) => (
          <div key={label} style={{
            background: "rgba(255,255,255,0.06)", border: `1px solid ${color}40`,
            borderRadius: 40, padding: "12px 28px",
            color, fontSize: 24, fontFamily: "system-ui, sans-serif", fontWeight: 600,
          }}>{label}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
