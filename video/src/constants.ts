// Timing for the ≤20s intro. Source gameplay is 43.37s; at 3× it shows in ~14.5s.
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const SPEED = 3; // gameplay speed-up
export const SRC_DURATION_S = 43.37;

export const INTRO = 75; // 2.5s title card
export const OUTRO = 75; // 2.5s outro card
export const GAMEPLAY = Math.ceil((SRC_DURATION_S / SPEED) * FPS); // ~434 frames (14.5s)
export const TOTAL = INTRO + GAMEPLAY + OUTRO; // ~584 frames ≈ 19.5s

// theme (matches the game / landing)
export const C = {
  bg: "#0a0613",
  cyan: "#8fe4f5",
  blue: "#3aa6d8",
  gold: "#ffd23f",
  ink: "#0c1830",
};
