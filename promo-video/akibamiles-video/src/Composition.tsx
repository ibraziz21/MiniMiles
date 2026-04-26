import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Scene1BrandIntro } from "./scenes/Scene1BrandIntro";
import { Scene2Hook } from "./scenes/Scene2Hook";
import { Scene3RuleTapReal } from "./scenes/Scene3RuleTapReal";
import { Scene4MemoryFlipReal } from "./scenes/Scene4MemoryFlipReal";
import { Scene5Trust } from "./scenes/Scene5Trust";
import { Scene6CTA } from "./scenes/Scene6CTA";

// Scene durations at 30fps (transitions overlap so net duration = 840 frames = 28s)
// Scene 1: 120f  Scene 2: 120f  Scene 3: 180f
// Scene 4: 150f  Scene 5: 150f  Scene 6: 120f
// 5 transitions × 15f = 75f overlap → 840 - 75 = 765 net... adjust Root durationInFrames accordingly

const TRANSITION_FRAMES = 15;

export const AkibaMilesPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: "#0A1628" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={120} premountFor={15}>
          <Scene1BrandIntro />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        <TransitionSeries.Sequence durationInFrames={120} premountFor={15}>
          <Scene2Hook />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION_FRAMES })}
        />

        <TransitionSeries.Sequence durationInFrames={180} premountFor={15}>
          <Scene3RuleTapReal />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION_FRAMES })}
        />

        <TransitionSeries.Sequence durationInFrames={150} premountFor={15}>
          <Scene4MemoryFlipReal />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        <TransitionSeries.Sequence durationInFrames={150} premountFor={15}>
          <Scene5Trust />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        <TransitionSeries.Sequence durationInFrames={120} premountFor={15}>
          <Scene6CTA />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
