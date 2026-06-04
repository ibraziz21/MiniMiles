import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig, staticFile, Easing } from "remotion";

const MEMORY_CARDS = [
  { front: "memory-sun.svg", col: 0, row: 0 },
  { front: "memory-moon.svg", col: 1, row: 0 },
  { front: "memory-sparkle.svg", col: 2, row: 0 },
  { front: "memory-sun.svg", col: 0, row: 1 },
  { front: "memory-key.svg", col: 1, row: 1 },
  { front: "memory-moon.svg", col: 2, row: 1 },
];

const MemoryCard: React.FC<{
  front: string;
  col: number;
  row: number;
  flipFrame: number;
  matched?: boolean;
}> = ({ front, col, row, flipFrame, matched = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const x = 60 + col * 170;
  const y = row * 200;

  // Appear stagger
  const appearDelay = (col + row * 3) * 0.08 * fps;
  const appear = interpolate(frame, [appearDelay, appearDelay + 0.4 * fps], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
  });

  // Flip animation
  const afterFlip = frame - flipFrame;
  const rotateY = flipFrame >= 0 && afterFlip >= 0
    ? interpolate(afterFlip, [0, 0.3 * fps], [0, 180], {
        extrapolateRight: "clamp",
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      })
    : 0;

  const showFront = rotateY > 90;
  const cardRotation = rotateY > 90 ? 180 - rotateY : rotateY;

  const matchGlow = matched ? interpolate(
    frame,
    [flipFrame + 0.3 * fps, flipFrame + 0.6 * fps],
    [0, 1],
    { extrapolateRight: "clamp" }
  ) : 0;

  return (
    <div style={{
      position: "absolute",
      left: x,
      top: y,
      width: 140,
      height: 160,
      transform: `scale(${appear}) rotateY(${cardRotation}deg)`,
      opacity: appear,
      transformStyle: "preserve-3d",
      perspective: 800,
    }}>
      {!showFront ? (
        // Card back
        <div style={{
          width: "100%",
          height: "100%",
          borderRadius: 16,
          background: "linear-gradient(135deg, #3B1F6E, #7B4CC0)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "2px solid rgba(255,255,255,0.15)",
          boxShadow: "0 4px 20px rgba(91,53,160,0.4)",
        }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 40, fontFamily: "system-ui, sans-serif", fontWeight: 700 }}>?</div>
        </div>
      ) : (
        // Card front
        <div style={{
          width: "100%",
          height: "100%",
          borderRadius: 16,
          background: matched ? "#F0FFF6" : "#F5F0FF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `2px solid ${matched ? "rgba(49,199,106,0.5)" : "rgba(91,53,160,0.3)"}`,
          boxShadow: matched ? `0 0 ${24 * matchGlow}px rgba(49,199,106,${0.4 * matchGlow})` : "none",
          transform: "rotateY(180deg)",
        }}>
          <Img src={staticFile(front)} style={{ width: 72, height: 72 }} />
        </div>
      )}
    </div>
  );
};

export const Scene4MemoryFlip: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, 0.5 * fps], [0, 1], { extrapolateRight: "clamp" });
  const headerY = interpolate(frame, [0, 0.5 * fps], [-20, 0], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) });

  // Timer
  const timerWidth = interpolate(frame, [0, 5 * fps], [100, 0], { extrapolateRight: "clamp" });
  const timerColor = timerWidth > 50 ? "#A855F7" : timerWidth > 25 ? "#F59E0B" : "#E55353";

  // Flip frames: cards flip at staggered times
  const flipTimes: Record<string, number> = {
    "0-0": Math.round(1.0 * fps),
    "1-0": Math.round(1.3 * fps),
    "0-1": Math.round(2.2 * fps),
    "1-1": Math.round(2.5 * fps),
  };

  // Score
  const matches = frame >= 2.5 * fps ? 2 : frame >= 1.3 * fps ? 1 : 0;

  const labelOpacity = interpolate(frame, [0.4 * fps, 1.0 * fps], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #120A28 0%, #1E0F40 50%, #0A1628 100%)" }}>
      {/* Purple glow */}
      <AbsoluteFill style={{
        background: "radial-gradient(ellipse 600px 400px at 50% 40%, rgba(91,53,160,0.22) 0%, transparent 70%)",
      }} />

      {/* Header */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 140,
        background: "linear-gradient(135deg, #3B1F6E, #7B4CC0)",
        opacity: headerOpacity,
        transform: `translateY(${headerY}px)`,
        display: "flex",
        alignItems: "center",
        padding: "0 48px",
        gap: 20,
      }}>
        <div style={{ fontSize: 44 }}>🧠</div>
        <div>
          <div style={{ color: "white", fontSize: 36, fontWeight: 800, fontFamily: "system-ui, sans-serif" }}>Memory Flip</div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 22, fontFamily: "system-ui, sans-serif" }}>Match pairs before time runs out</div>
        </div>
      </div>

      {/* Timer */}
      <div style={{
        position: "absolute",
        top: 140,
        left: 0,
        right: 0,
        height: 8,
        background: "rgba(255,255,255,0.1)",
        opacity: headerOpacity,
      }}>
        <div style={{ height: "100%", width: `${timerWidth}%`, background: timerColor }} />
      </div>

      {/* Cards */}
      <div style={{
        position: "absolute",
        top: 260,
        left: "50%",
        marginLeft: -245,
        width: 490,
        height: 420,
        perspective: 1000,
      }}>
        {MEMORY_CARDS.map((card) => {
          const key = `${card.col}-${card.row}`;
          return (
            <MemoryCard
              key={`${card.front}-${card.col}-${card.row}`}
              front={card.front}
              col={card.col}
              row={card.row}
              flipFrame={flipTimes[key] ?? -1}
              matched={
                (card.front === "memory-sun.svg" && frame >= 2.5 * fps) ||
                (card.front === "memory-moon.svg" && frame >= 4.0 * fps)
              }
            />
          );
        })}
      </div>

      {/* Stats */}
      <div style={{
        position: "absolute",
        bottom: 220,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        gap: 48,
        opacity: labelOpacity,
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 22, fontFamily: "system-ui, sans-serif" }}>MATCHES</div>
          <div style={{ color: "#A855F7", fontSize: 64, fontWeight: 800, fontFamily: "system-ui, sans-serif" }}>{matches}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 22, fontFamily: "system-ui, sans-serif" }}>MAX EARN</div>
          <div style={{ color: "#F59E0B", fontSize: 64, fontWeight: 800, fontFamily: "system-ui, sans-serif" }}>20</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
