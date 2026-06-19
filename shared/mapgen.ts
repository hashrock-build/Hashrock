// Deterministic, render-agnostic village generation — the SINGLE SOURCE OF MAP TRUTH,
// imported by BOTH the client (src/village.ts → maps prop types to textures) and the
// server (freeCells for authoritative ore spawn). No PixiJS here.
//
// Ported 1:1 from the original client buildVillage. Props are emitted as {type, v} where
// `v` is the exact variant selector the client uses to pick a texture (pickB compatible),
// so the look is identical while the server only cares about terrain/blocked/freeCells.

export const MAP_W = 112;
export const MAP_H = 112;
export const TILE = 32;
const FOREST_BAND = 15;

// terrain codes (match src/ground.ts)
export const T_GRASS = 0;
export const T_DIRT = 1;
export const T_WATER = 2;

export enum PropType {
  TREE, BUSH, FLOWER, FERN, TUFT, ROCK, HOUSE, FENCE_H, FENCE_POST, SCARECROW, CROP, DECOR,
}

export interface Placed { gx: number; gy: number; type: PropType; v: number; }
export interface VillageData {
  terrain: Uint8Array;
  blocked: Uint8Array;
  freeCells: number[];
  props: Placed[];
  decor: Placed[];
  spawn: { gx: number; gy: number };
}

export const idx = (gx: number, gy: number) => gy * MAP_W + gx;
export const inB = (gx: number, gy: number) => gx >= 0 && gx < MAP_W && gy >= 0 && gy < MAP_H;

export function cellHash(gx: number, gy: number): number {
  let h = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  return (h % 100000) / 100000;
}

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

const rand = (i: number) => cellHash(i * 131 + 7, i * 197 + 3);
const edgeDist = (gx: number, gy: number) => Math.min(gx, gy, MAP_W - 1 - gx, MAP_H - 1 - gy);
const forestStrength = (gx: number, gy: number) => {
  const e = edgeDist(gx, gy);
  if (e >= FOREST_BAND) return 0;
  return Math.max(0, (FOREST_BAND - e) / FOREST_BAND + (vnoise(gx, gy, 9, 2) - 0.5) * 0.45);
};

// pickB-compatible variant selector: client resolves texture = list[floor(v*len)%len]
const vh = (gx: number, gy: number, s: number) => cellHash(gx + s, gy + s * 2);

export function buildVillage(): VillageData {
  const terrain = new Uint8Array(MAP_W * MAP_H);
  const blocked = new Uint8Array(MAP_W * MAP_H);
  const noOre = new Uint8Array(MAP_W * MAP_H);
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
  const markNoOre = (gx: number, gy: number, w: number, h: number) => {
    for (let oy = 0; oy < h; oy++) for (let ox = 0; ox < w; ox++) {
      const cx = gx + ox, cy = gy + oy;
      if (inB(cx, cy)) noOre[idx(cx, cy)] = 1;
    }
  };

  // ---- organic lake (metaballs) ----
  const lakeC = { x: Math.round(MAP_W * 0.34), y: Math.round(MAP_H * 0.6) };
  const balls = [[0, 0, 9], [8, -4, 7], [-6, 7, 7], [4, 9, 6], [-9, -2, 6]].map(([dx, dy, r]) => [lakeC.x + dx, lakeC.y + dy, r]);
  for (let gy = 0; gy < MAP_H; gy++) for (let gx = 0; gx < MAP_W; gx++) {
    if (edgeDist(gx, gy) < FOREST_BAND - 3) continue;
    let v = 0;
    for (const [bx, by, r] of balls) v += (r * r) / ((gx - bx) ** 2 + (gy - by) ** 2 + 1);
    if (v + (vnoise(gx, gy, 5, 4) - 0.5) > 1.05) { terrain[idx(gx, gy)] = T_WATER; blocked[idx(gx, gy)] = 1; }
  }

  // ---- houses ----
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

  // ---- dirt roads ----
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

  // ---- place houses + ring decor ----
  houses.forEach((hs, hi) => {
    block(hs.gx, hs.gy, hs.w, hs.h);
    markNoOre(hs.gx - 2, hs.gy - 2, hs.w + 4, hs.h + 4);
    props.push({ gx: hs.gx, gy: hs.gy, type: PropType.HOUSE, v: vh(hs.gx, hs.gy, hi) });
    for (let oy = -1; oy <= hs.h; oy++) for (let ox = -1; ox <= hs.w; ox++) {
      const inside = ox >= 0 && ox < hs.w && oy >= 0 && oy < hs.h;
      if (inside) continue;
      const gx = hs.gx + ox, gy = hs.gy + oy;
      if (!free(gx, gy) || terrain[idx(gx, gy)] === T_DIRT) continue;
      const r = cellHash(gx + 3, gy + hi);
      if (r < 0.35) decor.push({ gx, gy, type: PropType.FLOWER, v: vh(gx, gy, 1) });
      else if (r < 0.45) { props.push({ gx, gy, type: PropType.DECOR, v: vh(gx, gy, hi + 2) }); blocked[idx(gx, gy)] = 1; }
      else if (r < 0.6) decor.push({ gx, gy, type: PropType.TUFT, v: vh(gx, gy, 4) });
    }
  });

  // ---- farm ----
  if (houses.length) {
    const h0 = houses[0]; const fw = 9, fh = 7;
    const fx = h0.gx + h0.w + 2, fy = h0.gy;
    if (free(fx, fy, fw, fh)) {
      markNoOre(fx, fy, fw + 1, fh + 1);
      for (let gy = fy; gy < fy + fh; gy++) for (let gx = fx; gx < fx + fw; gx++) if (terrain[idx(gx, gy)] !== T_WATER) terrain[idx(gx, gy)] = T_DIRT;
      const gate = fx + (fw >> 1);
      for (let gx = fx; gx < fx + fw; gx += 3) props.push({ gx, gy: fy, type: PropType.FENCE_H, v: 0 });
      for (let gx = fx; gx < fx + fw; gx += 3) if (Math.abs(gx - gate) > 1) props.push({ gx, gy: fy + fh, type: PropType.FENCE_H, v: 0 });
      for (let gy = fy; gy <= fy + fh; gy++) { props.push({ gx: fx, gy, type: PropType.FENCE_POST, v: 0 }); props.push({ gx: fx + fw, gy, type: PropType.FENCE_POST, v: 0 }); }
      props.push({ gx: gate, gy: fy + 1, type: PropType.SCARECROW, v: 0 });
      for (let gy = fy + 2, ri = 0; gy < fy + fh - 1; gy++, ri++)
        for (let gx = fx + 1; gx < fx + fw - 1; gx++) decor.push({ gx, gy, type: PropType.CROP, v: ri });
    }
  }

  // ---- dense forest ring ----
  for (let gy = 1; gy < MAP_H - 1; gy++) for (let gx = 1; gx < MAP_W - 1; gx++) {
    const fsv = forestStrength(gx, gy);
    if (fsv <= 0 || terrain[idx(gx, gy)] !== T_GRASS || blocked[idx(gx, gy)]) continue;
    const h = cellHash(gx * 2 + 1, gy * 2 + 3);
    if (h < Math.min(0.82, 0.28 + fsv * 0.8)) {
      props.push({ gx, gy, type: PropType.TREE, v: vh(gx, gy, 9) }); blocked[idx(gx, gy)] = 1;
    } else if (h < Math.min(0.96, 0.5 + fsv)) decor.push({ gx, gy, type: PropType.BUSH, v: vh(gx, gy, 5) });
  }

  // ---- sparse interior trees ----
  for (let gy = 2; gy < MAP_H - 2; gy += 3) for (let gx = 2; gx < MAP_W - 2; gx += 3) {
    if (forestStrength(gx, gy) > 0 || terrain[idx(gx, gy)] !== T_GRASS) continue;
    if (cellHash(gx + 5, gy + 7) < 0.06 && free(gx, gy)) { props.push({ gx, gy, type: PropType.TREE, v: vh(gx, gy, 3) }); blocked[idx(gx, gy)] = 1; }
  }

  // ---- rock piles along the shore ----
  for (let gy = 1; gy < MAP_H - 1; gy++) for (let gx = 1; gx < MAP_W - 1; gx++) {
    if (terrain[idx(gx, gy)] !== T_GRASS || blocked[idx(gx, gy)]) continue;
    let nearWater = false;
    for (let dy = -1; dy <= 1 && !nearWater; dy++) for (let dx = -1; dx <= 1; dx++) if (inB(gx + dx, gy + dy) && terrain[idx(gx + dx, gy + dy)] === T_WATER) nearWater = true;
    if (nearWater && cellHash(gx + 1, gy + 9) < 0.5) { props.push({ gx, gy, type: PropType.ROCK, v: vh(gx, gy, 2) }); blocked[idx(gx, gy)] = 1; }
  }

  // ---- light decor scatter ----
  for (let gy = 0; gy < MAP_H; gy++) for (let gx = 0; gx < MAP_W; gx++) {
    if (terrain[idx(gx, gy)] !== T_GRASS || blocked[idx(gx, gy)] || forestStrength(gx, gy) > 0) continue;
    const r = cellHash(gx + 17, gy + 23);
    if (r < 0.01) decor.push({ gx, gy, type: PropType.FLOWER, v: vh(gx, gy, 1) });
    else if (r < 0.05) decor.push({ gx, gy, type: PropType.TUFT, v: vh(gx, gy, 4) });
    else if (r < 0.058 && cellHash(gx, gy) < 0.5) { props.push({ gx, gy, type: PropType.ROCK, v: vh(gx, gy, 8) }); blocked[idx(gx, gy)] = 1; }
  }

  // spawn near center
  let spawn = { gx: C.x, gy: C.y };
  for (let r = 0; r < 30; r++) {
    const gx = C.x + Math.round((rand(r) - 0.5) * 20), gy = C.y + Math.round((rand(r + 5) - 0.5) * 20);
    if (free(gx, gy)) { spawn = { gx, gy }; break; }
  }

  // ore-spawnable cells
  const freeCells: number[] = [];
  for (let gy = 0; gy < MAP_H; gy++) for (let gx = 0; gx < MAP_W; gx++) {
    const i = idx(gx, gy);
    if (blocked[i] || terrain[i] === T_WATER || noOre[i]) continue;
    if (forestStrength(gx, gy) > 0) continue;
    freeCells.push(i);
  }
  return { terrain, blocked, freeCells, props, decor, spawn };
}
