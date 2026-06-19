// Ore: blockhash-derived, persistent, FIFO-capped.
//
// Ore can spawn on ANY free tile of the village. The last 4 hex digits of the
// blockhash give 0..65535; we index that into the precomputed free-cell list, so a
// hash landing on a prop tile is rejected automatically (the prop tiles simply aren't
// in the list). Bias is negligible while 65536 >> freeCells.length.
//
// Need a bigger map? Widen the digit slice: 5 hex -> ~1.05M values, 6 -> ~16.7M.

export const ORE_HP = 100;
export const HASH_DIGITS = 4; // hex digits read from the blockhash tail

export interface Ore {
  id: number;
  gx: number;
  gy: number;
  hp: number;
  maxHp: number;
  blockhash: string;
  spawnedAt: number;
}

let nextId = 1;

/** Replace with a real confirmed Solana blockhash. */
export function randomBlockhash(): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 44; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

/** Map a blockhash to a free cell index (auto-rejects prop tiles). */
export function hashToFreeCell(
  blockhash: string,
  freeCells: number[],
  mapW: number
): { gx: number; gy: number } {
  const value = parseInt(blockhash.slice(-HASH_DIGITS), 16); // 0..65535 for 4 digits
  const cell = freeCells[value % freeCells.length];
  return { gx: cell % mapW, gy: Math.floor(cell / mapW) };
}

export function makeOre(blockhash: string, freeCells: number[], mapW: number): Ore {
  const { gx, gy } = hashToFreeCell(blockhash, freeCells, mapW);
  return {
    id: nextId++,
    gx,
    gy,
    hp: ORE_HP,
    maxHp: ORE_HP,
    blockhash,
    spawnedAt: Date.now(),
  };
}
