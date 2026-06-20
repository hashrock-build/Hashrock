// Authoritative economy persistence (Postgres). Every coin/pool/treasury change goes
// through a transaction here and is recorded in an append-only `ledger` (audit trail).
// INVARIANT: sum(players.coins) + pool + creator === treasury, always (1:1 backed).
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const n = (v: string | number) => Number(v); // coins fit in JS number for the MVP

export interface Economy { pool: number; creator: number; treasury: number; }

export async function initSchema(seedPool: number): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL DEFAULT 'miner',
      coins      BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS economy (
      id       INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      pool     BIGINT NOT NULL CHECK (pool >= 0),
      creator  BIGINT NOT NULL DEFAULT 0,
      treasury BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id            BIGSERIAL PRIMARY KEY,
      ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
      kind          TEXT NOT NULL,
      player_id     TEXT,
      amount        BIGINT NOT NULL DEFAULT 0,
      pool_delta    BIGINT NOT NULL DEFAULT 0,
      creator_delta BIGINT NOT NULL DEFAULT 0,
      treasury_delta BIGINT NOT NULL DEFAULT 0,
      meta          JSONB
    );
  `);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS wallet TEXT`); // Solana address for redeem
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS body INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS skin INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS hair INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS hat INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS axe INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS axe_owned INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS durability INT NOT NULL DEFAULT 100`);
  // owned color-skins as a bitmask (bit i = skin i); bit 0 (Grey) is the free starter
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS skins_owned INT NOT NULL DEFAULT 1`);
  // owned axes as a bitmask (bit i = axe i); bit 0 (Wooden) is the free starter. Migrate by
  // reconstructing EXACTLY which axes were bought from the ledger (the old `axe_owned`
  // highest-tier counter wrongly implied ownership of every lower tier — the bug we're fixing).
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS axes_owned INT NOT NULL DEFAULT 1`);
  await pool.query(`
    UPDATE players p SET axes_owned = 1 | COALESCE(
      (SELECT bit_or(1 << ((l.meta->>'axe')::int)) FROM ledger l
       WHERE l.kind = 'buy_axe' AND l.player_id = p.id AND (l.meta->>'axe') IS NOT NULL), 0)
    WHERE p.axes_owned = 1`);
  // per-tier axe levels, packed 4 bits/tier (0 = level 1); upgraded on-chain
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS axe_levels INT NOT NULL DEFAULT 0`);
  // P2P marketplace listings (item DATA off-chain/server-authoritative; settlement on-chain)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id         BIGSERIAL PRIMARY KEY,
      seller_id  TEXT NOT NULL,
      kind       TEXT NOT NULL,                       -- 'axe' | 'skin'
      item       INT  NOT NULL,                       -- tier / skin id
      price      BIGINT NOT NULL CHECK (price > 0),   -- $HASHROCK
      status     TEXT NOT NULL DEFAULT 'active',      -- active | sold | cancelled
      buyer_id   TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS listings_one_active ON listings (seller_id, kind, item) WHERE status = 'active'`);
  // seed economy: pool = seed, treasury backs it 1:1 (= seed), creator = 0
  await pool.query(
    `INSERT INTO economy (id, pool, creator, treasury) VALUES (1, $1, 0, $1)
     ON CONFLICT (id) DO NOTHING`, [seedPool]);
}

export async function setWallet(playerId: string, wallet: string): Promise<void> {
  await pool.query(`UPDATE players SET wallet = $2 WHERE id = $1`, [playerId, wallet]);
}
export async function getWallet(playerId: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT wallet FROM players WHERE id = $1`, [playerId]);
  return rows[0]?.wallet ?? null;
}
export async function setName(playerId: string, name: string): Promise<void> {
  await pool.query(`UPDATE players SET name = $2 WHERE id = $1`, [playerId, name]);
}
export async function playerByWallet(wallet: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT id FROM players WHERE wallet = $1 LIMIT 1`, [wallet]);
  return rows[0]?.id ?? null;
}

/** REDEEM: burn coins + reduce treasury backing (on-chain release happens separately). */
export async function persistRedeem(playerId: string, amount: number): Promise<void> {
  await tx(async (c) => {
    await c.query(`UPDATE players SET coins = coins - $1 WHERE id = $2`, [amount, playerId]);
    await c.query(`UPDATE economy SET treasury = treasury - $1 WHERE id = 1`, [amount]);
    await c.query(`INSERT INTO ledger (kind, player_id, amount, treasury_delta) VALUES ('redeem', $1, $2, $3)`,
      [playerId, -amount, -amount]);
  });
}
/** Reverse a redeem if the on-chain release failed. */
export async function refundRedeem(playerId: string, amount: number): Promise<void> {
  await tx(async (c) => {
    await c.query(`UPDATE players SET coins = coins + $1 WHERE id = $2`, [amount, playerId]);
    await c.query(`UPDATE economy SET treasury = treasury + $1 WHERE id = 1`, [amount]);
    await c.query(`INSERT INTO ledger (kind, player_id, amount, treasury_delta) VALUES ('redeem_refund', $1, $2, $3)`,
      [playerId, amount, amount]);
  });
}

/** DEPOSIT: $HASHROCK confirmed into treasury → mint coins 1:1. Dedupes by tx signature. */
export async function persistDeposit(playerId: string, amount: number, sig: string): Promise<boolean> {
  // Dedupe against the ENTIRE ledger, not just deposits. A purchase (axe/skin/repair/upgrade) is
  // ALSO a $HASHROCK transfer INTO the treasury, so the deposit auto-watcher would otherwise see
  // that same tx and re-credit it as a deposit — minting unbacked coins (the off-chain
  // double-count bug). If the sig is already recorded under ANY kind, never credit it again.
  const dup = await pool.query(`SELECT 1 FROM ledger WHERE meta->>'sig' = $1 LIMIT 1`, [sig]);
  if (dup.rowCount) return false; // already accounted (deposit OR purchase)
  await tx(async (c) => {
    await c.query(`UPDATE players SET coins = coins + $1 WHERE id = $2`, [amount, playerId]);
    await c.query(`UPDATE economy SET treasury = treasury + $1 WHERE id = 1`, [amount]);
    await c.query(`INSERT INTO ledger (kind, player_id, amount, treasury_delta, meta) VALUES ('deposit', $1, $2, $3, $4)`,
      [playerId, amount, amount, JSON.stringify({ sig })]);
  });
  return true;
}

export async function getEconomy(): Promise<Economy> {
  const { rows } = await pool.query(`SELECT pool, creator, treasury FROM economy WHERE id = 1`);
  return { pool: n(rows[0].pool), creator: n(rows[0].creator), treasury: n(rows[0].treasury) };
}

export interface Profile { coins: number; body: number; skin: number; hair: number; hat: number; axe: number; axesOwned: number; axeLevels: number; skinsOwned: number; durability: number; name: string; }
/** Create the player row if missing (without clobbering a saved username); returns profile. */
export async function ensurePlayer(id: string, name: string): Promise<Profile> {
  await pool.query(`INSERT INTO players (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, name]);
  const { rows } = await pool.query(`SELECT coins, body, skin, hair, hat, axe, axes_owned, axe_levels, skins_owned, durability, name FROM players WHERE id = $1`, [id]);
  const r = rows[0];
  return { coins: n(r.coins), body: n(r.body), skin: n(r.skin), hair: n(r.hair), hat: n(r.hat), axe: n(r.axe), axesOwned: n(r.axes_owned), axeLevels: n(r.axe_levels), skinsOwned: n(r.skins_owned), durability: n(r.durability), name: r.name };
}
export async function setDurability(id: string, durability: number): Promise<void> {
  await pool.query(`UPDATE players SET durability = $2 WHERE id = $1`, [id, durability]);
}
/** On-chain repair: $HASHROCK landed in treasury → restore durability + route 95% pool / 5% creator. */
export async function persistRepair(playerId: string, cost: number, cut: number, sig: string): Promise<boolean> {
  const dup = await pool.query(`SELECT 1 FROM ledger WHERE kind = 'repair' AND meta->>'sig' = $1 LIMIT 1`, [sig]);
  if (dup.rowCount) return false;
  await tx(async (c) => {
    await c.query(`UPDATE players SET durability = 100 WHERE id = $1`, [playerId]);
    await c.query(`UPDATE economy SET treasury = treasury + $1, pool = pool + $2, creator = creator + $3 WHERE id = 1`, [cost, cost - cut, cut]);
    await c.query(`INSERT INTO ledger (kind, player_id, amount, pool_delta, creator_delta, treasury_delta, meta) VALUES ('repair', $1, 0, $2, $3, $4, $5)`,
      [playerId, cost - cut, cut, cost, JSON.stringify({ sig })]);
  });
  return true;
}

/** On-chain axe purchase: $HASHROCK landed in treasury → grant axe + route 95% pool / 5% creator. */
export async function persistAxeBuy(playerId: string, axe: number, price: number, cut: number, sig: string): Promise<boolean> {
  const dup = await pool.query(`SELECT 1 FROM ledger WHERE kind = 'buy_axe' AND meta->>'sig' = $1 LIMIT 1`, [sig]);
  if (dup.rowCount) return false;
  await tx(async (c) => {
    await c.query(`UPDATE players SET axe = $2, axes_owned = axes_owned | $3 WHERE id = $1`, [playerId, axe, 1 << axe]);
    await c.query(`UPDATE economy SET treasury = treasury + $1, pool = pool + $2, creator = creator + $3 WHERE id = 1`, [price, price - cut, cut]);
    await c.query(`INSERT INTO ledger (kind, player_id, amount, pool_delta, creator_delta, treasury_delta, meta) VALUES ('buy_axe', $1, $2, $3, $4, $5, $6)`,
      [playerId, 0, price - cut, cut, price, JSON.stringify({ sig, axe, price })]);
  });
  return true;
}
/** On-chain axe LEVEL upgrade: $HASHROCK landed in treasury → write the new packed levels +
 * route 95% pool / 5% creator. Dedupes by sig. */
export async function persistAxeUpgrade(playerId: string, tier: number, newLevel: number, packed: number, price: number, cut: number, sig: string): Promise<boolean> {
  const dup = await pool.query(`SELECT 1 FROM ledger WHERE kind = 'upgrade_axe' AND meta->>'sig' = $1 LIMIT 1`, [sig]);
  if (dup.rowCount) return false;
  await tx(async (c) => {
    await c.query(`UPDATE players SET axe_levels = $2 WHERE id = $1`, [playerId, packed]);
    await c.query(`UPDATE economy SET treasury = treasury + $1, pool = pool + $2, creator = creator + $3 WHERE id = 1`, [price, price - cut, cut]);
    await c.query(`INSERT INTO ledger (kind, player_id, amount, pool_delta, creator_delta, treasury_delta, meta) VALUES ('upgrade_axe', $1, $2, $3, $4, $5, $6)`,
      [playerId, 0, price - cut, cut, price, JSON.stringify({ sig, tier, level: newLevel, price })]);
  });
  return true;
}

/** On-chain color-skin purchase: $HASHROCK landed in treasury → grant + equip the skin
 * (set its bit in skins_owned) + route 95% pool / 5% creator. Dedupes by sig. */
export async function persistSkinBuy(playerId: string, skin: number, price: number, cut: number, sig: string): Promise<boolean> {
  const dup = await pool.query(`SELECT 1 FROM ledger WHERE kind = 'buy_skin' AND meta->>'sig' = $1 LIMIT 1`, [sig]);
  if (dup.rowCount) return false;
  await tx(async (c) => {
    await c.query(`UPDATE players SET skins_owned = skins_owned | $2, skin = $3 WHERE id = $1`, [playerId, 1 << skin, skin]);
    await c.query(`UPDATE economy SET treasury = treasury + $1, pool = pool + $2, creator = creator + $3 WHERE id = 1`, [price, price - cut, cut]);
    await c.query(`INSERT INTO ledger (kind, player_id, amount, pool_delta, creator_delta, treasury_delta, meta) VALUES ('buy_skin', $1, $2, $3, $4, $5, $6)`,
      [playerId, 0, price - cut, cut, price, JSON.stringify({ sig, skin, price })]);
  });
  return true;
}
/** Equip a cosmetic/axe slot. `slot` is a whitelisted column name. */
export async function setSlot(id: string, slot: "body" | "skin" | "hair" | "hat" | "axe", value: number): Promise<void> {
  await pool.query(`UPDATE players SET ${slot} = $2 WHERE id = $1`, [id, value]);
}

/** Mining reward: pool -> player (redistribution; treasury unchanged). */
export async function persistReward(playerId: string, amount: number, oreId: number): Promise<void> {
  await tx(async (c) => {
    await c.query(`UPDATE economy SET pool = pool - $1 WHERE id = 1`, [amount]);
    await c.query(`UPDATE players SET coins = coins + $1 WHERE id = $2`, [amount, playerId]);
    await c.query(
      `INSERT INTO ledger (kind, player_id, amount, pool_delta, meta) VALUES ('mine', $1, $2, $3, $4)`,
      [playerId, amount, -amount, JSON.stringify({ oreId })]);
  });
}

/** Sink (DEMO upgrade paid in coins): player -> 95% pool + 5% creator. No mint/burn. */
export async function persistUpgrade(playerId: string, cost: number, cut: number): Promise<void> {
  await tx(async (c) => {
    await c.query(`UPDATE players SET coins = coins - $1 WHERE id = $2`, [cost, playerId]);
    await c.query(`UPDATE economy SET creator = creator + $1, pool = pool + $2 WHERE id = 1`, [cut, cost - cut]);
    await c.query(
      `INSERT INTO ledger (kind, player_id, amount, pool_delta, creator_delta) VALUES ('upgrade', $1, $2, $3, $4)`,
      [playerId, -cost, cost - cut, cut]);
  });
}

/** Audit: total coins in existence must equal the treasury backing. */
// ───────────────────────── P2P MARKETPLACE ─────────────────────────
export interface Listing { id: number; sellerId: string; sellerName: string; kind: string; item: number; price: number; }
const ownCol = (kind: string) => (kind === "axe" ? "axes_owned" : "skins_owned");
const equipCol = (kind: string) => (kind === "axe" ? "axe" : "skin");

/** List an owned item (not the free id-0 starter) for sale. Returns the new listing id, or an
 *  error string. Server-authoritative: verifies ownership; the unique index blocks double-listing. */
export async function createListing(sellerId: string, kind: string, item: number, price: number): Promise<{ id: number } | { err: string }> {
  if (kind !== "axe" && kind !== "skin") return { err: "bad item kind" };
  if (item <= 0) return { err: "the free starter can't be sold" };
  if (!(price > 0)) return { err: "price must be > 0" };
  const { rows } = await pool.query(`SELECT ${ownCol(kind)} AS owned FROM players WHERE id = $1`, [sellerId]);
  if (!rows.length || !((n(rows[0].owned) >> item) & 1)) return { err: "you don't own that item" };
  try {
    const r = await pool.query(`INSERT INTO listings (seller_id, kind, item, price) VALUES ($1,$2,$3,$4) RETURNING id`, [sellerId, kind, item, price]);
    return { id: n(r.rows[0].id) };
  } catch { return { err: "already listed" }; }
}

export async function cancelListing(id: number, sellerId: string): Promise<boolean> {
  const r = await pool.query(`UPDATE listings SET status='cancelled' WHERE id=$1 AND seller_id=$2 AND status='active'`, [id, sellerId]);
  return !!r.rowCount;
}

export async function activeListings(): Promise<Listing[]> {
  const { rows } = await pool.query(
    `SELECT l.id, l.seller_id, COALESCE(p.name,'miner') AS seller_name, l.kind, l.item, l.price
     FROM listings l LEFT JOIN players p ON p.id = l.seller_id
     WHERE l.status='active' ORDER BY l.id DESC LIMIT 100`);
  return rows.map((r) => ({ id: n(r.id), sellerId: r.seller_id, sellerName: r.seller_name, kind: r.kind, item: n(r.item), price: n(r.price) }));
}

export async function getActiveListing(id: number): Promise<Listing | null> {
  const { rows } = await pool.query(`SELECT id, seller_id, kind, item, price FROM listings WHERE id=$1 AND status='active'`, [id]);
  if (!rows.length) return null;
  const r = rows[0];
  return { id: n(r.id), sellerId: r.seller_id, sellerName: "", kind: r.kind, item: n(r.item), price: n(r.price) };
}

/** Settle a confirmed P2P sale: the buyer already paid the seller (price−fee) wallet-to-wallet and
 *  the fee into the treasury ON-CHAIN (verified by the caller). Here we only move the item + route
 *  the fee as a sink (95% pool / 5% creator). Transactional, sig-deduped, ownership re-checked. */
export async function settleMarketSale(listingId: number, buyerId: string, fee: number, cut: number, sig: string): Promise<{ ok: boolean; reason?: string }> {
  const dup = await pool.query(`SELECT 1 FROM ledger WHERE meta->>'sig' = $1 LIMIT 1`, [sig]);
  if (dup.rowCount) return { ok: false, reason: "already settled" };
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const lr = await c.query(`SELECT seller_id, kind, item, price FROM listings WHERE id=$1 AND status='active' FOR UPDATE`, [listingId]);
    if (!lr.rowCount) { await c.query("ROLLBACK"); return { ok: false, reason: "listing gone" }; }
    const { seller_id: seller, kind, item, price } = lr.rows[0];
    const own = ownCol(kind), eq = equipCol(kind), bit = 1 << n(item);
    const sown = n((await c.query(`SELECT ${own} AS o FROM players WHERE id=$1`, [seller])).rows[0]?.o ?? 0);
    if (!(sown & bit)) { await c.query("ROLLBACK"); return { ok: false, reason: "seller no longer owns it" }; }
    if (seller === buyerId) { await c.query("ROLLBACK"); return { ok: false, reason: "cannot buy your own listing" }; }
    // seller loses the item (+ unequip if equipped); axe level for that tier resets
    await c.query(`UPDATE players SET ${own} = ${own} & ~($2::int), ${eq} = CASE WHEN ${eq} = $3 THEN 0 ELSE ${eq} END WHERE id=$1`, [seller, bit, n(item)]);
    if (kind === "axe") await c.query(`UPDATE players SET axe_levels = axe_levels & ~($2::int) WHERE id=$1`, [seller, 0xf << (n(item) * 4)]);
    // buyer gains the item
    await c.query(`UPDATE players SET ${own} = ${own} | $2 WHERE id=$1`, [buyerId, bit]);
    // fee is a sink → treasury += fee, pool += 95%, creator += 5% (seller's portion was paid P2P on-chain, not here)
    await c.query(`UPDATE economy SET treasury = treasury + $1, pool = pool + $2, creator = creator + $3 WHERE id=1`, [fee, fee - cut, cut]);
    await c.query(`UPDATE listings SET status='sold', buyer_id=$2 WHERE id=$1`, [listingId, buyerId]);
    await c.query(`INSERT INTO ledger (kind, player_id, amount, pool_delta, creator_delta, treasury_delta, meta) VALUES ('market_sale',$1,0,$2,$3,$4,$5)`,
      [buyerId, fee - cut, cut, fee, JSON.stringify({ sig, listingId, kind, item: n(item), price: n(price), seller, buyer: buyerId, fee })]);
    await c.query("COMMIT");
    return { ok: true };
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); return { ok: false, reason: (e as Error).message }; }
  finally { c.release(); }
}

export async function verifyInvariant(): Promise<{ ok: boolean; coins: number; treasury: number }> {
  const { rows } = await pool.query(
    `SELECT (SELECT COALESCE(SUM(coins),0) FROM players) AS pc, pool, creator, treasury FROM economy WHERE id = 1`);
  const coins = n(rows[0].pc) + n(rows[0].pool) + n(rows[0].creator);
  return { ok: coins === n(rows[0].treasury), coins, treasury: n(rows[0].treasury) };
}

async function tx(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); await fn(c); await c.query("COMMIT"); }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}
