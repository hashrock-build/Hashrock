// Procedural world generation. Rules:
//  1. houses are ringed with flowers + decor accessories
//  2. the farm sits next to a house
//  3. the lake has an organic (metaball) shape, not a circle
//  4. dirt roads connect every house
//  5. the whole map perimeter is dense forest
//  6. forest trees come in dense clusters
//  7. trees in the open interior are sparse (never forest-dense)
//  8. rock piles cluster along the lake shore
// All placement is deterministic (cellHash / vnoise — no Math.random).

import { cellHash, vnoise } from "./tiles";
import { WorldProps, PropDef } from "./props";
import { T_GRASS, T_DIRT, T_WATER } from "./ground";

export const MAP_W = 100;
export const MAP_H = 100;
const FOREST_BAND = 15; // perimeter thickness that turns to forest

export const idx = (gx: number, gy: number) => gy * MAP_W + gx;
export const inB = (gx: number, gy: number) => gx >= 0 && gx < MAP_W && gy >= 0 && gy < MAP_H;

export interface Placed { gx: number; gy: number; def: PropDef; }
export interface Village {
  terrain: Uint8Array;
  blocked: Uint8Array;
  freeCells: number[];
  props: Placed[]; // depth-sorted
  decor: Placed[]; // flat ground dressing
  spawn: { gx: number; gy: number };
}

const rand = (i: number) => cellHash(i * 131 + 7, i * 197 + 3);
const edgeDist = (gx: number, gy: number) => Math.min(gx, gy, MAP_W - 1 - gx, MAP_H - 1 - gy);
// >0 inside the forest ring (organic boundary via noise), 0 in the open interior
const forestStrength = (gx: number, gy: number) =>
  Math.max(0, (FOREST_BAND - edgeDist(gx, gy)) / FOREST_BAND + (vnoise(gx, gy, 9, 2) - 0.5) * 0.7);

export function buildVillage(P: WorldProps): Village {
  const terrain = new Uint8Array(MAP_W * MAP_H);
  const blocked = new Uint8Array(MAP_W * MAP_H);
  const props: Placed[] = [];
  const decor: Placed[] = [];
  const C = { x: MAP_W >> 1, y: MAP_H >> 1 };

  const free = (gx: number, gy: number, w = 1, h = 1) => {
    for (let oy = 0; oy < h; oy++) for (let ox = 0; ox < w; ox++) {
      const cx = gx + ox, cy = gy + oy;
      if (!inB(cx, cy) || blocked[idx(cx, cy)] || terrain[idx(cx, cy)] === T_WATER) return false;
    }
    return true;
  };
  const block = (gx: number, gy: number, w: number, h: number) => {
    for (let oy = 0; oy < h; oy++) for (let ox = 0; ox < w; ox++) blocked[idx(gx + ox, gy + oy)] = 1;
  };
  const pickB = <T,>(l: T[], gx: number, gy: number, s = 0) => l[Math.floor(cellHash(gx + s, gy + s * 2) * l.length) % l.length];

  // ---- 3) organic lake (metaballs) in the open interior ----
  const lakeC = { x: Math.round(MAP_W * 0.34), y: Math.round(MAP_H * 0.6) };
  const balls = [[0, 0, 9], [8, -4, 7], [-6, 7, 7], [4, 9, 6], [-9, -2, 6]].map(([dx, dy, r]) => [lakeC.x + dx, lakeC.y + dy, r]);
  for (let gy = 0; gy < MAP_H; gy++) for (let gx = 0; gx < MAP_W; gx++) {
    if (edgeDist(gx, gy) < FOREST_BAND - 3) continue; // keep lake out of the forest ring
    let v = 0;
    for (const [bx, by, r] of balls) v += (r * r) / ((gx - bx) ** 2 + (gy - by) ** 2 + 1);
    if (v + (vnoise(gx, gy, 5, 4) - 0.5) > 1.05) { terrain[idx(gx, gy)] = T_WATER; blocked[idx(gx, gy)] = 1; }
  }

  // ---- houses in the open interior, spaced apart, clear of lake/forest ----
  const houses: { gx: number; gy: number; w: number; h: number }[] = [];
  for (let i = 0; i < 30 && houses.length < 4; i++) {
    const gx = 18 + Math.floor(rand(i + 40) * (MAP_W - 40));
    const gy = 16 + Math.floor(rand(i + 80) * (MAP_H - 36));
    const w = 4, h = 3;
    if (forestStrength(gx, gy) > 0.05) continue;
    if (!free(gx - 2, gy - 2, w + 4, h + 5)) continue;
    if (houses.some((o) => Math.abs(o.gx - gx) < 16 && Math.abs(o.gy - gy) < 14)) continue;
    houses.push({ gx, gy, w, h });
  }

  // ---- 4) dirt roads connecting every house (L-shaped, 2 wide) ----
  const paveRoad = (ax: number, ay: number, bx: number, by: number) => {
    const lay = (x: number, y: number) => { for (const [dx, dy] of [[0, 0], [1, 0]]) { const cx = x + dx, cy = y + dy; if (inB(cx, cy) && terrain[idx(cx, cy)] !== T_WATER) terrain[idx(cx, cy)] = T_DIRT; } };
    let x = ax;
    for (; x !== bx; x += Math.sign(bx - x)) lay(x, ay);
    let y = ay;
    for (; y !== by; y += Math.sign(by - y)) lay(bx, y);
    lay(bx, by);
  };
  for (let i = 1; i < houses.length; i++) {
    const a = houses[i - 1], b = houses[i];
    paveRoad(a.gx + 1, a.gy + a.h, b.gx + 1, b.gy + b.h);
  }

  // place houses + ring them with flowers and decor (rule 1)
  houses.forEach((hs, hi) => {
    block(hs.gx, hs.gy, hs.w, hs.h);
    props.push({ gx: hs.gx, gy: hs.gy, def: pickB(P.houses, hs.gx, hs.gy, hi) });
    // surrounding ring cells
    for (let oy = -1; oy <= hs.h; oy++) for (let ox = -1; ox <= hs.w; ox++) {
      const inside = ox >= 0 && ox < hs.w && oy >= 0 && oy < hs.h;
      if (inside) continue;
      const gx = hs.gx + ox, gy = hs.gy + oy;
      if (!free(gx, gy) || terrain[idx(gx, gy)] === T_DIRT) continue;
      const r = cellHash(gx + 3, gy + hi);
      if (r < 0.35) decor.push({ gx, gy, def: pickB(P.flowers, gx, gy, 1) });
      else if (r < 0.45) { props.push({ gx, gy, def: pickB(P.decor, gx, gy, hi + 2) }); blocked[idx(gx, gy)] = 1; }
      else if (r < 0.6) decor.push({ gx, gy, def: pickB(P.tufts, gx, gy, 4) });
    }
  });

  // ---- 2) farm next to the first house ----
  if (houses.length) {
    const h0 = houses[0]; const fw = 9, fh = 7;
    const fx = h0.gx + h0.w + 2, fy = h0.gy;
    if (free(fx, fy, fw, fh)) {
      for (let gy = fy; gy < fy + fh; gy++) for (let gx = fx; gx < fx + fw; gx++) if (terrain[idx(gx, gy)] !== T_WATER) terrain[idx(gx, gy)] = T_DIRT;
      const gate = fx + (fw >> 1);
      for (let gx = fx; gx < fx + fw; gx += 3) props.push({ gx, gy: fy, def: P.fenceH });
      for (let gx = fx; gx < fx + fw; gx += 3) if (Math.abs(gx - gate) > 1) props.push({ gx, gy: fy + fh, def: P.fenceH });
      for (let gy = fy; gy <= fy + fh; gy++) { props.push({ gx: fx, gy, def: P.fencePost }); props.push({ gx: fx + fw, gy, def: P.fencePost }); }
      props.push({ gx: gate, gy: fy + 1, def: P.scarecrow });
      for (let gy = fy + 2, ri = 0; gy < fy + fh - 1; gy++, ri++)
        for (let gx = fx + 1; gx < fx + fw - 1; gx++) decor.push({ gx, gy, def: P.crops[ri % P.crops.length] });
    }
  }

  // ---- 5,6) dense forest clusters around the whole perimeter ----
  for (let gy = 1; gy < MAP_H - 1; gy++) for (let gx = 1; gx < MAP_W - 1; gx++) {
    const fsv = forestStrength(gx, gy);
    if (fsv <= 0 || terrain[idx(gx, gy)] !== T_GRASS || blocked[idx(gx, gy)]) continue;
    const h = cellHash(gx * 2 + 1, gy * 2 + 3);
    if (h < Math.min(0.55, fsv * 0.6)) {
      props.push({ gx, gy, def: pickB(P.trees, gx, gy, 9) }); blocked[idx(gx, gy)] = 1;
    } else if (h < fsv * 0.75) decor.push({ gx, gy, def: pickB(P.bushes, gx, gy, 5) });
  }

  // ---- 7) sparse single trees in the open interior ----
  for (let gy = 2; gy < MAP_H - 2; gy += 3) for (let gx = 2; gx < MAP_W - 2; gx += 3) {
    if (forestStrength(gx, gy) > 0 || terrain[idx(gx, gy)] !== T_GRASS) continue;
    if (cellHash(gx + 5, gy + 7) < 0.06 && free(gx, gy)) { props.push({ gx, gy, def: pickB(P.trees, gx, gy, 3) }); blocked[idx(gx, gy)] = 1; }
  }

  // ---- 8) rock piles along the lake shore ----
  for (let gy = 1; gy < MAP_H - 1; gy++) for (let gx = 1; gx < MAP_W - 1; gx++) {
    if (terrain[idx(gx, gy)] !== T_GRASS || blocked[idx(gx, gy)]) continue;
    let nearWater = false;
    for (let dy = -1; dy <= 1 && !nearWater; dy++) for (let dx = -1; dx <= 1; dx++) if (inB(gx + dx, gy + dy) && terrain[idx(gx + dx, gy + dy)] === T_WATER) nearWater = true;
    if (nearWater && cellHash(gx + 1, gy + 9) < 0.5) { props.push({ gx, gy, def: pickB(P.rocks, gx, gy, 2) }); blocked[idx(gx, gy)] = 1; }
  }

  // ---- light decor scatter on open grass (flowers sparse, tufts a bit more) ----
  for (let gy = 0; gy < MAP_H; gy++) for (let gx = 0; gx < MAP_W; gx++) {
    if (terrain[idx(gx, gy)] !== T_GRASS || blocked[idx(gx, gy)] || forestStrength(gx, gy) > 0) continue;
    const r = cellHash(gx + 17, gy + 23);
    if (r < 0.01) decor.push({ gx, gy, def: pickB(P.flowers, gx, gy, 1) });
    else if (r < 0.05) decor.push({ gx, gy, def: pickB(P.tufts, gx, gy, 4) });
    else if (r < 0.058 && cellHash(gx, gy) < 0.5) { props.push({ gx, gy, def: pickB(P.rocks, gx, gy, 8) }); blocked[idx(gx, gy)] = 1; }
  }

  // spawn: an open cell near map center
  let spawn = { gx: C.x, gy: C.y };
  for (let r = 0; r < 30; r++) {
    const gx = C.x + Math.round((rand(r) - 0.5) * 20), gy = C.y + Math.round((rand(r + 5) - 0.5) * 20);
    if (free(gx, gy)) { spawn = { gx, gy }; break; }
  }

  const freeCells: number[] = [];
  for (let i = 0; i < blocked.length; i++) if (!blocked[i] && terrain[i] !== T_WATER) freeCells.push(i);
  return { terrain, blocked, freeCells, props, decor, spawn };
}
