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

  // M5 cave flora/crystals — sliced straight from the 16px Vegetation sheet (already in public).
  const veg: Texture = await Assets.load("/assets/props/Vegetation.png");
  veg.source.scaleMode = "nearest";
  const vcut = (tx: number, ty: number) => new Texture({ source: veg.source, frame: new Rectangle(tx * 16, ty * 16, 16, 16) });
  const caveDecor = [
    def(vcut(1, 21), { anchorY: 0.85 }),                 // small mushroom
    def(vcut(2, 21), { anchorY: 0.85 }),                 // mushroom
    def(vcut(3, 21), { anchorY: 0.85 }),                 // big mushroom
    def(vcut(0, 22), { anchorY: 0.8, tint: 0xc77dff }),  // amethyst crystal (red gem recoloured purple)
    def(vcut(1, 22), { anchorY: 0.8 }),                  // blue crystal gem
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
  };
  return cache;
}
