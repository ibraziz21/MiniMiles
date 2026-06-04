import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const scenes = [
  {
    start: 0,
    end: 120,
    image: "home.jpg",
    label: "Office Hours",
    headline: "What are AkibaMiles?",
    caption: "Reward points you earn and use inside the AkibaMiles app.",
  },
  {
    start: 120,
    end: 300,
    image: "home.jpg",
    label: "Your balance",
    headline: "They live in your app balance.",
    caption: "The real home screen shows your Miles, daily challenges, and raffle entry points.",
  },
  {
    start: 300,
    end: 510,
    image: "earn.jpg",
    label: "Earn",
    headline: "Earn by completing actions.",
    caption: "Daily challenges and partner activities add Miles to your account.",
  },
  {
    start: 510,
    end: 780,
    image: "games.jpg",
    label: "Skill games",
    headline: "Play short skill rounds.",
    caption: "Rule Tap and Memory Flip use Miles entry, verified results, and reward thresholds.",
  },
  {
    start: 780,
    end: 990,
    image: "spend.jpg",
    label: "Spend",
    headline: "Use Miles for rewards.",
    caption: "Spend Miles on raffles, games, and reward opportunities in the same app loop.",
  },
  {
    start: 990,
    end: 1200,
    image: "rule-tap.jpg",
    label: "Rule Tap",
    headline: "Read the rule. Tap with skill.",
    caption: "Fast gameplay stays offchain; sessions and rewards follow the onchain flow.",
  },
  {
    start: 1200,
    end: 1350,
    image: "memory-flip.jpg",
    label: "Memory Flip",
    headline: "Match pairs. Beat the clock.",
    caption: "Open AkibaMiles and try the new games.",
  },
];

const getScene = (frame: number) => {
  return scenes.find((scene) => frame >= scene.start && frame < scene.end) ?? scenes[scenes.length - 1];
};

const AppPhone: React.FC<{ image: string }> = ({ image }) => {
  return (
    <div
      style={{
        width: 432,
        height: 932,
        borderRadius: 54,
        background: "#0F1115",
        padding: 14,
        boxShadow: "0 56px 120px rgba(17,24,39,0.24), 0 0 0 1px rgba(35,141,157,0.12)",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 14,
          left: "50%",
          transform: "translateX(-50%)",
          width: 132,
          height: 24,
          borderRadius: "0 0 16px 16px",
          background: "#0F1115",
          zIndex: 3,
        }}
      />
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 42,
          overflow: "hidden",
          background: "#F7FEFF",
        }}
      >
        <Img
          src={staticFile(`app-captures/${image}`)}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "cover",
          }}
        />
      </div>
    </div>
  );
};

export const AkibaMilesOfficeHoursExactApp: React.FC = () => {
  const frame = useCurrentFrame();
  const scene = getScene(frame);
  const localFrame = frame - scene.start;
  const enter = interpolate(localFrame, [0, 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(localFrame, [0, 24], [28, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #F0FDFF 0%, #FFFFFF 56%, #E9FBFF 100%)",
        fontFamily: "Sterling, Inter, system-ui, sans-serif",
        color: "#111827",
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

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 20% 14%, rgba(173,244,255,0.78), transparent 30%), radial-gradient(circle at 80% 72%, rgba(35,141,157,0.10), transparent 34%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 72,
          left: 72,
          right: 72,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              background: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(35,141,157,0.16)",
              boxShadow: "0 12px 28px rgba(35,141,157,0.12)",
            }}
          >
            <Img src={staticFile("minimiles-symbol.svg")} style={{ width: 34, height: 34 }} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#817E7E", letterSpacing: 2, fontWeight: 600 }}>AKIBAMILES</div>
            <div style={{ fontSize: 26, fontWeight: 600 }}>Office Hours</div>
          </div>
        </div>
        <div
          style={{
            borderRadius: 999,
            background: "#FFFFFF",
            color: "#238D9D",
            border: "1px solid rgba(35,141,157,0.18)",
            padding: "12px 18px",
            fontSize: 22,
            fontWeight: 600,
            boxShadow: "0 10px 24px rgba(35,141,157,0.10)",
          }}
        >
          Episode 01
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 182,
          left: 72,
          right: 72,
          zIndex: 2,
          opacity: enter,
          transform: `translateY(${y}px)`,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            borderRadius: 999,
            background: "rgba(35,141,157,0.10)",
            color: "#238D9D",
            padding: "9px 14px",
            fontSize: 18,
            fontWeight: 600,
            marginBottom: 18,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "#238D9D" }} />
          {scene.label}
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 74,
            lineHeight: 0.94,
            letterSpacing: -1,
            maxWidth: 850,
            fontWeight: 600,
          }}
        >
          {scene.headline}
        </h1>
      </div>

      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 505,
          transform: "translateX(-50%)",
          zIndex: 2,
        }}
      >
        <AppPhone image={scene.image} />
      </div>

      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          bottom: 74,
          zIndex: 3,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 32,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 34,
            lineHeight: 1.18,
            fontWeight: 500,
            maxWidth: 740,
          }}
        >
          {scene.caption}
        </p>
        <div
          style={{
            flexShrink: 0,
            borderRadius: 22,
            background: "#238D9D",
            color: "#FFFFFF",
            padding: "16px 22px",
            fontSize: 23,
            fontWeight: 600,
            boxShadow: "0 18px 36px rgba(35,141,157,0.22)",
          }}
        >
          Open AkibaMiles
        </div>
      </div>
    </AbsoluteFill>
  );
};
