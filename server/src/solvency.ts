// Periodic solvency reconciliation — the watchdog for the 1:1 backing invariant.
//
// It checks TWO things the rest of the system can't catch on its own:
//   (A) internal DB consistency — sum(player coins) + pool + creator === economy.treasury
//       (db.verifyInvariant). Catches an accounting bug that moves coins without balancing.
//   (B) on-chain backing — the treasury's REAL $HASHROCK balance must cover economy.treasury.
//       This is the one that catches an OVER-MINT (e.g. the deposit double-count bug): coins
//       claiming more backing than the chain actually holds. verifyInvariant alone can't see it,
//       because a bad mint bumps both coins AND the DB treasury in lockstep — only the chain tells
//       the truth.
//
// Every tick logs a line; any drift escalates to an [SOLVENCY ALERT] (and an optional webhook) so
// we hear about insolvency the moment it appears, not when the treasury is already drained.
import * as db from "./db";
import * as chain from "./chain";

const INTERVAL_MIN = Number(process.env.SOLVENCY_INTERVAL_MIN ?? 10);
const WEBHOOK = process.env.SOLVENCY_WEBHOOK_URL ?? ""; // optional Discord/Slack-style incoming webhook
// On-chain may legitimately sit a touch ABOVE the DB: floored deposits leave sub-coin dust in the
// treasury, and an in-flight deposit/redeem briefly desyncs by design. Only a SHORTFALL (chain below
// the DB) means coins are under-backed. Tolerance guards that benign direction only.
const BACKING_TOL = Number(process.env.SOLVENCY_TOL ?? 1);

async function alert(msg: string): Promise<void> {
  console.error(`[SOLVENCY ALERT] ${msg}`);
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: `🚨 HASHROCK solvency: ${msg}` }),
    });
  } catch (e) { console.error("[solvency] webhook post failed", e); }
}

/** One reconciliation pass: internal invariant + on-chain backing. */
export async function reconcileOnce(): Promise<void> {
  try {
    const inv = await db.verifyInvariant();          // (A) internal: coins vs DB treasury
    const onChain = await chain.treasuryBalance();    // (B) real $HASHROCK backing, in whole coins
    const backingDiff = onChain - inv.treasury;       // >= 0 (within tolerance) is healthy
    const line = `coins=${inv.coins} dbTreasury=${inv.treasury} onChain=${onChain} internalOk=${inv.ok} backingDiff=${backingDiff}`;
    if (!inv.ok) {
      await alert(`INTERNAL MISMATCH — ${line} (coins+pool+creator != DB treasury → accounting bug)`);
    } else if (backingDiff < -BACKING_TOL) {
      await alert(`UNDER-BACKED — ${line} (on-chain treasury < coins outstanding → INSOLVENT)`);
    } else {
      console.log(`[solvency] OK ${line}`);
    }
  } catch (e) {
    console.error("[solvency] reconcile failed (will retry next tick)", e);
  }
}

/** Start the periodic monitor (also runs once immediately at boot). */
export function startSolvencyMonitor(): void {
  const ms = Math.max(1, INTERVAL_MIN) * 60_000;
  void reconcileOnce();
  setInterval(() => void reconcileOnce(), ms);
  console.log(`[solvency] monitor running every ${INTERVAL_MIN} min${WEBHOOK ? " (+ webhook alerts)" : " (log alerts)"}`);
}
