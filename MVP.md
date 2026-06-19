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

## Economy v2 (deposit-backed, solvent, on-chain sinks) — LOCKED
Dual currency: **$HASHROCK** (on-chain SPL, FIXED **1B** supply) + **Coin** (off-chain, in-game).

**Invariants (see CLAUDE.md):**
- Coins are minted ONLY when $HASHROCK enters the Treasury (1:1). Mining does NOT mint.
- `Total coins (player + pool + creator) === Treasury $HASHROCK × rate`. Always 1:1.
- Mining = redistribution from the **Reward Pool**; redeeming burns coins; server authoritative.

**Token allocation:** 1B fixed. **100M (10%)** seeds the Reward Pool = the play-to-earn
budget (protocol-owned coins, backed by 100M Treasury — NOT player-deposit backing).

### The two big design decisions
1. **All sinks are ON-CHAIN, paid in $HASHROCK** (upgrade, repair, marketplace). You can
   NOT pay sinks with mined coins. This (a) creates real demand/buy-pressure for the token,
   (b) stops free-grinders from self-sustaining without injecting value (which would be
   unfair to spenders & leak the loop), (c) makes earned coins' only exit = **redeem →
   $HASHROCK**. Coins are just the off-chain accrual layer (fast mining, no gas/ore,
   batched redeem, server-signed = anti-cheat). Solana's ~$0.0001 gas makes even frequent
   repair on-chain viable.
2. **Fixed pie.** Ore supply is fixed (1/min ⇒ 1440/day, FIFO cap 150) and total payout =
   a % of the pool/day. Upgrades do NOT increase emission — they shift *share*. So upgrades
   can never drain the protocol; aggressive upgrade pricing just funnels more $HASHROCK into
   the pool. The only thing to police is per-player fairness (no instant arbitrage).

### Reward payout (self-balancing, never 0)
`payout/ore = REWARD_RATE × current_pool`, scaled by the player's share of the ore's HP.
`REWARD_RATE = DAILY_EMISSION / ORE_PER_DAY = 0.10 / 1440 ≈ 0.0069%`/ore. At a 100M pool
≈ **6,944 coins/ore**; shrinks as the pool drains, recovers as sinks refill. FIFO-evicted
ore keeps its reward in the pool (invariant #7).

### Sink split & sustainability
- **Sink split:** upgrade / repair / marketplace-fee → **95% Reward Pool**, **5% Creator**.
  The 5% is the ONLY structural leak.
- **Durability + repair (recurring sink, auto-scales with mining):** axes wear per hit;
  repair (on-chain $HASHROCK) ≈ **30% of throughput** recycles into the pool. Higher tiers
  wear faster + cost more to repair → **built-in anti-whale upkeep**. At dura 0: mining
  power −70% (degrade, never hard-block).
- **Cosmetics = the real sustainability engine (net inflow):** primary sales of skins /
  accessories / limited characters bring fresh $HASHROCK. **Keep cosmetics decoupled from
  earning power** (mostly visual; any boost small & bounded) or whales extract faster.
  Suggested primary-sale split: **50% pool / 40% creator / 10% treasury-reserve**.
- **Honest truth:** a P2E where *everyone* profits forever doesn't exist (5% leak + the
  pie is fixed). Target a mix of net-spenders (play for fun/status) funding net-earners
  (grinders). Repair recycles activity; cosmetics bring fresh value; `k%` auto-throttles so
  it's always solvent.

**Faucet → Sink:**
| Faucet (coins in) | Sink (→ 95% pool / 5% creator) |
|--------|---------------|
| $HASHROCK deposit & on-chain sink payments (mint backed coins to pool) | Redeem (burn), repair, upgrade, marketplace fee 5%, cosmetics |

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

## Progression & upgrade pricing (LOCKED — gap 6×, "payback faster per level")
Three upgrade tracks, all **paid on-chain in $HASHROCK**, Lv 1→10. Design intent:
**higher level ⇒ slightly faster payback** (drives the upgrade ladder), bounded so the
**max-all veteran earns ≈ 6× a fresh free player** — spending clearly pays, free players
keep ~1/6 share (viable to climb). 6× falls out of the throughput formula naturally:
damage (axe+char, additive) → ~3× × speed → ~2× = **6×**.

Pricing rule: benefit grows faster than cost ⇒ payback shrinks per level. Anchor: first
upgrade = **30-day** payback. Costs denominated in **ore-equivalents** (auto-scale with the
pool; re-peg to $HASHROCK periodically). `D` = base daily ore output (example `D = 40`).

**1. Axe — damage/hit** (max 1.8×)
| Lv→ | 1→2 | 5→6 | 9→10 | Total |
|---|---|---|---|---|
| ore-equiv | 81 | 95 | 111 | **~860** |
| payback | 30d | 27d | 24d | — |

**2. Char Speed — hit_rate + move_speed** (max 1.9× + travel QoL — best track to raise first)
| Lv→ | 1→2 | 5→6 | 9→10 | Total |
|---|---|---|---|---|
| ore-equiv | 89 | 104 | 122 | **~940** |
| payback | 30d | 26d | 23d | — |

**3. Char Level — mining power + unlock** (max 1.75×; **gates axe & speed: both ≤ char level** = anti-whale)
| Lv→ | 1→2 | 5→6 | 9→10 | Total |
|---|---|---|---|---|
| ore-equiv | 77 | 90 | 105 | **~810** |
| payback | 30d | 27d | 25d | — |

**Max all three ≈ 65 D (~2,610 ore-equiv) → 6× throughput.** Payback 30d → ~24d entry→top.
Knob: ~8× gap = stronger whale pull (steeper payback); ~4× = more egalitarian. **6× = default.**

- **Marketplace:** player-to-player tool/cosmetic trading. **Settlement on-chain in
  $HASHROCK** (95% seller / 5% creator); **item data & listings off-chain** (in-game).
  Only owned items are listable. Needs **escrow + atomic swap** so on-chain payment and
  off-chain ownership transfer can't desync (server-authoritative + signature).
- **Bootstrap:** start with a **free character + axe**; everything beyond is pay-to-earn.

## Deposit & Redeem
```
DEPOSIT : automatic. Sign tx → Treasury → server credits coins.
REDEEM  : MANUAL, accumulate freely. Min 10 $TOKEN. Server signs → contract releases $TOKEN.
```

## MVP parameters (defaults, tunable)
```yaml
token:   { supply: 1_000_000_000, pool_seed: 100_000_000, rate: 1, min_redeem: 10, redeem_cooldown_sec: 0 }
mining:  { map_size: 112, hash_digits: 4, interval_sec: 60, ore_hp: 100, ore_cap: 150,
           ore_per_day: 1440, daily_emission: 0.10, reward_k: 0.0000694, reward_floor: 1 }
sinks:   { creator_fee: 0.05, pool_fee: 0.95, marketplace_fee: 0.05,
           cosmetic_split: { pool: 0.50, creator: 0.40, treasury: 0.10 } }
upgrade: { tracks: [axe, speed, char_level], levels: 10, max_gap: 6.0,
           entry_payback_days: 30, char_gates_others: true }
repair:  { onchain: true, recycle_pct: 0.30, dura_zero_penalty: 0.70 }
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
✅ M2 — Village, mining animation, HUD (coins/pool/treasury/creator + ore tracker),
        local reward calc (k% pool), demo upgrade sink, Economy v2 locked
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
