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

async function loadAction(base: string, name: string, count: number): Promise<ActionSet> {
  const [down, side, up] = await Promise.all([
    loadStrip(`${base}/${name}_Down-Sheet.png`, count),
    loadStrip(`${base}/${name}_Side-Sheet.png`, count),
    loadStrip(`${base}/${name}_Up-Sheet.png`, count),
  ]);
  return { down, side, up };
}

async function loadOne(base: string): Promise<PlayerAnims> {
  const [idle, walk, crush] = await Promise.all([
    loadAction(base, "Idle", 4),
    loadAction(base, "Walk", 6),
    loadAction(base, "Crush", 8), // Hunter's "Collect" was copied in as Crush (mining)
  ]);
  return { idle, walk, crush };
}

export const CHARACTERS = ["Rookie", "Hunter"]; // body index → name

/** Load every selectable character body (same 4-direction format). */
export async function loadCharacters(): Promise<PlayerAnims[]> {
  return Promise.all([
    loadOne("/assets/character"),         // Body_A (default)
    loadOne("/assets/characters/hunter"), // A_Hunter
  ]);
}

type State = "idle" | "walk" | "crush";

export class Player {
  readonly sprite: AnimatedSprite;
  facing: Facing = "down";
  private chars: PlayerAnims[];
  private body: number;
  private state: State = "idle";
  private baseScale: number;

  constructor(chars: PlayerAnims[], scale = 2, body = 0) {
    this.chars = chars;
    this.body = Math.max(0, Math.min(body, chars.length - 1));
    this.baseScale = scale;
    this.sprite = new AnimatedSprite(this.anims.idle.down);
    this.sprite.anchor.set(0.5, FEET_ANCHOR_Y);
    this.sprite.roundPixels = true;
    this.sprite.animationSpeed = 0.12;
    this.sprite.play();
    this.apply();
  }

  private get anims(): PlayerAnims { return this.chars[this.body]; }

  /** Switch character body (re-skins all animations). */
  setBody(i: number): void {
    if (i < 0 || i >= this.chars.length || i === this.body) return;
    this.body = i;
    this.apply(); // new body's frames differ → apply() swaps them
  }

  /** Drive the animation each frame from movement + mining. Priority: mine > walk > idle. */
  update(facing: Facing, moving: boolean, mining: boolean): void {
    const next: State = mining ? "crush" : moving ? "walk" : "idle";
    if (next !== this.state || facing !== this.facing) {
      this.state = next;
      this.facing = facing;
      this.apply();
    }
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
      this.sprite.loop = true; // all states loop now (crush = continuous mining)
      this.sprite.animationSpeed = this.state === "crush" ? 0.28 : this.state === "walk" ? 0.16 : 0.1;
      this.sprite.gotoAndPlay(0);
    }
    this.sprite.scale.x = flip ? -this.baseScale : this.baseScale;
    this.sprite.scale.y = this.baseScale;
  }
}
