import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig, staticFile, Easing } from "remotion";

const TILES = [
  { src: "tile-star-blue.svg", x: 80, y: 0 },
  { src: "tile-square-red.svg", x: 280, y: 40 },
  { src: "tile-circle-green.svg", x: 80, y: 220 },
  { src: "tile-diamond-gold.svg", x: 280, y: 260 },
];

const TileItem: React.FC<{ src: string; x: number; y: number; tapFrame: number; correct: boolean }> = ({
  src, x, y, tapFrame, correct,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Appear
  const appear = interpolate(frame, [0, 0.4 * fps], [0, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.34, 1.56, 0.64, 1) });

  // Tap flash
  const afterTap = frame - tapFrame;
  const tapScale = afterTap >= 0 && afterTap < 0.4 * fps
    ? interpolate(afterTap, [0, 0.1 * fps, 0.3 * fps], [1, correct ? 1.2 : 0.85, 1], { extrapolateRight: "clamp" })
    : 1;
  const ringOpacity = afterTap >= 0 && afterTap < 0.5 * fps
    ? interpolate(afterTap, [0, 0.05 * fps, 0.4 * fps], [0, 1, 0], { extrapolateRight: "clamp" })
    : 0;
  const ringColor = correct ? "#31C76A" : "#E55353";

  return (
    <div style={{
      position: "absolute",
      left: x,
      top: y,
      transform: `scale(${appear * tapScale})`,
      opacity: appear,
    }}>
      {/* Ring flash */}
      <div style={{
        position: "absolute",
        inset: -12,
        borderRadius: 20,
        border: `3px solid ${ringColor}`,
        opacity: ringOpacity,
      }} />
      <div style={{
        width: 140,
        height: 140,
        borderRadius: 20,
        background: "rgba(255,255,255,0.06)",
        border: "2px solid rgba(255,255,255,0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(8px)",
      }}>
        <Img src={staticFile(src)} style={{ width: 72, height: 72 }} />
      </div>
    </div>
  );
};

export const Scene3RuleTap: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, 0.6 * fps], [0, 1], { extrapolateRight: "clamp" });
  const headerY = interpolate(frame, [0, 0.6 * fps], [-20, 0], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) });

  // Rule text
  const ruleOpacity = interpolate(frame, [0.3 * fps, 1.0 * fps], [0, 1], { extrapolateRight: "clamp" });

  // Score counter
  const actualScore = frame >= 3.5 * fps ? 2 : frame >= 2.2 * fps ? 1 : 0;

  // Timer bar
  const timerWidth = interpolate(frame, [0, 6 * fps], [100, 0], { extrapolateRight: "clamp" });
  const timerColor = timerWidth > 50 ? "#31C76A" : timerWidth > 25 ? "#F59E0B" : "#E55353";

  // Feedback checkmark
  const feedbackOpacity1 = interpolate(frame, [2.2 * fps, 2.5 * fps, 3.0 * fps], [0, 1, 0], { extrapolateRight: "clamp" });
  const feedbackOpacity2 = interpolate(frame, [3.5 * fps, 3.8 * fps, 4.3 * fps], [0, 1, 0], { extrapolateRight: "clamp" });

  // Score delta float
  const deltaOpacity1 = interpolate(frame, [2.2 * fps, 2.4 * fps, 2.9 * fps], [0, 1, 0], { extrapolateRight: "clamp" });
  const deltaY1 = interpolate(frame, [2.2 * fps, 2.9 * fps], [0, -40], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #0A1A20 0%, #0D2E38 50%, #0A1628 100%)" }}>
      {/* Teal glow */}
      <AbsoluteFill style={{
        background: "radial-gradient(ellipse 600px 400px at 50% 40%, rgba(35,141,157,0.18) 0%, transparent 70%)",
      }} />

      {/* Header band */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 140,
        background: "linear-gradient(135deg, #0D7A8A, #238D9D)",
        opacity: headerOpacity,
        transform: `translateY(${headerY}px)`,
        display: "flex",
        alignItems: "center",
        padding: "0 48px",
        gap: 20,
      }}>
        <div style={{ fontSize: 44, }}>⚡</div>
        <div>
          <div style={{ color: "white", fontSize: 36, fontWeight: 800, fontFamily: "system-ui, sans-serif" }}>Rule Tap</div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 22, fontFamily: "system-ui, sans-serif" }}>Tap only the correct shape</div>
        </div>
      </div>

      {/* Timer bar */}
      <div style={{
        position: "absolute",
        top: 140,
        left: 0,
        right: 0,
        height: 8,
        background: "rgba(255,255,255,0.1)",
        opacity: headerOpacity,
      }}>
        <div style={{
          height: "100%",
          width: `${timerWidth}%`,
          background: timerColor,
          transition: "background 0.3s",
        }} />
      </div>

      {/* Rule pill */}
      <div style={{
        position: "absolute",
        top: 175,
        left: "50%",
        transform: "translateX(-50%)",
        opacity: ruleOpacity,
        background: "rgba(35,141,157,0.2)",
        border: "1px solid rgba(35,141,157,0.5)",
        borderRadius: 30,
        padding: "12px 32px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        whiteSpace: "nowrap",
      }}>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 24, fontFamily: "system-ui, sans-serif" }}>Tap all</div>
        <div style={{
          background: "#238D9D",
          borderRadius: 10,
          padding: "4px 14px",
          color: "white",
          fontSize: 22,
          fontWeight: 700,
          fontFamily: "system-ui, sans-serif",
        }}>STARS</div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 24, fontFamily: "system-ui, sans-serif" }}>only</div>
      </div>

      {/* Tile grid */}
      <div style={{
        position: "absolute",
        top: 290,
        left: "50%",
        marginLeft: -230,
        width: 460,
        height: 500,
      }}>
        {TILES.map((tile, i) => (
          <TileItem
            key={tile.src}
            src={tile.src}
            x={tile.x}
            y={tile.y}
            tapFrame={i === 0 ? Math.round(2.0 * fps) : i === 2 ? Math.round(3.3 * fps) : -999}
            correct={i === 0 || i === 2}
          />
        ))}

        {/* Feedback check 1 */}
        <div style={{ position: "absolute", left: 110, top: 30, opacity: feedbackOpacity1 }}>
          <Img src={staticFile("tap-feedback-correct.svg")} style={{ width: 64, height: 64 }} />
        </div>
        {/* Feedback check 2 */}
        <div style={{ position: "absolute", left: 110, top: 250, opacity: feedbackOpacity2 }}>
          <Img src={staticFile("tap-feedback-correct.svg")} style={{ width: 64, height: 64 }} />
        </div>

        {/* Score delta float */}
        <div style={{
          position: "absolute",
          left: 170,
          top: 20,
          transform: `translateY(${deltaY1}px)`,
          opacity: deltaOpacity1,
          color: "#31C76A",
          fontSize: 36,
          fontWeight: 800,
          fontFamily: "system-ui, sans-serif",
        }}>+1</div>
      </div>

      {/* Score panel */}
      <div style={{
        position: "absolute",
        bottom: 200,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        gap: 48,
        opacity: ruleOpacity,
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 22, fontFamily: "system-ui, sans-serif" }}>SCORE</div>
          <div style={{ color: "white", fontSize: 64, fontWeight: 800, fontFamily: "system-ui, sans-serif" }}>{actualScore}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 22, fontFamily: "system-ui, sans-serif" }}>REWARD</div>
          <div style={{ color: "#F59E0B", fontSize: 64, fontWeight: 800, fontFamily: "system-ui, sans-serif" }}>35</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
