import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { MemoryGrid } from "../game-components/memory-flip/memory-grid";
import { MemoryStats } from "../game-components/memory-flip/memory-stats";
import { GameHeader } from "../game-components/game-header";

// 16 cards — 8 pairs
const DECK = [
  { id: "0", value: "sun" },    { id: "1", value: "moon" },
  { id: "2", value: "bolt" },   { id: "3", value: "key" },
  { id: "4", value: "spark" },  { id: "5", value: "leaf" },
  { id: "6", value: "gem" },    { id: "7", value: "wave" },
  { id: "8", value: "moon" },   { id: "9", value: "sun" },
  { id: "10", value: "key" },   { id: "11", value: "bolt" },
  { id: "12", value: "leaf" },  { id: "13", value: "spark" },
  { id: "14", value: "wave" },  { id: "15", value: "gem" },
];

export const Scene4MemoryFlipReal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 0.4 * fps], [0, 1], { extrapolateRight: "clamp" });

  // Progressively reveal and match cards over time
  const revealed = new Set<number>();
  const matched = new Set<number>();

  if (frame >= 0.5 * fps) revealed.add(0);   // flip sun
  if (frame >= 0.9 * fps) revealed.add(9);   // flip sun pair
  if (frame >= 1.3 * fps) {                  // match sun pair
    matched.add(0);
    matched.add(9);
    revealed.delete(0);
    revealed.delete(9);
  }
  if (frame >= 1.8 * fps) revealed.add(2);   // flip bolt
  if (frame >= 2.2 * fps) revealed.add(11);  // flip bolt pair
  if (frame >= 2.6 * fps) {                  // match bolt pair
    matched.add(2);
    matched.add(11);
    revealed.delete(2);
    revealed.delete(11);
  }
  if (frame >= 3.0 * fps) revealed.add(4);   // flip spark
  if (frame >= 3.4 * fps) revealed.add(13);  // flip spark pair
  // Spark stays flipped (no match yet — mid-play)

  const matchCount = matched.size / 2;
  const moves = Math.min(frame >= 3.4 * fps ? 7 : frame >= 2.2 * fps ? 5 : frame >= 0.9 * fps ? 2 : 0, 16);
  const remainingMs = Math.round(interpolate(frame, [0, 5 * fps], [45000, 32000], { extrapolateRight: "clamp" }));
  const score = matchCount * 100;

  const scale = 1080 / 390;

  return (
    <AbsoluteFill style={{ background: "#F7F4FF", opacity }}>
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 390,
        transformOrigin: "top left",
        transform: `scale(${scale})`,
      }}>
        <GameHeader title="Memory Flip" subtitle="Match pairs before time runs out" />

        <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
          <MemoryStats
            score={score}
            moves={moves}
            matches={matchCount}
            remainingMs={remainingMs}
          />

          <MemoryGrid
            deck={DECK}
            revealed={revealed}
            matched={matched}
            onFlip={() => {}}
            disabled={false}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
