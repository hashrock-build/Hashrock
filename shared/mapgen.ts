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
export const T_WALL = 3; // cave/dungeon wall — blocks the player + ore, rendered as a wall tile

export enum PropType {
  TREE, BUSH, FLOWER, FERN, TUFT, ROCK, HOUSE, FENCE_H, FENCE_POST, SCARECROW, CROP, DECOR,
  CAVE_DECOR, // M5 cave flora/crystals (mushrooms + gems)
  FORGE_DECOR, // M5 forge lava crystals
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

// ───────────────────────── CAVE / DUNGEON ZONE (M5 themed mining zone) ─────────────────────────
// A SEPARATE deterministic map (not the village): cellular-automata caverns of rock wall vs open
// floor, guaranteed fully connected (flood-fill from the spawn room; unreachable pockets are
// sealed so no ore is ever stranded). Same VillageData shape, so the server (freeCells) and the
// client (render) consume it identically. Terrain: T_GRASS = floor (rendered with the cave floor
// tileset), T_WALL = solid rock. Props: ROCK = boulders/stalagmites scattered on the floor.

const FLOOR = T_GRASS; // floor reuses code 0; the zone's tileset decides how it looks

// Shared cellular-automata cavern carver. `seed` shifts the layout (each zone gets a different
// cave); `flora` adds mushrooms/crystals (cave) vs bare rock (forge). buildCave/buildForge wrap it.
function carveCaverns(seed: number, decorKind: "cave" | "forge", boulderRate: number, decorRate: number): VillageData {
  const W = MAP_W, H = MAP_H, N = W * H;
  const terrain = new Uint8Array(N);
  const blocked = new Uint8Array(N);
  const props: Placed[] = [];
  const decor: Placed[] = [];
  const C = { x: W >> 1, y: H >> 1 };
  const border = (x: number, y: number) => x < 2 || y < 2 || x >= W - 2 || y >= H - 2;

  // 1) deterministic initial fill — solid border + ~46% interior rock
  let cur = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    cur[idx(x, y)] = border(x, y) ? 1 : (cellHash(x * 3 + 1 + seed, y * 3 + 7 + seed) < 0.46 ? 1 : 0);

  // 2) cellular-automata smoothing → organic caverns (4-5-rule)
  const wallNeighbours = (s: Uint8Array, x: number, y: number) => {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      c += !inB(nx, ny) ? 1 : s[idx(nx, ny)];
    }
    return c;
  };
  for (let it = 0; it < 5; it++) {
    const next = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (border(x, y)) { next[idx(x, y)] = 1; continue; }
      const n = wallNeighbours(cur, x, y);
      next[idx(x, y)] = n >= 5 ? 1 : n <= 3 ? 0 : cur[idx(x, y)];
    }
    cur = next;
  }

  // 3) carve an open spawn room at the centre
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++)
    if (inB(C.x + dx, C.y + dy)) cur[idx(C.x + dx, C.y + dy)] = 0;

  // 3b) despeckle: drop lone wall nubs + fill lone floor pockets → smoother, rounder edges
  for (let pass = 0; pass < 2; pass++) {
    const next = cur.slice();
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = idx(x, y), n = wallNeighbours(cur, x, y);
      if (cur[i] === 1 && n <= 2) next[i] = 0;       // isolated wall nub → floor
      else if (cur[i] === 0 && n >= 6) next[i] = 1;  // pinched floor pocket → wall
    }
    cur = next;
  }

  // 3c) erase tiny isolated wall regions (mini-pits/specks) — only big caverns survive
  const seen = new Uint8Array(N);
  for (let i0 = 0; i0 < N; i0++) {
    if (cur[i0] !== 1 || seen[i0]) continue;
    const region: number[] = [], st = [i0]; seen[i0] = 1;
    let touchesBorder = false;
    while (st.length) {
      const i = st.pop()!, x = i % W, y = (i / W) | 0;
      region.push(i);
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) touchesBorder = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (!seen[ni] && cur[ni] === 1) { seen[ni] = 1; st.push(ni); }
      }
    }
    if (!touchesBorder && region.length < 14) for (const i of region) cur[i] = 0; // dissolve speck
  }

  // reusable flood-fill: reachable open cells from spawn given a "blocked" predicate
  const flood = (isBlocked: (i: number) => boolean): Uint8Array => {
    const reach = new Uint8Array(N), s0 = idx(C.x, C.y);
    if (isBlocked(s0)) return reach;
    const stack = [s0]; reach[s0] = 1;
    while (stack.length) {
      const i = stack.pop()!, x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (!reach[ni] && !isBlocked(ni)) { reach[ni] = 1; stack.push(ni); }
      }
    }
    return reach;
  };

  // 4) seal floor caverns not connected to spawn (one contiguous cave; no orphan rooms)
  const reach1 = flood((i) => cur[i] === 1);
  for (let i = 0; i < N; i++) if (!cur[i] && !reach1[i]) cur[i] = 1;

  // 5) terrain
  for (let i = 0; i < N; i++) {
    if (cur[i]) { terrain[i] = T_WALL; blocked[i] = 1; }
    else terrain[i] = FLOOR;
  }
  // sparse, clean dressing on the floor (skip the spawn room): occasional standalone boulder +
  // a light scatter of small loose stones. No clusters — keep the cavern open and uncluttered.
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = idx(x, y);
    if (terrain[i] !== FLOOR) continue;
    if (Math.abs(x - C.x) < 4 && Math.abs(y - C.y) < 4) continue;
    const r = cellHash(x + 11 + seed, y + 5 + seed);
    if (r < boulderRate) { props.push({ gx: x, gy: y, type: PropType.ROCK, v: vh(x, y, 2) }); blocked[i] = 1; } // boulder (cave rocks / forge obsidian)
    else if (decorKind === "cave" && r < boulderRate + 0.013) decor.push({ gx: x, gy: y, type: PropType.ROCK, v: vh(x, y, 8) }); // loose stones (cave only — forge rocks are big)
    else if (cellHash(x + 5 + seed, y + 17 + seed) < decorRate) // flora/crystals (cave) or lava crystals (forge)
      decor.push({ gx: x, gy: y, type: decorKind === "forge" ? PropType.FORGE_DECOR : PropType.CAVE_DECOR, v: vh(x, y, 6) });
  }

  // 6) freeCells = floor reachable AFTER boulders (a boulder in a 1-wide gap can't strand ore)
  const reach2 = flood((i) => blocked[i] === 1 || terrain[i] === T_WALL);
  const freeCells: number[] = [];
  for (let i = 0; i < N; i++) if (reach2[i] && terrain[i] === FLOOR && !blocked[i]) freeCells.push(i);

  return { terrain, blocked, freeCells, props, decor, spawn: { gx: C.x, gy: C.y } };
}

// Cave zone (seed 0 = the original cave, unchanged) + Forge zone (different seed, no flora).
export function buildCave(): VillageData { return carveCaverns(0, "cave", 0.012, 0.035); }
export function buildForge(): VillageData { return carveCaverns(73, "forge", 0.014, 0.06); } // denser obsidian + lava crystals
