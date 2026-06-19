# MVP.md

MVP spec — Blockhash Mining Game. Build-ready. Parameters have defaults; just tune them.

## Concept
Top-down 2D mine-to-earn on Solana. Ore (blue crystals) spawns from the **blockhash**
every minute, is **persistent and stacks** under a **FIFO cap**. Players mine with a
pickaxe → **coins** → manual redeem → **$TOKEN**. The competition is about
**throughput** (harvesting fastest before ore is evicted), not a per-second race.

## Locked decisions
| Aspect | Final |
|--------|-------|
| Perspective | **Top-down** |
| Engine | PixiJS v8 |
| Map | Tiled (JSON) |
| Language | TypeScript, ESM |
| Art | Anokolisa Pixel Crawler 16×16 (free) |
| Chain | Solana + Anchor |
| Backend | Node/TS + DB + WebSocket |
| Wallet | Phantom |

## Economy (deposit-backed, solvent)
Dual currency: **$TOKEN** (on-chain, FIXED supply) + **Coin** (off-chain, in-game).

**Invariants (see CLAUDE.md for details):**
- Coins are minted only on deposit (1:1). Mining does NOT mint coins.
- `Total coins === Treasury $TOKEN × rate`. Always backed.
- Mining rewards come from the **Reward Pool** (filled by sinks). Redeeming burns coins.
- The server is authoritative; off-chain accounting is the primary attack surface.

**Faucet → Sink:**
| Faucet | Sink (→ pool) |
|--------|---------------|
| $TOKEN deposit | Redeem (burn), marketplace fee 5%, upgrades, repairs |

## Mining mechanic
```
• Ore spawns 1 per 30s/60s from the blockhash (last 4 hex chars → 0..65535)
• 128×128 village; hash indexes the FREE-CELL list → ore can land on any open tile,
  prop tiles (trees/rocks/buildings) auto-rejected (bias negligible, 65536 ≫ free cells)
• Persistent, stacks; FIFO cap → oldest ore evicted, coins return to the pool
• Ore has HP; mining = damage; HP depleted → reward is PROPORTIONAL to damage
• Reward is DYNAMIC: payout = k% of the pool (self-balancing), with a floor
```

**Throughput:**
```
damage_per_hit  = pickaxe_base + (pickaxe_level × bonus) + char_mining_power
hit_rate (/sec) = base_rate + char_speed_level
move_speed      = base_move + char_speed_level
```

## Progression
- **Character (Lv 1–20):** Mining Power, Speed Level (attack speed + move speed), inventory.
- **Pickaxe/Axe:** rarity (Pixel Crawler variants) + level (upgrade at the Anvil) → damage + durability.
- **Marketplace:** tool trading, split 95% seller / 5% pool.

## Deposit & Redeem
```
DEPOSIT : automatic. Sign tx → Treasury → server credits coins.
REDEEM  : MANUAL, accumulate freely. Min 10 $TOKEN. Server signs → contract releases $TOKEN.
```

## MVP parameters (defaults, tunable)
```yaml
token:   { rate: 1000, min_redeem: 10, redeem_cooldown_sec: 0 }
mining:  { map_size: 128, hash_digits: 4, interval_sec: 60, ore_hp: 100, ore_cap: 150,
           reward_k: 0.005, reward_floor: 50 }
sinks:   { marketplace_fee: 0.05 }
```

## MVP scope (Phase 1)
**IN:**
- [ ] Contract: deposit, redeem (manual), treasury, reward pool accounting
- [ ] Blockhash ore spawn (persistent + FIFO cap), 1 mining zone 32×32
- [ ] Mine → dynamic proportional reward from the pool
- [ ] Top-down 4-direction character + mining animation (Pixel Crawler)
- [ ] Basic pickaxe + 1 upgrade path
- [ ] Small world from Tiled
- [ ] WebSocket sync (spawn/HP/evict/position)
- [ ] Deposit/redeem UI (Phantom)
- [ ] HUD: dual balance, ore tracker, mine
- [ ] Deploy to testnet

**DEFERRED (Phase 2+):** building placement (Anvil/Sawmill/Furnace), full axe rarity + marketplace, land expansion, modular character customization, enemies/PvE/PvP, audit + mainnet.

## Roadmap
```
✅ M1 — Top-down render, camera follow, 4-direction player, blockhash ore + FIFO
⬜ M2 — Mining animation, HUD (balance + ore tracker), local reward calc
⬜ M3 — Authoritative WebSocket + contract deposit/redeem/treasury (testnet)
⬜ M4 — End-to-end Phantom, blockhash relayer 1/min, live testnet
```

## Asset checklist (Pixel Crawler → game)
| Pack contents | Used as | Phase |
|---------------|---------|-------|
| Blue crystals | Ore node | MVP |
| Ground tiles | World / zone floor | MVP |
| Mine/cave environment | Mining zone theme | MVP |
| 4-direction character | Player + mining animation (Crush/Slice/Pierce) | MVP |
| Pickaxe (Wood/Bone) | Tool | MVP |
| Axe + weapons | Axe rarity (variant = tier) | Phase 2 |
| Anvil/Sawmill/Furnace | Buildings | Phase 2 |
| Houses, props | Village | Phase 2 |
| Skeleton/Orc | Combat/PvE | Phase 3+ |

## ⚠️ License & NFT
Read the Pixel Crawler Terms (`assets/pixel-crawler/Terms.txt`) **before** building an
NFT economy. The pack permits commercial use but **prohibits selling or marketing the
assets as a final product** — so minting the art itself as an NFT is not allowed. Using
the art for the world/characters/gameplay is fine; any tradable/sold NFT items must use
commissioned or procedural art you hold full rights to. Contact the author
(`AnomalyPixel@gmail.com`) if unsure.
