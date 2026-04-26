import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig, staticFile, Easing } from "remotion";

export const Scene6CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ease = Easing.bezier(0.16, 1, 0.3, 1);
  const spring = Easing.bezier(0.34, 1.56, 0.64, 1);

  const fi = (s: number, e: number) =>
    interpolate(frame, [s * fps, e * fps], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const su = (s: number, e: number, d = 40) =>
    interpolate(frame, [s * fps, e * fps], [d, 0], { extrapolateRight: "clamp", extrapolateLeft: "clamp", easing: ease });

  const glowPulse = 0.9 + 0.15 * Math.sin((frame / fps) * Math.PI);
  const btnPulse = frame >= 1.5 * fps
    ? 1 + 0.03 * Math.sin((frame / fps) * Math.PI * 1.5)
    : 1;

  const logoScale = interpolate(frame, [0, 0.8 * fps], [0.6, 1], { extrapolateRight: "clamp", easing: spring });

  // Particles
  const pY = (speed: number) => interpolate(frame, [0, 4 * fps], [0, -speed], { extrapolateRight: "clamp" });
  const pOp = fi(0.3, 1.2);

  return (
    <AbsoluteFill style={{ background: "linear-gradient(170deg, #040C1A 0%, #071525 40%, #091C32 70%, #040C1A 100%)" }}>
      {/* Radial glow */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse ${glowPulse * 800}px ${glowPulse * 700}px at 50% 48%, rgba(35,141,157,0.22) 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      {/* Floating particles */}
      {[
        { x: 120, y: 600, dy: pY(60), s: 10, c: "#238D9D" },
        { x: 900, y: 800, dy: pY(40), s: 7,  c: "#F59E0B" },
        { x: 200, y: 1300, dy: pY(50), s: 6, c: "#5B35A0" },
        { x: 820, y: 500, dy: pY(35), s: 5,  c: "#3ECFDF" },
        { x: 520, y: 1500, dy: pY(45), s: 8, c: "#31C76A" },
        { x: 700, y: 1100, dy: pY(30), s: 4, c: "#A855F7" },
      ].map(({ x, y, dy, s, c }, i) => (
        <div key={i} style={{
          position: "absolute", left: x, top: y + dy,
          width: s, height: s, borderRadius: "50%",
          background: c, opacity: pOp * 0.55,
          boxShadow: `0 0 ${s * 2}px ${c}`,
        }} />
      ))}

      {/* LOGO — upper center */}
      <div style={{
        position: "absolute", top: 220, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
        opacity: fi(0, 0.8),
        transform: `scale(${logoScale})`,
      }}>
        <div style={{
          width: 300, height: 300, borderRadius: "50%",
          background: "rgba(35,141,157,0.1)", border: "2px solid rgba(35,141,157,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 80px rgba(35,141,157,0.25)",
        }}>
          <Img src={staticFile("akibamiles-logo.svg")} style={{ width: 190, height: 190 }} />
        </div>
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 26, fontFamily: "system-ui, sans-serif", letterSpacing: 5, textTransform: "uppercase" }}>
          AkibaMiles
        </div>
      </div>

      {/* MAIN CTA TEXT — center */}
      <div style={{
        position: "absolute", top: 860, left: 60, right: 60, textAlign: "center",
        opacity: fi(0.4, 1.1),
        transform: `translateY(${su(0.4, 1.1, 40)}px)`,
      }}>
        <div style={{ color: "white", fontSize: 104, fontWeight: 800, fontFamily: "system-ui, sans-serif", lineHeight: 1.0 }}>Open the app</div>
        <div style={{ color: "#3ECFDF", fontSize: 104, fontWeight: 800, fontFamily: "system-ui, sans-serif", lineHeight: 1.0, marginTop: 8 }}>and play today</div>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 28, fontFamily: "system-ui, sans-serif", marginTop: 28 }}>
          Rule Tap · Memory Flip · More coming
        </div>
      </div>

      {/* CTA BUTTON */}
      <div style={{
        position: "absolute", top: 1360, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 24,
        opacity: fi(1.0, 1.8),
        transform: `translateY(${su(1.0, 1.8, 40)}px) scale(${btnPulse})`,
      }}>
        <Img src={staticFile("cta-button.svg")} style={{ width: 620, height: 124 }} />
      </div>

      {/* DOMAIN */}
      <div style={{
        position: "absolute", top: 1540, left: 0, right: 0, textAlign: "center",
        opacity: fi(1.5, 2.2),
      }}>
        <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 24, fontFamily: "system-ui, sans-serif", letterSpacing: 4, textTransform: "uppercase" }}>
          akibamiles.com
        </div>
      </div>
    </AbsoluteFill>
  );
};
