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
  caveDecor: PropDef[]; // M5 cave flora/crystals — mushrooms + gems (sliced from Vegetation.png)
  forgeDecor: PropDef[]; // M5 forge lava crystal spikes
  forgeRocks: PropDef[]; // M5 forge obsidian boulders (blocking)
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

  // M5 cave flora/crystals — cut by EXACT sprite bounds (pixel rects from a component scan) so
  // nothing is clipped (the 16px grid sliced through the mushroom stems). anchorY:1 = feet on ground.
  const veg: Texture = await Assets.load("/assets/props/Vegetation.png");
  veg.source.scaleMode = "nearest";
  const vpx = (x: number, y: number, w: number, h: number) => new Texture({ source: veg.source, frame: new Rectangle(x, y, w, h) });
  const caveDecor = [
    def(vpx(21, 341, 5, 7), { anchorY: 1 }),                  // small mushroom
    def(vpx(36, 340, 8, 9), { anchorY: 1 }),                  // mushroom
    def(vpx(49, 338, 14, 14), { anchorY: 1 }),               // big mushroom
    def(vpx(3, 353, 11, 14), { anchorY: 1, tint: 0xc77dff }), // amethyst crystal (red gem → purple)
    def(vpx(19, 353, 11, 14), { anchorY: 1 }),               // blue crystal gem
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
    caveDecor,
    forgeDecor,
    forgeRocks,
  };
  return cache;
}
