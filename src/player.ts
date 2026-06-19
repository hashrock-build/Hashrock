// Animated 4-direction player built from the Pixel Crawler "Body_A" sheets.
// Frames are 64x64; the character sits centered with its feet at y=48 (anchor 0.75).
// The sheets provide Down / Side / Up — "left" reuses Side flipped horizontally.

import { Assets, AnimatedSprite, Texture, Rectangle } from "pixi.js";
import { Facing } from "./topdown";

const FRAME = 64;
const FEET_ANCHOR_Y = 48 / FRAME; // 0.75

type Dir3 = "down" | "side" | "up";
type ActionSet = Record<Dir3, Texture[]>;

export interface PlayerAnims {
  idle: ActionSet;
  walk: ActionSet;
  crush: ActionSet; // mining swing
}

async function loadStrip(url: string, count: number): Promise<Texture[]> {
  const sheet: Texture = await Assets.load(url);
  sheet.source.scaleMode = "nearest";
  const frames: Texture[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(
      new Texture({ source: sheet.source, frame: new Rectangle(i * FRAME, 0, FRAME, FRAME) })
    );
  }
  return frames;
}

async function loadAction(name: string, count: number): Promise<ActionSet> {
  const [down, side, up] = await Promise.all([
    loadStrip(`/assets/character/${name}_Down-Sheet.png`, count),
    loadStrip(`/assets/character/${name}_Side-Sheet.png`, count),
    loadStrip(`/assets/character/${name}_Up-Sheet.png`, count),
  ]);
  return { down, side, up };
}

export async function loadPlayerAnims(): Promise<PlayerAnims> {
  const [idle, walk, crush] = await Promise.all([
    loadAction("Idle", 4),
    loadAction("Walk", 6),
    loadAction("Crush", 8),
  ]);
  return { idle, walk, crush };
}

type State = "idle" | "walk" | "crush";

export class Player {
  readonly sprite: AnimatedSprite;
  facing: Facing = "down";
  private anims: PlayerAnims;
  private state: State = "idle";
  private baseScale: number;
  private mining = false;

  constructor(anims: PlayerAnims, scale = 2) {
    this.anims = anims;
    this.baseScale = scale;
    this.sprite = new AnimatedSprite(anims.idle.down);
    this.sprite.anchor.set(0.5, FEET_ANCHOR_Y);
    this.sprite.roundPixels = true;
    this.sprite.animationSpeed = 0.12;
    this.sprite.play();
    this.apply();
  }

  /** Update walk/idle state and facing from the movement vector. */
  setMovement(facing: Facing, moving: boolean): void {
    if (this.mining) {
      this.facing = facing; // remember for when the swing ends
      return;
    }
    const next: State = moving ? "walk" : "idle";
    if (next !== this.state || facing !== this.facing) {
      this.state = next;
      this.facing = facing;
      this.apply();
    }
  }

  /** Play the mining swing once, then return to idle/walk. */
  mine(onHit?: () => void): void {
    if (this.mining) return;
    this.mining = true;
    this.state = "crush";
    this.apply();
    this.sprite.loop = false;
    this.sprite.gotoAndPlay(0);
    let hit = false;
    this.sprite.onFrameChange = (f) => {
      if (!hit && f >= Math.floor(this.sprite.totalFrames / 2)) {
        hit = true;
        onHit?.(); // land the damage mid-swing
      }
    };
    this.sprite.onComplete = () => {
      this.sprite.onComplete = undefined;
      this.sprite.onFrameChange = undefined;
      this.sprite.loop = true;
      this.mining = false;
      this.state = "idle";
      this.apply();
    };
  }

  private dir3(): { set: Dir3; flip: boolean } {
    switch (this.facing) {
      case "up": return { set: "up", flip: false };
      case "down": return { set: "down", flip: false };
      case "left": return { set: "side", flip: true };
      default: return { set: "side", flip: false }; // right
    }
  }

  private apply(): void {
    const { set, flip } = this.dir3();
    const frames = this.anims[this.state][set];
    if (this.sprite.textures !== frames) {
      this.sprite.textures = frames;
      this.sprite.animationSpeed = this.state === "crush" ? 0.28 : this.state === "walk" ? 0.16 : 0.1;
      if (this.state !== "crush") this.sprite.play();
    }
    this.sprite.scale.x = flip ? -this.baseScale : this.baseScale;
    this.sprite.scale.y = this.baseScale;
  }
}
