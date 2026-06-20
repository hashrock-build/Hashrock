// In-game audio via @pixi/sound: a looping chiptune BGM + short SFX (mining, ore collected,
// UI click, purchase). All assets are generated (video/.. style synth) under public/assets/audio.
// Browsers block autoplay until a user gesture — start the BGM from the "Play" click.
import { sound } from "@pixi/sound";

const A = "/assets/audio/";
let ready = false;
let muted = localStorage.getItem("hashrock_muted") === "1";

export function initSound(): void {
  if (ready) return;
  ready = true;
  sound.add("mine", A + "sfx_mine.wav");
  sound.add("ore", A + "sfx_ore.wav");
  sound.add("click", A + "sfx_click.wav");
  sound.add("buy", A + "sfx_buy.wav");
  sound.add("bgm", { url: A + "bgm.mp3", loop: true, volume: 0.3, preload: true });
  if (muted) sound.muteAll();
}

/** Start looping BGM (call from a user gesture so autoplay is allowed). */
export function startBgm(): void {
  if (!ready) initSound();
  try { sound.play("bgm"); } catch { /* ignore */ }
}

export function sfx(name: string, volume = 0.5): void {
  if (muted || !ready) return;
  try { sound.play(name, { volume }); } catch { /* ignore */ }
}

export function isMuted(): boolean { return muted; }
export function toggleMuted(): boolean {
  muted = !muted;
  localStorage.setItem("hashrock_muted", muted ? "1" : "0");
  if (muted) sound.muteAll(); else sound.unmuteAll();
  return muted;
}
