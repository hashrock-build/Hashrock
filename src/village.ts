// Client adapter over the shared deterministic map-gen (shared/mapgen.ts is the single
// source of map truth, used by the server too). This layer only maps each placed prop's
// (type, variant) to a concrete Pixi PropDef texture — the geometry/blocking/freeCells
// all come from shared so server & client agree on ore positions exactly.

import { WorldProps, PropDef } from "./props";
import * as gen from "../shared/mapgen";

export const MAP_W = gen.MAP_W;
export const MAP_H = gen.MAP_H;
export const idx = gen.idx;
export const inB = gen.inB;

export interface Placed { gx: number; gy: number; def: PropDef; }
export interface Village {
  terrain: Uint8Array;
  blocked: Uint8Array;
  freeCells: number[];
  props: Placed[]; // depth-sorted
  decor: Placed[]; // flat ground dressing
  spawn: { gx: number; gy: number };
}

export function buildVillage(P: WorldProps): Village {
  return adapt(gen.buildVillage(), P);
}

/** M5 cave/dungeon zone — same adapter, different deterministic map (shared/mapgen buildCave). */
export function buildCave(P: WorldProps): Village {
  return adapt(gen.buildCave(), P);
}

/** M5 forge/volcanic zone — lava-cavern layout (shared/mapgen buildForge). */
export function buildForge(P: WorldProps): Village {
  return adapt(gen.buildForge(), P, "forge");
}

function adapt(g: gen.VillageData, P: WorldProps, zone = "village"): Village {
  const lists: Record<gen.PropType, PropDef[] | PropDef> = {
    [gen.PropType.TREE]: P.trees,
    [gen.PropType.BUSH]: P.bushes,
    [gen.PropType.FLOWER]: P.flowers,
    [gen.PropType.FERN]: P.ferns,
    [gen.PropType.TUFT]: P.tufts,
    [gen.PropType.ROCK]: zone === "forge" ? P.forgeRocks : P.rocks, // obsidian boulders in the forge
    [gen.PropType.HOUSE]: P.houses,
    [gen.PropType.DECOR]: P.decor,
    [gen.PropType.CROP]: P.crops,
    [gen.PropType.FENCE_H]: P.fenceH,
    [gen.PropType.FENCE_POST]: P.fencePost,
    [gen.PropType.SCARECROW]: P.scarecrow,
    [gen.PropType.CAVE_DECOR]: P.caveDecor,
    [gen.PropType.FORGE_DECOR]: P.forgeDecor,
  };
  const resolve = (pl: gen.Placed): Placed => {
    const entry = lists[pl.type];
    let def: PropDef;
    if (Array.isArray(entry)) {
      // CROP uses an integer row index; everything else uses the pickB hash (0..1)
      const i = pl.type === gen.PropType.CROP
        ? Math.floor(pl.v) % entry.length
        : Math.floor(pl.v * entry.length) % entry.length;
      def = entry[i] ?? entry[0];
    } else {
      def = entry; // single-texture props (fenceH / fencePost / scarecrow)
    }
    return { gx: pl.gx, gy: pl.gy, def };
  };

  return {
    terrain: g.terrain,
    blocked: g.blocked,
    freeCells: g.freeCells,
    props: g.props.map(resolve),
    decor: g.decor.map(resolve),
    spawn: g.spawn,
  };
}
