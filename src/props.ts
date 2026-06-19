// Loads the curated world art from public/assets/world/ (listed in manifest.json):
// clean trees, bushes/flowers/ferns/tufts, rocks, composited houses, farm pieces and
// decor accessories. All are native-resolution pixel art drawn at scale 2 to match the
// 16->32 tile pixels.

import { Assets, Texture } from "pixi.js";

export interface PropDef {
  texture: Texture;
  footW: number; // blocked tiles wide
  footH: number; // blocked tiles tall
  anchorX: number;
  anchorY: number; // feet sit on the base row
  scale: number;
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
  };
  return cache;
}
