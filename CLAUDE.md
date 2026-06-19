# CLAUDE.md

Context for Claude Code / any AI agent working in this repo. Read this before
changing anything.

## Project
Top-down 2D **mine-to-earn** game on Solana. Ore (blue crystals) spawns from the
**blockhash**, persists, and stacks under a **FIFO cap**. Players mine ore for
**in-game coins**, then manually redeem them for an on-chain **$TOKEN**.

## Commands
```bash
npm install
npm run dev      # Vite dev → http://localhost:5173
npm run build    # tsc --noEmit && vite build
npm run preview
```

## Stack
- **PixiJS v8** (2D renderer) — v8 API: `await app.init()`, Graphics `.rect().fill()` chaining
- **Vite** + **TypeScript** (strict, ESM)
- Later: **Tiled** (map JSON), **WebSocket/Colyseus** (multiplayer), **Solana/Anchor** (contract), **Phantom**

## Architecture
```
src/
  topdown.ts  # Top-down math: cellCenter, 4-direction facing, depth = screenY
  ore.ts      # blockhash -> free cell (auto-rejects props/water), Ore, FIFO id
  village.ts  # 112x112 gen: terrain (grass/dirt/water/sand-shore), ponds, fenced farms, 6 house variants, hard-bounded noise-clustered forests, rock outcrops, decor + noOre ore-exclusion mask
  ground.ts   # Viewport-culled ground layer (pool ~ one screenful, not 128x128)
  tiles.ts    # Floor+water atlas, ore crystal frames + diamond-cluster layout
  props.ts    # Trees/rocks/bushes/houses/fence/scarecrow/crops/decor + footprints
  player.ts   # Animated 4-direction player (idle/walk/mining swing)
  world.ts    # Camera follow, player+collision, ore, mining, depth sort
  main.ts     # Loads assets, bootstraps the Application + wires the HUD
```
Top-down rendering: `screen = grid × TILE` (straight, NO 2:1 math). Depth sort =
`zIndex = screenY` (objects lower on screen draw in front). Map is 112×112 tiles
(`MAP_W`/`MAP_H` in `village.ts`); ground is **viewport-culled** (a sprite pool the
size of the screen), so map size is free. Solid props (trees/rocks/houses/water)
block both ore spawning and the player; non-blocking dressing
(flowers/tufts/crops/fence) renders in a flat `decorLayer`. The **forest ring** has a
**hard inner boundary** at `FOREST_BAND` (noise only modulates density *within* the
band, never extends it inward) so it can't creep toward the centre.
Houses are **6 pre-composed PNG variants** (2 wall materials × roof colours, each with
a front door + windows) under `public/assets/props/houses/`, composited offline from
the Walls/Roofs sheets — regenerate via the snippet in git history if the design
changes (don't hand-assemble at runtime). Ponds get a `T.Sand` shoreline ring;
forests grow from `vnoise()` patches (dense cores, open meadows) rather than uniform
scatter; rocks come in clustered outcrops.

## ⚠️ ECONOMIC INVARIANTS — NEVER VIOLATE
These are the foundation of solvency. Violating them = the treasury can drain / go
insolvent.
1. **Coins are minted ONLY when a $TOKEN deposit is confirmed (1:1).** No other path adds coins.
2. **Mining does NOT mint coins.** Mining rewards come from the **Reward Pool** (filled by sinks: marketplace fees, upgrades, repairs). Mining = redistribution, not emission.
3. **Total coins in circulation === total $TOKEN in the Treasury × rate.** Always 1:1 backed.
4. **Redeeming burns coins** and then releases $TOKEN. The Treasury only releases as much as was burned.
5. **The Treasury must not be withdrawn arbitrarily** (multisig + lock). Backing = player deposits, not dev seed.
6. **The server is authoritative.** NEVER trust coin/damage amounts from the client. All rewards/balances are validated server-side. Redeem requires a server signature.
7. Ore that gets **evicted (FIFO)** → its coins **return to the Reward Pool**, they are not destroyed.
8. **All sinks (upgrade / repair / marketplace) are paid ON-CHAIN in $HASHROCK — NEVER in mined coins.** Paying sinks with free coins lets grinders self-sustain (unfair to spenders, leaks the loop) and kills token demand. The 95%-pool share is minted as backed coins into the pool; the 5% creator cut is the only structural leak. Mined coins' ONLY exit is redeem → $HASHROCK.
9. **Fixed pie:** ore supply (1440/day) & total payout (% of pool/day) are fixed; upgrades shift *share*, never increase emission. Upgrades therefore can't drain the protocol — police only per-player fairness (payback ≥ ~30 days at entry). See MVP.md "Economy v2" for the locked numbers (k%, 6× gap, durability 30% recycle).

> The primary attack surface = **off-chain accounting**. A bug that mints coins without
> a deposit (double-credit, forged redeem signature, race condition) directly breaks the 1:1 backing.

## Conventions
- TypeScript strict, ESM, `type: module`.
- Pixel art: `antialias: false`, `nearest` scale mode. For Pixel Crawler 16×16 → `TILE = 16` + scale the stage ×2–3.
- Sprite anchor at the **feet** (`anchor.set(0.5, 0.85)`) so depth-by-Y is correct.
- Ore spawns on a **spawnable free cell** of the village. The blockhash's last 4 hex digits (0..65535) index the precomputed **free-cell list**, so any non-spawnable cell is auto-rejected (bias negligible while 65536 ≫ free cells). Bigger map → widen the digit slice (`HASH_DIGITS` in `ore.ts`): 5 hex ≈ 1.05M, 6 ≈ 16.7M.
- **Ore-spawn exclusion (`noOre` mask in `village.ts`):** ore must **NEVER** spawn in the **forest**, on **house property** (footprint + yard), on the **farm**, or in **water/river**. These zones stay *walkable* (the player can enter them); they're just removed from `freeCells`. `noOre` is **separate from `blocked`** (player collision) on purpose — don't conflate them. When adding a new structure/zone, mark its area with `markNoOre(...)` so ore keeps clear of it.
- FIFO cap default **150** (`CAP` in `world.ts`). Unmined-ore lifetime ≈ cap × spawn interval.

## Economy parameters (LOCKED — `world.ts`)
- **Supply**: $HASHROCK fixed **1B**. **100M (10%)** seeds the Reward Pool as the play-to-earn budget (backed 1:1 by Treasury, NOT player-deposit backing).
- **Mining payout = dynamic % of the *current* pool** (self-balancing, never hits 0): `DAILY_EMISSION = 10%/day` → `REWARD_RATE = 0.10/1440 ≈ 0.0069%` per ore (1 ore/min ⇒ 1440/day). At a 100M pool ≈ **6,944 coins/ore**; payout scales down as the pool drains, up as sinks refill. Scaled by the player's share of the ore's HP.
- **Sink split (`CREATOR_FEE`)**: upgrade/marketplace/repair fees → **95% Reward Pool** (recycled to miners), **5% creator**. The 5% is the only structural leak; size mining to long-term sink volume (mainly the 5% marketplace fee), NOT to the seed.
- **Solvency**: total coins (player + pool + creator) === Treasury × rate, always 1:1. `payUpgrade()` only moves coins (no mint/burn) so backing is unchanged.

## Domain glossary
- **Coin** — off-chain in-game currency (DB). Backed 1:1 by $HASHROCK.
- **$HASHROCK** ($TOKEN) — on-chain Solana token, FIXED 1B supply.
- **Treasury** — $HASHROCK backing every coin (pool + player + creator) 1:1; locked/multisig.
- **Reward Pool** — coins collected from sinks; the source of mining rewards (drains to miners at ~10%/day, refilled by the 95% sink share).
- **Creator cut** — 5% of every sink; the protocol's only net outflow.
- **FIFO cap** — limit on active ore; when full, the oldest ore is evicted (its pending reward stays in the pool).
- **Throughput** — harvest rate = damage/hit × hit_rate. Increased via speed upgrades (character) & pickaxe.

## DO NOT
- ❌ Do not revert to **isometric** (top-down is decided).
- ❌ Do not add any path that **mints coins other than deposits**.
- ❌ Do not put **village layout / world state / item stats on-chain** (off-chain to save gas). On-chain = only economic value: $HASHROCK transfers, sink payments, treasury, redeem. Tradeable-item *settlement* is on-chain (escrow + atomic swap); item *data & marketplace listings* stay off-chain, server-authoritative.
- ❌ Do not let sinks (upgrade/repair/marketplace) be paid in **mined coins** — sinks are **on-chain $HASHROCK** only (invariant #8).
- ❌ Do not make **upgrades increase total emission** or price them below a ~30-day entry payback (invariant #9). Do not let cosmetics grant large earning boosts (whale drain).
- ❌ Do not trust **client input** for economic values.
- ❌ Do not let ore spawn in the **forest, house property, farm, or water** — keep those out of `freeCells` (`noOre` mask). Expand the map rather than cramming ore into excluded zones.
- ❌ Do not **mint Pixel Crawler art as an NFT** before verifying the Terms (see below).

## Status & roadmap
- ✅ **M1** — Top-down render, camera follow, 4-direction player, blockhash ore + FIFO, depth-by-Y
- ✅ **M2** — 112×112 village (terrain grass/dirt/water, ponds, farms, houses, trees/rocks/bushes, culled ground + collision), hard-bounded forest ring, camera clamped to map bounds, Pixel Crawler art (tiles, animated player, mining swing, ore = diamond crystal-cluster that shrinks with HP), free-cell ore spawn with `noOre` exclusion (forest/house/farm/water), cap 150, HUD (coins/pool/treasury/creator + ore tracker), local reward calc (k% pool, payout proportional to damage), demo upgrade sink (95/5). **Economy v2 locked** (see MVP.md).
- 🟦 **M3** *(current)* — Authoritative server + on-chain deposit/redeem. Stack: **Colyseus** (WS) + **Postgres** + treasury = **EOA** (no custom program for MVP; multisig/program at mainnet per invariant #5).
  - ✅ **3a DONE & PLAYABLE**: `server/` (Colyseus) authoritative ore spawn/FIFO, time-based mining, multi-user damage-share reward, pool. **Postgres** persistence + audit `ledger`, invariant 1:1 enforced (`db.ts`). **`shared/mapgen.ts`** = single map-truth (server freeCells == client render). **Client wired** (`net.ts` + networked `world.ts`): renders synced state, sends intents (move/mine/upgrade), renders other players, persistent `playerId` (localStorage). Verified end-to-end: real browser miner earned coins, persisted, invariant held.
  - 🟦 **3b**: ✅ **on-chain redeem + deposit** — $HASHROCK SPL on devnet (decimals 0, fixed 1B, mint authority burned), treasury = EOA. `chain.ts` redeemTo/verifyDeposit; DB persistRedeem/refund/persistDeposit (sig-deduped, transactional). Client Profile: save wallet, redeem (burn→release, refund on fail), deposit (paste tx sig→credit). Setup: `server/scripts/setup-chain.mjs` (secret in `server/.treasury.json`, gitignored; mint+treasury in `.env`). Left in 3b: blockhash relayer (real Solana blockhash → ore), move/speed anti-cheat, deposit auto-watcher (currently sig-paste).
  - Run: `./server/scripts/pg.sh start` → `npm --prefix server run dev` → `npm run dev` (client).
- ⬜ **M4** — End-to-end Phantom, blockhash relayer, live testnet

## Assets & license
- Art: **Anokolisa Pixel Crawler** (free, 16×16, top-down). Crystal = ore, 4-direction character, pickaxe, anvil. Extracted under `assets/pixel-crawler/`.
- ⚠️ **Read the Terms (`assets/pixel-crawler/Terms.txt`) regarding NFT/crypto before use.** The pack permits commercial use but prohibits selling or marketing the assets as a final product. Using the art for the world/characters/gameplay is fine; **minting the art as an NFT is not** → for NFT items (e.g. axe rarity), use commissioned/procedural art with full rights.
- Current placeholders = `Graphics`; swap points are marked `// TODO` / `// swap` in the code.

See **MVP.md** for the full gameplay & economy spec.
