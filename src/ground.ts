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
export const T_WALL = 3; // cave/dungeon solid rock

export class GroundLayer {
  readonly container = new Container();

  constructor(app: Application, mapW: number, mapH: number, terrain: Uint8Array, g: GroundTiles, zone = "village") {
    if (zone === "cave") { this.buildCave(app, mapW, mapH, terrain, g); return; }
    if (zone === "forge") { this.buildForge(app, mapW, mapH, terrain, g); return; }
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

  // M5 cave/dungeon ground. The gameplay grid is 32px, but a hard 32px wall silhouette looks
  // "kaku" (blocky staircases). So we render the walls on a SUPERSAMPLED, blurred mask: the wall
  // boundary is evaluated on a 2× grid (16px) from a bilinear + box-blurred field and thresholded,
  // which rounds corners and halves the step size. Floor stays cell-res. (Visual only — collision
  // and ore still use the 32px cells; edges may differ by ≤16px, which is fine for decoration.)
  // Cave = dark rock palette; Forge = molten-lava palette. Both reuse this supersampled render.
  private buildCave(app: Application, mapW: number, mapH: number, terrain: Uint8Array, g: GroundTiles) {
    this.cavernGround(app, mapW, mapH, terrain, g, {
      floor: (gx, gy) => { const b = Math.round((0.5 + vnoise(gx, gy, 7, 3) * 0.22) * 255); return (b << 16) | (b << 8) | b; }, // grey stone
      fill: () => 0x241d15,   // near-black rock interior
      rim: 0x6a5640, rimA: 0.5, // warm rock rim
      grass: { color: 0x6aa83e, width: 3 }, // green moss ring hugging the floor side of every "hill" edge
    });
  }
  private buildForge(app: Application, mapW: number, mapH: number, terrain: Uint8Array, g: GroundTiles) {
    this.cavernGround(app, mapW, mapH, terrain, g, {
      floor: (gx, gy) => { const b = 0.26 + vnoise(gx, gy, 7, 3) * 0.14; return (Math.round(b * 255) << 16) | (Math.round(b * 0.5 * 255) << 8) | Math.round(b * 0.42 * 255); }, // dark obsidian
      fill: (fx, fy) => { const gl = 0.55 + vnoise(fx, fy, 3, 8) * 0.45; return (255 << 16) | (Math.round(120 * gl) << 8) | 16; }, // glowing molten orange
      rim: 0xffb24a, rimA: 0.6, // bright lava edge glow
    });
  }

  // Shared supersampled cavern render (rock void OR lava lake, by palette). Uses the DIRT dual-grid
  // (brown, no green) so tinting is clean. Supersampled 2× + blurred → smooth rounded edges.
  private cavernGround(app: Application, mapW: number, mapH: number, terrain: Uint8Array, g: GroundTiles,
    P: { floor: (gx: number, gy: number) => number; fill: (fx: number, fy: number) => number; rim: number; rimA: number; grass?: { color: number; width: number } }) {
    const at = (gx: number, gy: number) => (gx >= 0 && gx < mapW && gy >= 0 && gy < mapH ? terrain[gy * mapW + gx] : T_WALL);

    // ── supersampled + blurred wall field (rounded contours) ──
    const S = 2, SUB = TILE / S, fw = mapW * S, fh = mapH * S;
    const cellWall = (cx: number, cy: number) => (at(cx, cy) === T_WALL ? 1 : 0);
    let field = new Float32Array(fw * fh);
    for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) {
      const cx = (fx + 0.5) / S - 0.5, cy = (fy + 0.5) / S - 0.5;
      const x0 = Math.floor(cx), y0 = Math.floor(cy), tx = cx - x0, ty = cy - y0;
      field[fy * fw + fx] =
        cellWall(x0, y0) * (1 - tx) * (1 - ty) + cellWall(x0 + 1, y0) * tx * (1 - ty) +
        cellWall(x0, y0 + 1) * (1 - tx) * ty + cellWall(x0 + 1, y0 + 1) * tx * ty;
    }
    for (let pass = 0; pass < 3; pass++) { // box-blur → round the corners
      const out = new Float32Array(fw * fh);
      for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = fx + dx, ny = fy + dy;
          s += (nx < 0 || ny < 0 || nx >= fw || ny >= fh) ? 1 : field[ny * fw + nx];
        }
        out[fy * fw + fx] = s / 9;
      }
      field = out;
    }
    const wall = new Uint8Array(fw * fh);
    for (let i = 0; i < fw * fh; i++) wall[i] = field[i] >= 0.5 ? 1 : 0;
    const w = (fx: number, fy: number) => (fx < 0 || fy < 0 || fx >= fw || fy >= fh ? 1 : wall[fy * fw + fx]);
    const sig = (fdx: number, fdy: number) => DIRT_GMAP[`${w(fdx - 1, fdy - 1)}${w(fdx, fdy - 1)}${w(fdx - 1, fdy)}${w(fdx, fdy)}`];

    const cx0 = Math.ceil(mapW / CHUNK), cy0 = Math.ceil(mapH / CHUNK);
    for (let cy = 0; cy < cy0; cy++) {
      for (let cx = 0; cx < cx0; cx++) {
        const ox = cx * CHUNK, oy = cy * CHUNK;
        const c = new Container();

        // stone floor base (cell res, per-cell noise)
        for (let gy = oy; gy < oy + CHUNK && gy < mapH; gy++)
          for (let gx = ox; gx < ox + CHUNK && gx < mapW; gx++) {
            const s = new Sprite(g.caveFloor);
            s.x = (gx - ox) * TILE; s.y = (gy - oy) * TILE; s.setSize(TILE);
            s.tint = P.floor(gx, gy); c.addChild(s);
          }

        const fox = ox * S, foy = oy * S, fc = CHUNK * S;
        // grass ring — a moss border on the FLOOR side, hugging every wall ("hill") edge. Width is in
        // fine cells (2 = one tile); alpha is strongest right at the rock and fades outward, so it reads
        // as grass creeping out from the hills. Cave only (forge has no grass).
        if (P.grass) {
          const R = P.grass.width;
          for (let fy = foy; fy < foy + fc && fy < fh; fy++)
            for (let fx = fox; fx < fox + fc && fx < fw; fx++) {
              if (w(fx, fy)) continue; // floor side only
              let d = R + 1;
              for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++)
                if (w(fx + dx, fy + dy)) { const dd = Math.max(Math.abs(dx), Math.abs(dy)); if (dd < d) d = dd; }
              if (d > R) continue; // too far from any wall
              const s = new Sprite(g.caveFloor);
              s.x = (fx - fox) * SUB; s.y = (fy - foy) * SUB; s.setSize(SUB);
              s.tint = P.grass.color; s.alpha = 1 - (d - 1) / (R + 1); // edge = opaque, fading out
              c.addChild(s);
            }
        }
        // opaque interior — fine cells fully surrounded (rock void / molten core)
        for (let fy = foy; fy < foy + fc && fy < fh; fy++)
          for (let fx = fox; fx < fox + fc && fx < fw; fx++) {
            if (!w(fx, fy) || !w(fx - 1, fy) || !w(fx + 1, fy) || !w(fx, fy - 1) || !w(fx, fy + 1)) continue;
            const s = new Sprite(g.caveFloor);
            s.x = (fx - fox) * SUB; s.y = (fy - foy) * SUB; s.setSize(SUB);
            s.tint = P.fill(fx, fy); c.addChild(s);
          }
        // boundary band (fine dual-grid edge tiles fade into the floor)
        for (let fdy = foy; fdy <= foy + fc; fdy++)
          for (let fdx = fox; fdx <= fox + fc; fdx++) {
            const m = sig(fdx, fdy);
            if (!m || m === "fill") continue;
            const s = new Sprite(g.dirtTile(m[0], m[1]));
            s.x = (fdx - fox) * SUB - SUB / 2; s.y = (fdy - foy) * SUB - SUB / 2; s.setSize(SUB);
            s.tint = P.fill(fdx, fdy); c.addChild(s);
          }
        // rim highlight (semi-transparent, on the boundary)
        for (let fdy = foy; fdy <= foy + fc; fdy++)
          for (let fdx = fox; fdx <= fox + fc; fdx++) {
            const m = sig(fdx, fdy);
            if (!m || m === "fill") continue;
            const s = new Sprite(g.dirtTile(m[0], m[1]));
            s.x = (fdx - fox) * SUB - SUB / 2; s.y = (fdy - foy) * SUB - SUB / 2; s.setSize(SUB);
            s.tint = P.rim; s.alpha = P.rimA; c.addChild(s);
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
