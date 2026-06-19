// Cosmetic skins + axe rarities — shared so the server (throughput from axe) and the
// client (render tint + UI) agree. Skins are tint-based (recolor the one Body_A sprite);
// axe rarity gives a mining-throughput multiplier (matches the upgrade design's ~1.8–2.4×).
export interface Skin { id: number; name: string; tint: number; }
export interface Axe { id: number; name: string; color: string; mult: number; }

export const SKINS: Skin[] = [
  { id: 0, name: "Default", tint: 0xffffff },
  { id: 1, name: "Crimson", tint: 0xff9a9a },
  { id: 2, name: "Emerald", tint: 0x9af5b0 },
  { id: 3, name: "Azure",   tint: 0x8fc8ff },
  { id: 4, name: "Gold",    tint: 0xffe08a },
  { id: 5, name: "Shadow",  tint: 0xb0a0e0 },
];

export const AXES: Axe[] = [
  { id: 0, name: "Wooden",  color: "#b98a4a", mult: 1.0 },
  { id: 1, name: "Stone",   color: "#9aa0a8", mult: 1.2 },
  { id: 2, name: "Iron",    color: "#d8dde6", mult: 1.5 },
  { id: 3, name: "Gold",    color: "#ffd23f", mult: 1.9 },
  { id: 4, name: "Diamond", color: "#8fe4f5", mult: 2.4 },
];

export const axeMult = (id: number): number => AXES[id]?.mult ?? 1;
