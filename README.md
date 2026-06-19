# HASHROCK

> Top-down 2D **mine-to-earn** game on Solana. Ore (blue crystals) spawns from the
> **blockhash**, persists, and stacks under a **FIFO cap**. Players mine ore for
> **in-game coins**, then manually redeem them for an on-chain **$TOKEN**.

Built with **PixiJS v8**, **Vite**, and **TypeScript** (strict, ESM).

---

## Status

**Milestone M1 — playable rendering layer.** This is the rendering and movement
foundation. The economy and on-chain layers are scaffolded in the docs and land in
later milestones.

| Milestone | Scope | State |
|-----------|-------|-------|
| **M1** | Top-down render, camera follow, 4-direction player, blockhash ore + FIFO, depth sort by-Y | ✅ Done |
| **M2** | Mining animation, HUD (dual balance + ore tracker), local reward calc | ⬜ Planned |
| **M3** | Authoritative WebSocket server + smart contract (deposit / redeem / treasury) on testnet | ⬜ Planned |
| **M4** | End-to-end Phantom wallet, blockhash relayer (1/min), live testnet | ⬜ Planned |

Placeholders use PixiJS `Graphics` (zero assets) so the project runs immediately.
The full **Anokolisa Pixel Crawler** art pack ships under [`assets/`](assets/) and the
swap points are marked with `// swap` / `// TODO` in the code.

---

## Quick start

```bash
npm install
npm run dev      # Vite dev server → http://localhost:5173
```

| Script | Action |
|--------|--------|
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Type-check (`tsc --noEmit`) and build for production |
| `npm run preview` | Preview the production build locally |

### Controls

| Input | Action |
|-------|--------|
| `WASD` / Arrow keys | Move (the camera follows the player) |
| `Space` | Mine the nearest ore in range (−25 HP; destroyed at 0) |
| **+ Block** button / auto every 3s | Spawn ore from a blockhash |

---

## Architecture

```
src/
  topdown.ts   # Top-down math: cellCenter, 4-direction facing, depth = screen Y
  ore.ts       # blockhash → cell (% 1024, bias-free), Ore type, FIFO id
  world.ts     # Tilemap, camera follow, player, ore, mining, depth sort
  main.ts      # Bootstraps the Application and wires the HUD
assets/
  pixel-crawler/   # Anokolisa Pixel Crawler art pack (16×16, top-down)
```

Rendering is **straight top-down**: `screen = grid × TILE` with no 2:1 isometric
skew. Depth ordering uses `zIndex = screenY`, so objects lower on screen draw in
front. The mining zone is **32×32 = 1024 cells**; because `65536 % 1024 === 0`,
mapping a blockhash to a cell is **bias-free** without rejection sampling.

---

## Economy — deposit-backed and solvent

HASHROCK uses a dual-currency model with a strict 1:1 backing invariant.

- **Coin** — off-chain, in-game currency (stored in the server database).
- **$TOKEN** — on-chain Solana token with a **fixed** supply.

> **Core invariant:** `total coins in circulation === Treasury $TOKEN × rate`.
> Coins are **only** minted when a `$TOKEN` deposit is confirmed (1:1). **Mining
> never mints coins** — mining rewards are redistributed from a **Reward Pool** that
> is filled by sinks (marketplace fees, upgrades, repairs). Redeeming **burns** coins
> before the contract releases `$TOKEN`. The server is **authoritative**; economic
> values from the client are never trusted.

The off-chain accounting layer is the primary attack surface — see
[`CLAUDE.md`](CLAUDE.md) for the full list of economic invariants, and
[`MVP.md`](MVP.md) for the complete gameplay and economy spec.

---

## Swapping in the Pixel Crawler art (next steps)

### 1. Tiles (Tiled → PixiJS)
Pixel Crawler tiles are 16×16. Set `TILE = 16` in `topdown.ts`. For crisp pixels keep
`antialias: false` (already set), scale the stage ×2–×3 (`app.stage.scale.set(2)`),
and use `texture.source.scaleMode = 'nearest'`. Author the map in **Tiled**, export
JSON, parse the layers, and replace `buildGround()`.

### 2. Character (4-direction, animated)
Replace `makePlayer()` / `drawPlayer()` with an `AnimatedSprite`. Pixel Crawler
characters are modular — composite the parts (body → hair → clothes → weapon) as a
layered `Container` and pick the frame row per `facing` (down / up / left / right).
Use the **Crush / Slice / Pierce** frames for the mining animation.

```ts
import { Assets, AnimatedSprite } from "pixi.js";
const sheet = await Assets.load("/assets/character.json");
const walkDown = new AnimatedSprite(sheet.animations["walk_down"]);
walkDown.anchor.set(0.5, 0.85); // feet sit on the grid point for correct depth-by-Y
```

### 3. Ore (blue crystal)
Replace `makeOreGfx()` with the Pixel Crawler crystal sprite.

---

## Connecting the economy (M2–M3)

- `tryMine()` sends damage to the server over WebSocket; the **server is authoritative**.
- Reward = proportional to damage × (k% of the Reward Pool), resolved server-side.
- Ore spawn: replace `randomBlockhash()` with a confirmed Solana blockhash supplied by
  the relayer (once per minute).

---

## Assets & license

Art: **Anokolisa Pixel Crawler — Free Pack** (16×16, top-down). Used here for ground
tiles, mine/cave environments, the 4-direction character, blue crystals (ore), and
pickaxes. See [`assets/pixel-crawler/Terms.txt`](assets/pixel-crawler/Terms.txt).

> ⚠️ **NFT / crypto caution.** The pack's terms permit commercial use but **prohibit
> selling or marketing the assets as a final product**. Using the art for the world,
> characters, and gameplay is fine; **minting the art itself as an NFT is not**. For
> any tradable NFT items, use commissioned or procedurally generated art you hold full
> rights to. When in doubt, contact the author (`AnomalyPixel@gmail.com`).

---

## Stack

PixiJS v8 · Vite · TypeScript · *(next: Tiled, WebSocket/Colyseus, Solana/Anchor, Phantom)*
