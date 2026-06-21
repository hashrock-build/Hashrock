// Loads the curated world art from public/assets/world/ (listed in manifest.json):
// clean trees, bushes/flowers/ferns/tufts, rocks, composited houses, farm pieces and
// decor accessories. All are native-resolution pixel art drawn at scale 2 to match the
// 16->32 tile pixels.

import { Assets, Texture, Rectangle } from "pixi.js";

export interface PropDef {
  texture: Texture;
  footW: number; // blocked tiles wide
  footH: number; // blocked tiles tall
  anchorX: number;
  anchorY: number; // feet sit on the base row
  scale: number;
  tint?: number; // optional recolour (e.g. glowing cave crystals)
  glow?: number; // optional bioluminescent halo colour (additive glow behind the sprite — cave flora)
}

export interface WorldProps {
  trees: PropDef[];
  bushes: PropDef[];
  flowers: PropDef[];
  ferns: PropDef[];
  tufts: PropDef[];
  rocks: PropDef[];
  houses: PropDef[];
  fenceH: PropDef;
  fencePost: PropDef;
  scarecrow: PropDef;
  crops: PropDef[];
  decor: PropDef[];
  caveRocks: PropDef[]; // M5 cave BLOCKING growths — mushrooms + coral (Cave pack)
  caveDecor: PropDef[]; // M5 cave ground dressing — small mushrooms / coral / stalagmites / pebbles / moss
  forgeDecor: PropDef[]; // M5 forge lava crystal spikes
  forgeRocks: PropDef[]; // M5 forge obsidian boulders (blocking)
  gardenRocks: PropDef[]; // M5 garden cypress/shrubs/urns/fountains (blocking)
  gardenDecor: PropDef[]; // M5 garden flowers (ground dressing)
}

const SCALE = 2;
const def = (texture: Texture, o: Partial<PropDef> = {}): PropDef => ({
  texture, footW: 1, footH: 1, anchorX: 0.5, anchorY: 0.92, scale: SCALE, ...o,
});

let cache: WorldProps | null = null;

export async function loadProps(): Promise<WorldProps> {
  if (cache) return cache;
  const man: Record<string, string[]> = await (await fetch("/assets/world/manifest.json")).json();
  const load = async (sub: string, file: string): Promise<Texture> => {
    const t: Texture = await Assets.load(`/assets/world/${sub}/${file}`);
    t.source.scaleMode = "nearest";
    return t;
  };
  const loadAll = (sub: string, files: string[]) => Promise.all(files.map((f) => load(sub, f)));
  const pick = (sub: string, pred: (f: string) => boolean) => man[sub].filter(pred);

  const [trees, bushFiles, flowerFiles, fernFiles, tuftFiles, rocks, houseFiles] = await Promise.all([
    loadAll("trees", man.trees),
    loadAll("veg", pick("veg", (f) => f.startsWith("bush"))),
    loadAll("veg", pick("veg", (f) => f.startsWith("flower"))),
    loadAll("veg", pick("veg", (f) => f.startsWith("fern"))),
    loadAll("veg", pick("veg", (f) => f.startsWith("tuft"))),
    loadAll("rocks", man.rocks),
    loadAll("houses", man.houses),
  ]);
  const farmFiles = man.farm;
  const ff = (name: string) => load("farm", farmFiles.find((f) => f.includes(name))!);
  const [fenceH, fencePost, scarecrow, ...cropTex] = await Promise.all([
    ff("fence_h"), ff("fence_post"), ff("scarecrow"),
    ...pick("farm", (f) => f.startsWith("crop_")).map((f) => load("farm", f)),
  ]);
  const decor = await loadAll("decor", man.decor);

  // M5 cave flora — REAL art from the dedicated Pixel Crawler Cave pack (Cave_Props.png =
  // purple mushrooms, Cave_Tiles.png = red coral / stalagmites / pebbles / moss), cut pixel-exact
  // (component scan, no clipping). caveRocks = BLOCKING; caveDecor = ground dressing.
  // ⚠ LIST LENGTHS ARE LOCKED (caveRocks=7, caveDecor=12): shared/mapgen encodes the variant index
  // as v=(k+0.5)/N, so N here MUST equal the count mapgen divides by, or indices shift.
  const cp: Texture = await Assets.load("/assets/props/Cave_Props.png");
  const ct: Texture = await Assets.load("/assets/props/Cave_Tiles.png");
  cp.source.scaleMode = "nearest"; ct.source.scaleMode = "nearest";
  const ppx = (x: number, y: number, w: number, h: number) => new Texture({ source: cp.source, frame: new Rectangle(x, y, w, h) });
  const tpx = (x: number, y: number, w: number, h: number) => new Texture({ source: ct.source, frame: new Rectangle(x, y, w, h) });
  const MGLOW = 0x9a8cff, CGLOW = 0xff5a6a; // bioluminescent halos — violet for mushrooms, red for coral
  const caveRocks = [                                  // BLOCKING cave growths (mushrooms + coral)
    def(ppx(196, 49, 53, 45), { anchorY: 0.95, glow: MGLOW }),   // 0 medium mushroom
    def(ppx(196, 1, 53, 45), { anchorY: 0.95, glow: MGLOW }),    // 1 medium mushroom (variant)
    def(tpx(148, 114, 41, 44), { anchorY: 0.95, glow: CGLOW }),  // 2 red coral (medium)
    def(tpx(193, 117, 46, 41), { anchorY: 0.95, glow: CGLOW }),  // 3 red coral cluster
    def(ppx(99, 3, 87, 88), { anchorY: 0.96, scale: 1.7, glow: MGLOW }),   // 4 GIANT mushroom (landmark)
    def(ppx(226, 96, 60, 96), { anchorY: 0.97, scale: 1.7, glow: MGLOW }), // 5 tall mushroom (landmark)
    def(tpx(97, 117, 46, 59), { anchorY: 0.95, glow: CGLOW }),   // 6 big red coral (landmark)
  ];
  const caveDecor = [                                 // non-blocking ground dressing
    def(ppx(291, 3, 27, 28), { anchorY: 0.95, glow: MGLOW }),    // 0 small mushroom
    def(ppx(322, 2, 27, 28), { anchorY: 0.95, glow: MGLOW }),    // 1 small mushroom
    def(ppx(291, 35, 27, 28), { anchorY: 0.95, glow: MGLOW }),   // 2 small mushroom (drip)
    def(ppx(257, 64, 14, 16), { anchorY: 0.95, glow: MGLOW }),   // 3 tiny mushroom
    def(ppx(291, 68, 10, 11), { anchorY: 0.95, glow: MGLOW }),   // 4 tiny mushroom
    def(tpx(210, 16, 12, 32), { anchorY: 1 }),      // 5 tall stalagmite
    def(tpx(226, 32, 12, 16), { anchorY: 1 }),      // 6 small stalagmite
    def(tpx(149, 162, 23, 28), { anchorY: 0.95, glow: CGLOW }),  // 7 small coral
    def(tpx(214, 163, 23, 24), { anchorY: 0.95, glow: CGLOW }),  // 8 small coral
    def(tpx(116, 24, 8, 7), { anchorY: 0.85 }),     // 9 pebble
    def(tpx(194, 67, 12, 8), { anchorY: 0.85 }),    // 10 pebbles
    def(tpx(179, 209, 74, 78), { anchorY: 0.6, scale: 1.4 }), // 11 moss patch (flat ground)
  ];
  // forge props — REAL forge art cut pixel-exact (component scan, no clipping) from the dedicated
  // Pixel Crawler Forge pack tileset (public/assets/props/Forge_Tiles.png). No recolour needed —
  // these are already on-theme (dark stone + molten-orange highlights).
  const fk: Texture = await Assets.load("/assets/props/Forge_Tiles.png");
  fk.source.scaleMode = "nearest";
  const fpx = (x: number, y: number, w: number, h: number) => new Texture({ source: fk.source, frame: new Rectangle(x, y, w, h) });
  const forgeRocks = [                                  // BLOCKING forge clutter (statues + barrels + crates)
    def(fpx(194, 150, 28, 58), { anchorY: 0.97 }),  // dwarf golem statue (tall centerpiece)
    def(fpx(226, 164, 28, 44), { anchorY: 0.97 }),  // anvil-on-pedestal statue
    def(fpx(110, 249, 18, 23), { anchorY: 0.95 }),  // skull barrel (red)
    def(fpx(128, 249, 16, 23), { anchorY: 0.95 }),  // wooden barrel
    def(fpx(144, 249, 16, 23), { anchorY: 0.95 }),  // ember barrel
    def(fpx(110, 282, 17, 29), { anchorY: 0.95 }),  // quench (water) barrel — full height (was clipped)
    def(fpx(164, 249, 22, 23), { anchorY: 0.95 }),  // iron-bound crate
    def(fpx(186, 249, 22, 23), { anchorY: 0.95 }),  // iron-bound crate (variant)
  ];
  const forgeDecor = [                                 // non-blocking ground dressing (mostly loose rubble)
    def(fpx(83, 99, 9, 11), { anchorY: 0.9 }),      // loose stone chunk
    def(fpx(100, 100, 7, 9), { anchorY: 0.9 }),     // small stone
    def(fpx(116, 115, 10, 8), { anchorY: 0.9 }),    // broken brick
    def(fpx(67, 101, 10, 6), { anchorY: 0.9 }),     // flat slab
    def(fpx(195, 33, 10, 13), { anchorY: 0.95 }),   // glowing lava vent (orange-ring accent)
    def(fpx(226, 212, 28, 28), { anchorY: 0.95 }),  // forge crucible / mould (occasional)
  ];

  // M5 garden — REAL art cut pixel-exact (component scan, verified no clipping) from the dedicated
  // Pixel Crawler Garden pack tileset. ⚠ LIST LENGTHS LOCKED (gardenRocks=9, gardenDecor=8): mapgen
  // encodes the variant index as v=(k+0.5)/N (N=9 rocks, 8 decor).
  const gk: Texture = await Assets.load("/assets/props/Garden_Tiles.png");
  gk.source.scaleMode = "nearest";
  const gpx = (x: number, y: number, w: number, h: number) => new Texture({ source: gk.source, frame: new Rectangle(x, y, w, h) });
  const gardenRocks = [                                 // BLOCKING garden growths/features
    def(gpx(152, 269, 31, 98), { anchorY: 0.95, scale: 1.6 }), // 0 cypress (tall conifer)
    def(gpx(194, 270, 28, 97), { anchorY: 0.95, scale: 1.6 }), // 1 cypress (variant)
    def(gpx(120, 312, 24, 38), { anchorY: 0.9 }),    // 2 shrub
    def(gpx(400, 331, 16, 21), { anchorY: 0.95 }),   // 3 stone urn
    def(gpx(417, 328, 14, 24), { anchorY: 0.95 }),   // 4 stone urn (variant)
    def(gpx(67, 368, 74, 32), { anchorY: 0.85, scale: 1 }),   // 5 wooden bench (wide)
    def(gpx(443, 100, 37, 68), { anchorY: 0.95 }),   // 6 statue fountain (landmark)
    def(gpx(400, 2, 80, 94), { anchorY: 0.95, scale: 1.3, footW: 2, footH: 2 }), // 7 tiered fountain (centerpiece)
    def(gpx(418, 420, 28, 54), { anchorY: 0.96, scale: 1.2 }), // 8 plain statue (patung)
  ];
  const gardenDecor = [                                // non-blocking flowers (the garden's colour)
    def(gpx(144, 379, 16, 22), { anchorY: 0.9 }),   // 0 flowers
    def(gpx(160, 375, 16, 23), { anchorY: 0.9 }),   // 1
    def(gpx(176, 379, 16, 22), { anchorY: 0.9 }),   // 2
    def(gpx(192, 375, 16, 23), { anchorY: 0.9 }),   // 3
    def(gpx(144, 427, 16, 22), { anchorY: 0.9 }),   // 4
    def(gpx(160, 423, 16, 23), { anchorY: 0.9 }),   // 5
    def(gpx(176, 427, 16, 22), { anchorY: 0.9 }),   // 6
    def(gpx(192, 423, 16, 23), { anchorY: 0.9 }),   // 7
  ];

  cache = {
    trees: trees.map((t) => def(t, { anchorY: 0.95 })),
    bushes: bushFiles.map((t) => def(t, { anchorY: 0.88 })),
    flowers: flowerFiles.map((t) => def(t, { anchorY: 0.85 })),
    ferns: fernFiles.map((t) => def(t, { anchorY: 0.85 })),
    tufts: tuftFiles.map((t) => def(t, { anchorY: 0.82 })),
    rocks: rocks.map((t) => def(t, { anchorY: 0.9 })),
    houses: houseFiles.map((t) => def(t, { footW: 3, footH: 2, anchorY: 0.93 })),
    fenceH: def(fenceH, { anchorY: 0.7 }),
    fencePost: def(fencePost, { anchorY: 0.7 }),
    scarecrow: def(scarecrow, { anchorY: 0.92 }),
    crops: cropTex.map((t) => def(t, { anchorY: 0.8 })),
    decor: decor.map((t) => def(t, { anchorY: 0.88 })),
    caveRocks,
    caveDecor,
    forgeDecor,
    forgeRocks,
    gardenRocks,
    gardenDecor,
  };
  return cache;
}
