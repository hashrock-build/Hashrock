// Procedural cosmetics (original art → sellable on-chain). Hair + hat are drawn into a
// Graphics overlay positioned over the character's head. headY/headR let the same code
// render on the big player sprite and the small remote-player avatar.
import { Graphics } from "pixi.js";
import { HAIRS, HATS } from "../shared/items";

const mul = (c: number, f: number) => {
  const r = Math.round(((c >> 16) & 255) * f), g = Math.round(((c >> 8) & 255) * f), b = Math.round((c & 255) * f);
  return (r << 16) | (g << 8) | b;
};

export function drawCosmetics(g: Graphics, facing: string, hairId: number, hatId: number, headY: number, headR: number): void {
  g.clear();
  const dir = facing === "left" ? -1 : 1; // mirror side details
  drawHair(g, HAIRS[hairId]?.shape ?? "none", HAIRS[hairId]?.color ?? 0, headY, headR);
  drawHat(g, HATS[hatId]?.shape ?? "none", HATS[hatId]?.color ?? 0, dir, headY, headR);
}

function drawHair(g: Graphics, shape: string, color: number, cy: number, r: number): void {
  if (shape === "none") return;
  g.ellipse(0, cy - r * 0.25, r * 1.05, r * 0.85).fill(color); // cap over top/back
  if (shape === "long") {
    g.roundRect(-r * 0.95, cy - r * 0.2, r * 0.35, r * 1.5, 3).fill(color);
    g.roundRect(r * 0.6, cy - r * 0.2, r * 0.35, r * 1.5, 3).fill(color);
  } else if (shape === "spiky") {
    for (let i = -1; i <= 1; i++) {
      const x = i * r * 0.5;
      g.poly([x, cy - r * 1.0, x - r * 0.26, cy - r * 0.2, x + r * 0.26, cy - r * 0.2]).fill(color);
    }
  }
}

function drawHat(g: Graphics, shape: string, color: number, dir: number, cyHead: number, r: number): void {
  if (shape === "none") return;
  const cy = cyHead - r * 0.55; // sit on top of the head
  const dark = mul(color, 0.7);
  switch (shape) {
    case "straw":
      g.ellipse(0, cy + r * 0.35, r * 1.55, r * 0.5).fill(color);
      g.ellipse(0, cy, r * 0.7, r * 0.5).fill(dark);
      break;
    case "cap":
      g.ellipse(dir * r * 0.65, cy + r * 0.3, r * 0.7, r * 0.28).fill(color);
      g.ellipse(0, cy, r * 0.82, r * 0.55).fill(color);
      break;
    case "miner":
      g.ellipse(0, cy + r * 0.05, r * 0.9, r * 0.6).fill(0x3a3a44);
      g.ellipse(0, cy - r * 0.12, r * 0.9, r * 0.45).fill(color);
      g.circle(dir * r * 0.42, cy - r * 0.12, r * 0.18).fill(0xfff6c0);
      break;
    case "wizard":
      g.poly([0, cy - r * 1.7, -r * 0.72, cy + r * 0.3, r * 0.72, cy + r * 0.3]).fill(color);
      g.ellipse(0, cy + r * 0.3, r * 1.15, r * 0.35).fill(mul(color, 0.8));
      g.circle(0, cy - r * 0.9, r * 0.16).fill(0xffe08a);
      break;
    case "crown":
      g.poly([
        -r * 0.85, cy + r * 0.25, -r * 0.85, cy - r * 0.55, -r * 0.42, cy - r * 0.1,
        0, cy - r * 0.75, r * 0.42, cy - r * 0.1, r * 0.85, cy - r * 0.55, r * 0.85, cy + r * 0.25,
      ]).fill(color);
      g.circle(0, cy - r * 0.5, r * 0.14).fill(0xff5a7a);
      break;
  }
}
