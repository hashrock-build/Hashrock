import { Composition } from "remotion";
import { Intro } from "./Intro";
import { FPS, WIDTH, HEIGHT, S_TITLE, S_GAME, S_STATS, S_CTA, XFADE } from "./constants";

const TOTAL = S_TITLE + S_GAME + S_STATS + S_CTA - 3 * XFADE; // overlapped transitions

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Intro"
      component={Intro}
      durationInFrames={TOTAL}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
