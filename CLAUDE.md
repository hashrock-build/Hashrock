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
  village.ts  # 128x128 gen: terrain (grass/dirt/water/sand-shore), ponds, fenced farms, 6 house variants, noise-clustered forests, rock outcrops, decor
  ground.ts   # Viewport-culled ground layer (pool ~ one screenful, not 128x128)
  tiles.ts    # Floor+water atlas, ore crystal frames + diamond-cluster layout
  props.ts    # Trees/rocks/bushes/houses/fence/scarecrow/crops/decor + footprints
  player.ts   # Animated 4-direction player (idle/walk/mining swing)
  world.ts    # Camera follow, player+collision, ore, mining, depth sort
  main.ts     # Loads assets, bootstraps the Application + wires the HUD
```
Top-down rendering: `screen = grid × TILE` (straight, NO 2:1 math). Depth sort =
`zIndex = screenY` (objects lower on screen draw in front). Map is 128×128 tiles;
ground is **viewport-culled** (a sprite pool the size of the screen), so map size is
free. Solid props (trees/rocks/houses/water) block both ore spawning and the player;
non-blocking dressing (flowers/tufts/crops/fence) renders in a flat `decorLayer`.
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

> The primary attack surface = **off-chain accounting**. A bug that mints coins without
> a deposit (double-credit, forged redeem signature, race condition) directly breaks the 1:1 backing.

## Conventions
- TypeScript strict, ESM, `type: module`.
- Pixel art: `antialias: false`, `nearest` scale mode. For Pixel Crawler 16×16 → `TILE = 16` + scale the stage ×2–3.
- Sprite anchor at the **feet** (`anchor.set(0.5, 0.85)`) so depth-by-Y is correct.
- Ore spawns on **any free tile** of the 128×128 village. The blockhash's last 4 hex digits (0..65535) index the precomputed **free-cell list**, so a hash landing on a prop tile is auto-rejected (bias negligible while 65536 ≫ free cells). Bigger map → widen the digit slice (`HASH_DIGITS` in `ore.ts`): 5 hex ≈ 1.05M, 6 ≈ 16.7M.
- FIFO cap default **150** (`CAP` in `world.ts`). Unmined-ore lifetime ≈ cap × spawn interval.

## Domain glossary
- **Coin** — off-chain in-game currency (DB). Backed 1:1 by $TOKEN.
- **$TOKEN** — on-chain Solana token, FIXED supply.
- **Reward Pool** — coins collected from sinks; the source of mining rewards.
- **FIFO cap** — limit on active ore; when full, the oldest ore is evicted.
- **Throughput** — harvest rate = damage/hit × hit_rate. Increased via speed upgrades (character) & pickaxe.

## DO NOT
- ❌ Do not revert to **isometric** (top-down is decided).
- ❌ Do not add any path that **mints coins other than deposits**.
- ❌ Do not put **village layout / inventory on-chain** (keep off-chain to save gas).
- ❌ Do not trust **client input** for economic values.
- ❌ Do not **mint Pixel Crawler art as an NFT** before verifying the Terms (see below).

## Status & roadmap
- ✅ **M1** — Top-down render, camera follow, 4-direction player, blockhash ore + FIFO, depth-by-Y
- 🟦 **M2** *(current)* — Done: 128×128 village (terrain grass/dirt/water, ponds, farms, houses, trees/rocks/bushes, culled ground + collision), Pixel Crawler art (tiles, animated player, mining swing, ore = diamond crystal-cluster that shrinks with HP), free-cell ore spawn, cap 150. Left: HUD dual-balance + ore tracker, local reward calc.
- ⬜ **M3** — Authoritative WebSocket + smart contract (deposit/redeem/treasury) on testnet
- ⬜ **M4** — End-to-end Phantom, blockhash relayer, live testnet

## Assets & license
- Art: **Anokolisa Pixel Crawler** (free, 16×16, top-down). Crystal = ore, 4-direction character, pickaxe, anvil. Extracted under `assets/pixel-crawler/`.
- ⚠️ **Read the Terms (`assets/pixel-crawler/Terms.txt`) regarding NFT/crypto before use.** The pack permits commercial use but prohibits selling or marketing the assets as a final product. Using the art for the world/characters/gameplay is fine; **minting the art as an NFT is not** → for NFT items (e.g. axe rarity), use commissioned/procedural art with full rights.
- Current placeholders = `Graphics`; swap points are marked `// TODO` / `// swap` in the code.

See **MVP.md** for the full gameplay & economy spec.
