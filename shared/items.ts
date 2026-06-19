// Cosmetics + axe rarities — shared so the server (throughput from axe) and client
// (render + UI) agree. Cosmetics are PROCEDURAL (drawn in code), so they're original art
// we hold full rights to and can sell on-chain later (Pixel Crawler art may NOT be sold —
// see CLAUDE.md license). Outfit = body tint; hair + hat = drawn overlays on the head.
export interface Cosmetic { id: number; name: string; rarity: Rarity; color: number; shape?: string; }
export interface Axe { id: number; name: string; color: string; mult: number; price: number; } // price in $HASHROCK (0 = free starter)
export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

export const RARITY_COLOR: Record<Rarity, string> = {
  Common: "#9aa0a8", Rare: "#4aa3ff", Epic: "#b06bff", Legendary: "#ffb000",
};

// OUTFIT = body tint (kept as `skin` on the wire for back-compat)
export const SKINS: Cosmetic[] = [
  { id: 0, name: "Grey",    rarity: "Common",    color: 0xffffff },
  { id: 1, name: "Crimson", rarity: "Common",    color: 0xff9a9a },
  { id: 2, name: "Emerald", rarity: "Rare",      color: 0x9af5b0 },
  { id: 3, name: "Azure",   rarity: "Rare",      color: 0x8fc8ff },
  { id: 4, name: "Gold",    rarity: "Epic",      color: 0xffe08a },
  { id: 5, name: "Shadow",  rarity: "Legendary", color: 0xb0a0e0 },
];

export const HAIRS: Cosmetic[] = [
  { id: 0, name: "None",   rarity: "Common",    color: 0x000000, shape: "none" },
  { id: 1, name: "Brown",  rarity: "Common",    color: 0x6b4a2a, shape: "short" },
  { id: 2, name: "Blonde", rarity: "Common",    color: 0xe7c66b, shape: "short" },
  { id: 3, name: "Raven",  rarity: "Common",    color: 0x2a2a33, shape: "long" },
  { id: 4, name: "Crimson",rarity: "Rare",      color: 0xc8463a, shape: "spiky" },
  { id: 5, name: "Frost",  rarity: "Epic",      color: 0x9fe6ff, shape: "long" },
  { id: 6, name: "Royal",  rarity: "Legendary", color: 0xb06bff, shape: "spiky" },
];

export const HATS: Cosmetic[] = [
  { id: 0, name: "None",         rarity: "Common",    color: 0x000000, shape: "none" },
  { id: 1, name: "Straw Hat",    rarity: "Common",    color: 0xd9b66b, shape: "straw" },
  { id: 2, name: "Cap",          rarity: "Common",    color: 0x4a73c8, shape: "cap" },
  { id: 3, name: "Miner Helmet", rarity: "Rare",      color: 0xffd23f, shape: "miner" },
  { id: 4, name: "Wizard Hat",   rarity: "Epic",      color: 0x7a4fd0, shape: "wizard" },
  { id: 5, name: "Crown",        rarity: "Legendary", color: 0xffd23f, shape: "crown" },
];

export const AXES: Axe[] = [
  { id: 0, name: "Wooden",  color: "#b98a4a", mult: 1.0, price: 0 },
  { id: 1, name: "Stone",   color: "#9aa0a8", mult: 1.2, price: 5_000 },
  { id: 2, name: "Iron",    color: "#d8dde6", mult: 1.5, price: 20_000 },
  { id: 3, name: "Gold",    color: "#ffd23f", mult: 1.9, price: 60_000 },
  { id: 4, name: "Diamond", color: "#8fe4f5", mult: 2.4, price: 150_000 },
];
export const axePrice = (id: number): number => AXES[id]?.price ?? 0;

export const axeMult = (id: number): number => AXES[id]?.mult ?? 1;
