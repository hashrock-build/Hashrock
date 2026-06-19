// Floor tile atlas, sliced from the Anokolisa Pixel Crawler "Floors_Tiles" sheet.
// Source tiles are 16x16; we draw them scaled to TILE (see world.ts) so no gameplay
// constant changes. Tile coordinates below were picked from the sheet's solid "fill"
// blocks (rows 10-11 = stone/dirt/grass centers, fully opaque, no autotile edges).

import { Assets, Texture, Rectangle } from "pixi.js";

export const SRC_TILE = 16; // Pixel Crawler native tile size

export interface FloorAtlas {
  cobble: Texture[]; // stone mining-pit floor
  dirt: Texture[]; // exposed earth / tilled farm soil
  grass: Texture[]; // base village ground
  water: Texture[]; // pond fill (blocks movement + spawning)
  sand: Texture[]; // shoreline ring around water
}

let cached: FloorAtlas | null = null;

/** Load the floor + water sheets once and slice the named fill tiles. */
export async function loadFloorAtlas(): Promise<FloorAtlas> {
  if (cached) return cached;

  const [floors, water] = await Promise.all([
    Assets.load("/assets/tilesets/Floors_Tiles.png"),
    Assets.load("/assets/tilesets/Water_tiles.png"),
  ]);
  floors.source.scaleMode = "nearest"; // crisp pixels when scaled up
  water.source.scaleMode = "nearest";

  const cut = (src: Texture, tx: number, ty: number): Texture =>
    new Texture({
      source: src.source,
      frame: new Rectangle(tx * SRC_TILE, ty * SRC_TILE, SRC_TILE, SRC_TILE),
    });

  cached = {
    cobble: [cut(floors, 6, 10), cut(floors, 7, 10), cut(floors, 8, 10), cut(floors, 6, 11), cut(floors, 7, 11), cut(floors, 8, 11)],
    dirt: [cut(floors, 11, 10), cut(floors, 12, 10), cut(floors, 13, 10)],
    grass: [cut(floors, 1, 10), cut(floors, 2, 10), cut(floors, 3, 10)],
    water: [cut(water, 0, 4), cut(water, 6, 4), cut(water, 1, 4), cut(water, 7, 4)], // deep-water fill + ripples
    sand: [cut(floors, 5, 22), cut(floors, 6, 22), cut(floors, 7, 22)], // beach shore
  };
  return cached;
}

// ===== Dual-grid autotile ground =====
// The display grid is offset by half a tile; each display tile picks its texture from
// the 4 logical cells at its corners (sig = TL TR BL BR, 1 = terrain present). This
// gives soft organic edges for dirt paths and water shorelines (see ground.ts).

// Dirt-on-grass blob (Floors sheet, blob at cols 10-14 rows 0-4; transparent edges).
export const DIRT_GMAP: Record<string, [number, number] | "fill" | null> = {
  "0000": null, "1110": [1, 0], "1100": [2, 0], "1101": [3, 0], "1000": [1, 1],
  "0100": [3, 1], "1010": [0, 2], "0101": [4, 2], "1011": [0, 3], "0010": [1, 3],
  "0001": [3, 3], "0111": [4, 3], "0011": [2, 4], "0110": "fill", "1001": "fill", "1111": "fill",
};
// Water island blob (Water sheet, grass+sand+water at cols 0-4 rows 0-4; grass = 1).
export const WATER_GMAP: Record<string, [number, number]> = {
  "0000": [0, 0], "0001": [1, 0], "0011": [2, 0], "0010": [3, 0], "0111": [1, 1],
  "1111": [2, 1], "1011": [3, 1], "0101": [0, 2], "1010": [4, 2], "0100": [0, 3],
  "1101": [1, 3], "1110": [3, 3], "1000": [4, 3], "1100": [2, 4], "0110": [0, 0], "1001": [2, 1],
};

export interface GroundTiles {
  grass: Texture; // base land (tinted per-cell for soft brightness variation)
  dirtFill: Texture[];
  waterFill: Texture[];
  dirtTile(tx: number, ty: number): Texture; // dirt blob (+10 col offset baked in)
  waterTile(tx: number, ty: number): Texture; // water island blob
}

let groundCache: GroundTiles | null = null;

export async function loadGroundTiles(): Promise<GroundTiles> {
  if (groundCache) return groundCache;
  const [floors, water] = await Promise.all([
    Assets.load("/assets/tilesets/Floors_Tiles.png"),
    Assets.load("/assets/tilesets/Water_tiles.png"),
  ]);
  floors.source.scaleMode = "nearest";
  water.source.scaleMode = "nearest";
  const cut = (src: Texture, tx: number, ty: number) =>
    new Texture({ source: src.source, frame: new Rectangle(tx * SRC_TILE, ty * SRC_TILE, SRC_TILE, SRC_TILE) });
  groundCache = {
    grass: cut(floors, 2, 10),
    dirtFill: [cut(floors, 11, 10), cut(floors, 12, 10), cut(floors, 13, 10)],
    waterFill: [cut(water, 1, 6), cut(water, 2, 7), cut(water, 1, 8), cut(water, 3, 6)],
    dirtTile: (tx, ty) => cut(floors, 10 + tx, ty),
    waterTile: (tx, ty) => cut(water, tx, ty),
  };
  return groundCache;
}

/** Smooth value-noise in [0,1) — organic patches for terrain & grass tint (no Math.random). */
export function vnoise(x: number, y: number, period: number, seed: number): number {
  const xx = x / period, yy = y / period;
  const ix = Math.floor(xx), iy = Math.floor(yy);
  const fx = xx - ix, fy = yy - iy;
  const n = (a: number, b: number) => {
    let h = (Math.imul(a + seed * 9176, 374761393) ^ Math.imul(b - seed * 668265, 668265263)) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0;
    return (h % 100000) / 100000;
  };
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = n(ix, iy), b = n(ix + 1, iy), c = n(ix, iy + 1), d = n(ix + 1, iy + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

// ----- Ore crystals (blue gems sliced from the Pixel Crawler "Rocks" sheet) -----
// Each crystal occupies a 16x32 column (rows 17-18). Frames are ordered biggest ->
// smallest so the node visibly shrinks as its HP drops.

export const CRYSTAL_W = 16;
export const CRYSTAL_H = 32;

let crystalCache: Texture[] | null = null;

export async function loadCrystalFrames(): Promise<Texture[]> {
  if (crystalCache) return crystalCache;

  const sheet: Texture = await Assets.load("/assets/props/Rocks.png");
  const source = sheet.source;
  source.scaleMode = "nearest";

  const frame = (tx: number): Texture =>
    new Texture({
      source,
      frame: new Rectangle(tx * SRC_TILE, 17 * SRC_TILE, CRYSTAL_W, CRYSTAL_H),
    });

  // Columns ordered by visual mass: 9 (largest) -> 11 -> 10 -> 12 (smallest).
  crystalCache = [frame(9), frame(11), frame(10), frame(12)];
  return crystalCache;
}

/** Pick the crystal frame matching the node's remaining HP fraction. */
export function crystalFrameForHp(frames: Texture[], hp: number, maxHp: number): Texture {
  const r = hp / maxHp;
  if (r > 0.75) return frames[0];
  if (r > 0.5) return frames[1];
  if (r > 0.25) return frames[2];
  return frames[3];
}

// ----- Diamond cluster -----
// An ore node is a *cluster* of crystals (not one upright spike). Offsets are in
// source pixels relative to the node base; crystals further back/left are drawn first.
// As HP drops we reveal fewer, smaller shards.

export interface Shard {
  frame: number; // index into the crystal frames (0=big .. 3=small)
  dx: number;
  dy: number;
  flip: boolean;
}

const CLUSTER: Shard[] = [
  { frame: 2, dx: -8, dy: -2, flip: true }, // back-left
  { frame: 2, dx: 8, dy: -2, flip: false }, // back-right
  { frame: 0, dx: 0, dy: 1, flip: false }, // tall center
  { frame: 3, dx: -7, dy: 3, flip: true }, // front-left shard
  { frame: 3, dx: 7, dy: 3, flip: false }, // front-right shard
];

/** Which shards are present at a given HP fraction (full node -> shrinking cluster). */
export function clusterForHp(hp: number, maxHp: number): Shard[] {
  const r = hp / maxHp;
  if (r > 0.75) return CLUSTER; // all 5
  if (r > 0.5) return [CLUSTER[0], CLUSTER[1], CLUSTER[2], CLUSTER[4]];
  if (r > 0.25) return [CLUSTER[2], CLUSTER[3], CLUSTER[4]].map((s) => ({ ...s, frame: 2 }));
  return [{ frame: 3, dx: 0, dy: 1, flip: false }]; // last small shard
}

/** Deterministic per-cell value in [0,1). Stable across redraws (no Math.random). */
export function cellHash(gx: number, gy: number): number {
  let h = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  return (h % 100000) / 100000;
}

/** Pick a variant from a list using the cell hash. */
export function pickVariant<T>(list: T[], gx: number, gy: number): T {
  return list[Math.floor(cellHash(gx + 11, gy + 7) * list.length) % list.length];
}
