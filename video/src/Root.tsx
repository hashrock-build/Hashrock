import { Composition } from "remotion";
import { Intro } from "./Intro";
import { FPS, WIDTH, HEIGHT, TOTAL } from "./constants";

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
