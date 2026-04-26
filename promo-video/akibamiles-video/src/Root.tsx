import "./index.css";
import { Composition } from "remotion";
import { AkibaMilesPromo } from "./Composition";
import { AkibaMilesOfficeHours01 } from "./OfficeHours01";
import { AkibaMilesOfficeHoursStoryboard } from "./StoryboardHtmlVideo";
import { AkibaMilesOfficeHoursExactApp } from "./ExactAppOfficeHours";
import { ExactAppCapture } from "./ExactAppCapture";
import { AkibaMilesOfficeHoursProducerCut } from "./OfficeHoursProducerCut";
import { AkibaMilesOfficeHoursIncentiveLayer } from "./OfficeHoursIncentiveLayer";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AkibaMilesPromo"
        component={AkibaMilesPromo}
        durationInFrames={765} // 840 frames - 5×15 transition overlap = 765
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="AkibaMilesOfficeHours01"
        component={AkibaMilesOfficeHours01}
        durationInFrames={1350}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="AkibaMilesOfficeHoursStoryboard"
        component={AkibaMilesOfficeHoursStoryboard}
        durationInFrames={1800}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="AkibaMilesOfficeHoursExactApp"
        component={AkibaMilesOfficeHoursExactApp}
        durationInFrames={1350}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="AkibaMilesOfficeHoursProducerCut"
        component={AkibaMilesOfficeHoursProducerCut}
        durationInFrames={1350}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="AkibaMilesOfficeHoursIncentiveLayer"
        component={AkibaMilesOfficeHoursIncentiveLayer}
        durationInFrames={1350}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="AkibaCaptureHome"
        component={() => <ExactAppCapture route="/" />}
        durationInFrames={1}
        fps={30}
        width={390}
        height={844}
      />
      <Composition
        id="AkibaCaptureEarn"
        component={() => <ExactAppCapture route="/earn" />}
        durationInFrames={1}
        fps={30}
        width={390}
        height={844}
      />
      <Composition
        id="AkibaCaptureGames"
        component={() => <ExactAppCapture route="/games" />}
        durationInFrames={1}
        fps={30}
        width={390}
        height={844}
      />
      <Composition
        id="AkibaCaptureSpend"
        component={() => <ExactAppCapture route="/spend" />}
        durationInFrames={1}
        fps={30}
        width={390}
        height={844}
      />
      <Composition
        id="AkibaCaptureRuleTap"
        component={() => <ExactAppCapture route="/games/rule-tap" />}
        durationInFrames={1}
        fps={30}
        width={390}
        height={844}
      />
      <Composition
        id="AkibaCaptureMemoryFlip"
        component={() => <ExactAppCapture route="/games/memory-flip" />}
        durationInFrames={1}
        fps={30}
        width={390}
        height={844}
      />
    </>
  );
};
