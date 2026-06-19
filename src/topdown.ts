// Top-down coordinate math. No 2:1 iso skew — straight grid.
//
//   screen.x = gx * TILE        depth (draw order) = screen.y
//   screen.y = gy * TILE        objects lower on screen draw on top
//
// With Anokolisa Pixel Crawler (16x16) set TILE = 16 and scale the stage x2–x3,
// with nearest-neighbour scaling for crisp pixels (see README).

export const TILE = 32;

export interface Cell {
  x: number;
  y: number;
}

export function cellCenter(gx: number, gy: number): { x: number; y: number } {
  return { x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 };
}

export function screenToCell(sx: number, sy: number): Cell {
  return { x: Math.floor(sx / TILE), y: Math.floor(sy / TILE) };
}

export function clampCell(c: Cell, size: number): Cell {
  return {
    x: Math.max(0, Math.min(size - 1, c.x)),
    y: Math.max(0, Math.min(size - 1, c.y)),
  };
}

export type Facing = "down" | "up" | "left" | "right";

/** Dominant-axis facing from a velocity vector (top-down 4-direction). */
export function facingFrom(vx: number, vy: number, current: Facing): Facing {
  if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) return current;
  if (Math.abs(vx) > Math.abs(vy)) return vx > 0 ? "right" : "left";
  return vy > 0 ? "down" : "up";
}
