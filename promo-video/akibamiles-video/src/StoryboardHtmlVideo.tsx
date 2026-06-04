import React from "react";
import { AbsoluteFill, IFrame, staticFile, useCurrentFrame } from "remotion";

const sceneFrames = [
  { scene: 1, start: 0 },
  { scene: 2, start: 90 },
  { scene: 3, start: 300 },
  { scene: 4, start: 540 },
  { scene: 5, start: 840 },
  { scene: 6, start: 1140 },
  { scene: 7, start: 1380 },
];

const getScene = (frame: number) => {
  return sceneFrames.reduce((active, candidate) => {
    return frame >= candidate.start ? candidate.scene : active;
  }, 1);
};

export const AkibaMilesOfficeHoursStoryboard: React.FC = () => {
  const frame = useCurrentFrame();
  const scene = getScene(frame);
  const src = `${staticFile("storyboards/office-hours-01-clean.html")}?scene=${scene}`;

  return (
    <AbsoluteFill style={{ background: "#F0FDFF" }}>
      <IFrame
        key={scene}
        title={`AkibaMiles Office Hours storyboard scene ${scene}`}
        src={src}
        style={{
          width: 1080,
          height: 1920,
          border: 0,
          display: "block",
        }}
      />
    </AbsoluteFill>
  );
};
