// Wipe ALL user data and re-seed the economy to a fresh play-to-earn budget.
// Use this before the mainnet migration so NO devnet-earned balances (backed only by worthless
// devnet $HASHROCK) carry over into mainnet — that would be unbacked coins (breaks invariant #3).
//
// Truncates `players` + `ledger` and resets `economy` (id=1) to pool=creator-seed:
//   pool = POOL_SEED, creator = 0, treasury = POOL_SEED   (0 player coins + seed pool === treasury)
// The DB `economy.treasury` is the ACCOUNTED backing (= seeded coins). The real on-chain treasury
// may hold MORE (over-collateral buffer) — that's fine; the reconciliation rule is on-chain ≥ DB.
//
//   run (DESTRUCTIVE — requires explicit confirm):
//     DATABASE_URL=postgres://... POOL_SEED=20000 CONFIRM=yes node scripts/reset-db.mjs
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const SEED = Number(process.env.POOL_SEED || 20000);
if (!DATABASE_URL) { console.error("set DATABASE_URL"); process.exit(1); }
if (process.env.CONFIRM !== "yes") {
  console.error(`REFUSING: this DELETES every player + the ledger and re-seeds the economy (pool=${SEED}).\n` +
    `Target DB: ${DATABASE_URL.replace(/:\/\/[^@]*@/, "://***@")}\n` +
    `Re-run with CONFIRM=yes to proceed.`);
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const c = await pool.connect();
try {
  const before = await c.query(`SELECT
    (SELECT count(*) FROM players) AS players,
    (SELECT count(*) FROM ledger) AS ledger`).then(r => r.rows[0]).catch(() => ({ players: "?", ledger: "?" }));
  console.log("before:", before);
  await c.query("BEGIN");
  await c.query("TRUNCATE players, ledger RESTART IDENTITY");
  // upsert the single economy row to the fresh seed (works whether or not it existed)
  await c.query(
    `INSERT INTO economy (id, pool, creator, treasury) VALUES (1, $1, 0, $1)
     ON CONFLICT (id) DO UPDATE SET pool = $1, creator = 0, treasury = $1`, [SEED]);
  await c.query("COMMIT");
  const eco = (await c.query(`SELECT pool, creator, treasury FROM economy WHERE id = 1`)).rows[0];
  const ok = Number(eco.pool) + Number(eco.creator) === Number(eco.treasury);
  console.log("after: players=0 ledger=0 economy=", eco, "invariant", ok ? "OK ✓" : "BROKEN ✗");
  if (!ok) process.exit(2);
} catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("reset failed:", e.message); process.exit(1); }
finally { c.release(); await pool.end(); }
