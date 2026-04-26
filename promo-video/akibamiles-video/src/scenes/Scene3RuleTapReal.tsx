import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { RuleTapBoard } from "../game-components/rule-tap/rule-tap-board";
import { RuleBanner } from "../game-components/rule-tap/rule-banner";
import { RuleTapScorePanel } from "../game-components/rule-tap/rule-tap-score-panel";
import { GameHeader } from "../game-components/game-header";
import type { RuleTapTile } from "../game-components/types";

// Static game state — frozen mid-round, score=2, combo=3
const ACTIVE_TILES: RuleTapTile[] = [
  { id: "t0", index: 0, kind: "star",   color: "blue",  activeFromMs: 0, activeToMs: 850 },
  { id: "t1", index: 2, kind: "circle", color: "green", activeFromMs: 0, activeToMs: 850 },
  { id: "t2", index: 4, kind: "star",   color: "gold",  activeFromMs: 0, activeToMs: 850 },
  { id: "t3", index: 6, kind: "square", color: "red",   activeFromMs: 0, activeToMs: 850 },
  { id: "t4", index: 8, kind: "star",   color: "blue",  activeFromMs: 0, activeToMs: 850 },
];

const FEEDBACK_STATES: Array<Record<number, "good" | "bad">> = [
  {},                       // 0-1s: clean board
  { 0: "good", 4: "good" }, // 1-2s: two good taps
  { 2: "bad" },             // 2-3s: wrong tap
  { 0: "good" },            // 3-4s: correct tap
  {},                       // 4-5s: clean
];

export const Scene3RuleTapReal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fade in
  const opacity = interpolate(frame, [0, 0.4 * fps], [0, 1], { extrapolateRight: "clamp" });

  // Animate score counter
  const score = frame >= 3 * fps ? 3 : frame >= 1.5 * fps ? 2 : frame >= 0.8 * fps ? 1 : 0;

  // Combo climbs
  const combo = frame >= 2.5 * fps ? 3 : frame >= 1.5 * fps ? 2 : 0;

  // Remaining time ticking down (starts at 12s, ticks to 8s over 5s of scene)
  const remainingMs = Math.round(interpolate(frame, [0, 5 * fps], [12000, 8000], { extrapolateRight: "clamp" }));

  // Cycle through feedback states
  const feedbackIndex = Math.min(
    Math.floor(frame / fps),
    FEEDBACK_STATES.length - 1
  );
  const feedback = FEEDBACK_STATES[feedbackIndex];

  // lastDelta: flash +1 at frame 25, frame 55, frame 90
  const lastDelta = (frame === 25 || frame === 55 || frame === 90) ? 1
    : (frame === 65) ? -2
    : null;

  // Scale the whole UI to fit the 1080-wide video (real UI designed for ~390px phone)
  const scale = 1080 / 390;

  return (
    <AbsoluteFill style={{ background: "#F7FEFF", opacity }}>
      {/* Scale the phone UI up to fill 1080px wide */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 390,
        transformOrigin: "top left",
        transform: `scale(${scale})`,
      }}>
        <GameHeader title="Rule Tap" subtitle="Tap only the correct shape" />

        <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
          <RuleBanner rule={{ instruction: "Tap only STARS", targets: [{ color: "blue", kind: "star" }], avoids: [] }} />

          <RuleTapScorePanel
            score={score}
            mistakes={frame >= 65 ? 1 : 0}
            remainingMs={remainingMs}
            combo={combo}
            lastDelta={lastDelta}
          />

          <RuleTapBoard
            activeTiles={ACTIVE_TILES}
            feedback={feedback}
            onTap={() => {}}
            disabled={false}
          />
        </div>
      </div>

      {/* Phone frame overlay — subtle border */}
      <div style={{
        position: "absolute",
        inset: 0,
        border: "3px solid rgba(0,0,0,0.06)",
        borderRadius: 0,
        pointerEvents: "none",
      }} />
    </AbsoluteFill>
  );
};
