// Cinematic ~20s announce intro: title build → gameplay with kinetic callouts → stats → CTA.
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// gameplay source is 43.37s; shown sped up inside the showcase scene
export const SRC_DURATION_S = 43.37;
export const GAMEPLAY_SPEED = 3.6;

// scene lengths (frames). TransitionSeries overlaps subtract the transition durations.
export const S_TITLE = 78;
export const S_GAME = 345;
export const S_STATS = 120;
export const S_CTA = 123;
export const XFADE = 22; // transition overlap

// theme (matches game / landing)
export const C = {
  bg: "#070512",
  bg2: "#10193a",
  cyan: "#8fe4f5",
  blue: "#3aa6d8",
  gold: "#ffd23f",
  green: "#8ef5a8",
  ink: "#0a1430",
  white: "#eaf6ff",
};
