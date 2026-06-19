// Ground renderer. The map terrain (grass / dirt / water) is dual-grid autotiled —
// dirt paths and water shorelines get soft organic edges — and baked once into a few
// RenderTexture chunks at startup. After that the ground is just a handful of chunk
// sprites (PixiJS culls the off-screen ones), so map size is essentially free.

import { Application, Container, Sprite, RenderTexture } from "pixi.js";
import { TILE } from "./topdown";
import { GroundTiles, DIRT_GMAP, WATER_GMAP, vnoise } from "./tiles";

const CHUNK = 32; // tiles per chunk

// terrain codes
export const T_GRASS = 0;
export const T_DIRT = 1;
export const T_WATER = 2;

export class GroundLayer {
  readonly container = new Container();

  constructor(app: Application, mapW: number, mapH: number, terrain: Uint8Array, g: GroundTiles) {
    const at = (gx: number, gy: number): number =>
      gx >= 0 && gx < mapW && gy >= 0 && gy < mapH ? terrain[gy * mapW + gx] : T_GRASS;
    const dirtOn = (gx: number, gy: number) => (at(gx, gy) === T_DIRT ? 1 : 0);
    const landOn = (gx: number, gy: number) => (at(gx, gy) === T_WATER ? 0 : 1); // grass = 1

    const cx0 = Math.ceil(mapW / CHUNK), cy0 = Math.ceil(mapH / CHUNK);
    for (let cy = 0; cy < cy0; cy++) {
      for (let cx = 0; cx < cx0; cx++) {
        const ox = cx * CHUNK, oy = cy * CHUNK;
        const c = new Container();

        // grass base (per logical cell, darkened by smooth noise for soft variation)
        for (let gy = oy; gy < oy + CHUNK; gy++) {
          for (let gx = ox; gx < ox + CHUNK; gx++) {
            const s = new Sprite(g.grass);
            s.x = (gx - ox) * TILE; s.y = (gy - oy) * TILE; s.setSize(TILE);
            const b = Math.round((0.82 + vnoise(gx, gy, 7, 3) * 0.18) * 255);
            s.tint = (b << 16) | (b << 8) | b;
            c.addChild(s);
          }
        }
        // dirt dual-grid overlay (soft path edges)
        for (let dy = oy; dy <= oy + CHUNK; dy++) {
          for (let dx = ox; dx <= ox + CHUNK; dx++) {
            const sig = `${dirtOn(dx - 1, dy - 1)}${dirtOn(dx, dy - 1)}${dirtOn(dx - 1, dy)}${dirtOn(dx, dy)}`;
            const m = DIRT_GMAP[sig];
            if (!m) continue;
            const tex = m === "fill" ? g.dirtFill[Math.floor(vnoise(dx, dy, 2, 9) * g.dirtFill.length) % g.dirtFill.length] : g.dirtTile(m[0], m[1]);
            const s = new Sprite(tex);
            s.x = (dx - ox) * TILE - TILE / 2; s.y = (dy - oy) * TILE - TILE / 2; s.setSize(TILE);
            c.addChild(s);
          }
        }
        // water dual-grid overlay (sandy shoreline)
        for (let dy = oy; dy <= oy + CHUNK; dy++) {
          for (let dx = ox; dx <= ox + CHUNK; dx++) {
            const sig = `${landOn(dx - 1, dy - 1)}${landOn(dx, dy - 1)}${landOn(dx - 1, dy)}${landOn(dx, dy)}`;
            if (sig === "1111") continue; // all land -> grass shows through
            const tex = sig === "0000"
              ? g.waterFill[Math.floor(vnoise(dx, dy, 2, 5) * g.waterFill.length) % g.waterFill.length]
              : g.waterTile(WATER_GMAP[sig][0], WATER_GMAP[sig][1]);
            const s = new Sprite(tex);
            s.x = (dx - ox) * TILE - TILE / 2; s.y = (dy - oy) * TILE - TILE / 2; s.setSize(TILE);
            c.addChild(s);
          }
        }

        const rt = RenderTexture.create({ width: CHUNK * TILE, height: CHUNK * TILE });
        rt.source.scaleMode = "nearest";
        app.renderer.render({ container: c, target: rt });
        const sprite = new Sprite(rt);
        sprite.x = ox * TILE; sprite.y = oy * TILE;
        this.container.addChild(sprite);
        c.destroy({ children: true });
      }
    }
  }
}
