# HASHROCK (M1)

Top-down 2D mine-to-earn starter. PixiJS v8 + Vite + TypeScript.
Mendemonstrasikan: **tilemap top-down**, **camera follow**, **player 4-arah**,
**ore spawn dari blockhash** (bias-free), **FIFO cap**, **depth sorting by-y**.

Placeholder pakai `Graphics` (nol aset) supaya langsung jalan. Tinggal swap ke
spritesheet **Anokolisa Pixel Crawler**.

## Jalankan
```bash
npm install
npm run dev      # http://localhost:5173
```

## Kontrol
- **WASD / arrow** → jalan (camera ngikutin)
- **Space** → mine ore terdekat dalam jangkauan (HP −25; habis = hilang)
- **+ Block** / auto 3 dtk → spawn ore dari blockhash

## Struktur
```
src/
  topdown.ts  # math top-down: cellCenter, facing 4-arah, depth = y
  ore.ts      # blockhash->cell (% 1024 bias nol), FIFO
  world.ts    # tilemap, camera follow, player, ore, mining
  main.ts     # bootstrap
```

## Yang sudah benar
- **Depth by-y**: `entities.sortableChildren`, `zIndex = screenY`. Objek lebih bawah = di depan.
- **Camera follow**: `scene.x = screenW/2 - playerX` (di-round, anti-jitter).
- **4-arah facing**: dominant-axis dari vektor gerak.
- **Bias-free**: zone 32×32 = 1024, `parseInt(hash.slice(-4),16) % 1024`.

## Swap ke Pixel Crawler (langkah berikutnya)

### 1. Tile (Tiled → PixiJS)
- Pixel Crawler = 16×16. Set `TILE = 16` di `topdown.ts`.
- Untuk pixel crisp: `antialias:false` (sudah), dan scale stage ×2–×3:
  `app.stage.scale.set(2)`. Tekstur pakai `texture.source.scaleMode = 'nearest'`.
- Susun map di **Tiled** → export JSON → parse layer → ganti `buildGround()`.

### 2. Character (4-arah animated)
- Ganti `makePlayer()`/`drawPlayer()` dengan `AnimatedSprite`.
- Pixel Crawler char modular: composite part (body→hair→clothes→weapon) sebagai
  `Container` berlapis. Pilih baris frame per `facing` (down/up/left/right).
- Animasi mining: pakai frame **Crush/Slice/Pierce** saat Space ditekan.
```ts
import { Assets, AnimatedSprite } from "pixi.js";
const sheet = await Assets.load("/assets/character.json");
const walkDown = new AnimatedSprite(sheet.animations["walk_down"]);
walkDown.anchor.set(0.5, 0.85); // kaki di titik grid
```

### 3. Ore = blue crystal
- Ganti `makeOreGfx()` dengan Sprite crystal Pixel Crawler.

## Hubungkan ke ekonomi (M2–M3)
- `tryMine()` → kirim damage ke server (WebSocket); server authoritative.
- Reward = proporsional damage × (k% reward pool). Resolusi di server.
- Ore spawn: ganti `randomBlockhash()` dengan blockhash Solana confirmed (relayer 1/menit).

## Stack
PixiJS v8 · Vite · TypeScript · (next: Tiled, WebSocket/Colyseus, Solana/Anchor)
