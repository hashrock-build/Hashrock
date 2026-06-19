import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { TILE, cellCenter, facingFrom, Facing } from "./topdown";
import { Ore, makeOre, randomBlockhash } from "./ore";
import { clusterForHp, CRYSTAL_W, GroundTiles } from "./tiles";
import { Player, PlayerAnims } from "./player";
import { WorldProps } from "./props";
import { MAP_W, MAP_H, idx, inB, buildVillage, Village } from "./village";
import { GroundLayer } from "./ground";

export const CAP = 150; // FIFO cap. Evicted ore coin -> reward pool (server-side).
// Mining is TIME-BASED: a base (1x) player fully mines one ore in BASE_MINE_TIME seconds.
// DPS = (ore.maxHp / BASE_MINE_TIME) × throughput. Upgrades (axe + speed + char) raise
// `throughput` (up to ~6x maxed) → proportionally faster: 30s → 5s at 6x.
export const BASE_MINE_TIME = 30; // seconds per ore for a 1x player
const MINE_RANGE = TILE * 1.6;
const MOVE_SPEED = 130; // px/sec

// ⚠️ LOCAL reward PREVIEW only — the M3 server is authoritative (see CLAUDE.md
// invariants). Mining does NOT mint coins; payout is *redistributed* from the Reward
// Pool. Reward is DYNAMIC: a fixed % of the *current* pool per ore, so it self-balances
// (pool shrinks → payout shrinks, never hits 0; sinks refill it → payout recovers). It
// is scaled by this player's share of the ore's HP (full share in local single-player).
const ORE_PER_DAY = 1440;        // 1 ore / minute
const DAILY_EMISSION = 0.10;     // pay out ~10% of the pool per day to miners
const REWARD_RATE = DAILY_EMISSION / ORE_PER_DAY; // ≈ 0.0069% of the pool per ore
const REWARD_FLOOR = 1;          // minimum payout, coins (only bites when pool ~empty)
const POOL_SEED = 100_000_000;   // 100M $HASHROCK seed (10% of 1B supply) → play-to-earn budget
// Upgrade/marketplace/repair sink split: 95% recycles to the pool, 5% to the creator.
export const CREATOR_FEE = 0.05;
/** Coins paid for fully mining one ore, given the current pool. Never exceeds the pool. */
export function poolPayout(pool: number): number {
  return Math.min(pool, Math.max(REWARD_FLOOR, Math.floor(pool * REWARD_RATE)));
}

export interface WorldAssets {
  groundTiles?: GroundTiles;
  crystals?: Texture[];
  playerAnims?: PlayerAnims;
  props?: WorldProps;
  village?: Village; // override the generated village (e.g. a showcase map)
}

export class World {
  app: Application;
  scene: Container; // moved by camera
  entities: Container; // depth-sorted by y (props, ore, player)
  decorLayer: Container; // flat ground decals (flowers/tufts)
  ground?: GroundLayer;
  village: Village;

  playerNode: Container;
  playerCtl?: Player;
  facing: Facing = "down";
  px: number;
  py: number;

  ores: Ore[] = [];
  oreGfx = new Map<number, Container>();
  dmgByPlayer = new Map<number, number>(); // ore id -> damage this player dealt
  private oreBucket = new Map<number, number>(); // ore id -> last-drawn HP bucket (throttle redraw)
  throughput = 1; // mining-speed multiplier (1 = free/base; ~6 maxed). Try `world.throughput = 6` in console.
  miningOreId: number | null = null; // ore currently being mined (single-press start; cancels on move)
  private miningBar!: Container;     // progress bar + seconds shown under the character while mining
  private miningBarG!: Graphics;
  private miningBarTxt!: Text;
  propNodes: Sprite[] = [];
  keys = new Set<string>();

  // economy (LOCAL preview — server-authoritative in M3)
  coins = 0;             // player's in-game coin balance
  pool = POOL_SEED;      // Reward Pool: source of mining payouts (filled by sinks)
  treasury = POOL_SEED;  // $HASHROCK backing ALL coins (pool + player + creator), 1:1
  creator = 0;           // creator revenue (coins, redeemable to $HASHROCK)

  readonly cap = CAP;
  onChange?: () => void;
  crystals?: Texture[];
  oreScale = 1;

  constructor(app: Application, assets: WorldAssets = {}) {
    this.app = app;
    this.crystals = assets.crystals;
    this.oreScale = assets.crystals ? TILE / CRYSTAL_W : 1;
    this.village = assets.village ?? buildVillage(assets.props!);

    this.scene = new Container();
    this.app.stage.addChild(this.scene);

    // ground: dual-grid autotile baked into RenderTexture chunks (built once)
    if (assets.groundTiles) {
      this.ground = new GroundLayer(app, MAP_W, MAP_H, this.village.terrain, assets.groundTiles);
      this.scene.addChild(this.ground.container);
    }

    // flat ground decals (flowers/tufts) — drawn above ground, below everything else
    this.decorLayer = new Container();
    this.scene.addChild(this.decorLayer);

    this.entities = new Container();
    this.entities.sortableChildren = true;
    this.scene.addChild(this.entities);

    // mining progress bar (under the character) — created once, shown only while mining
    this.miningBar = new Container();
    this.miningBar.visible = false;
    this.miningBar.zIndex = 2e9; // above everything
    this.miningBarG = new Graphics();
    this.miningBarTxt = new Text({
      text: "", style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "700", fill: "#ffffff", stroke: { color: "#1a1330", width: 3 } },
    });
    this.miningBarTxt.anchor.set(0.5, 1);
    this.miningBar.addChild(this.miningBarG, this.miningBarTxt);
    this.entities.addChild(this.miningBar);

    this.buildProps();

    // player starts on the guaranteed-clear spawn cell
    const start = cellCenter(this.village.spawn.gx, this.village.spawn.gy);
    this.px = start.x;
    this.py = start.y;

    if (assets.playerAnims) {
      this.playerCtl = new Player(assets.playerAnims, TILE / 16);
      this.playerNode = this.playerCtl.sprite;
    } else {
      this.playerNode = this.makePlayerFallback();
    }
    this.entities.addChild(this.playerNode);

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key === " ") { // single press starts mining the nearest ore (no need to hold)
        e.preventDefault();
        if (this.miningOreId == null) this.miningOreId = this.nearestOre()?.id ?? null;
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));

    this.app.ticker.add(() => this.update());
  }

  // ----- props (trees / rocks / houses / farm): depth-sorted with everything else -----
  private buildProps(): void {
    for (const p of this.village.props) {
      const s = new Sprite(p.def.texture);
      s.anchor.set(p.def.anchorX, p.def.anchorY);
      s.scale.set(p.def.scale);
      s.roundPixels = true;
      s.x = (p.gx + p.def.footW / 2) * TILE;
      s.y = (p.gy + p.def.footH) * TILE;
      s.zIndex = s.y;
      this.entities.addChild(s);
      this.propNodes.push(s);
    }
    // flat decals (flowers/tufts) — non-sorted, always under entities
    for (const d of this.village.decor) {
      const s = new Sprite(d.def.texture);
      s.anchor.set(d.def.anchorX, d.def.anchorY);
      s.scale.set(d.def.scale);
      s.roundPixels = true;
      s.x = (d.gx + 0.5) * TILE;
      s.y = (d.gy + 1) * TILE;
      this.decorLayer.addChild(s);
    }
  }

  private blockedAt(worldX: number, worldY: number): boolean {
    const gx = Math.floor(worldX / TILE);
    const gy = Math.floor(worldY / TILE);
    if (!inB(gx, gy)) return true;
    return this.village.blocked[idx(gx, gy)] === 1;
  }

  // ----- player fallback (used only if the character sheets failed to load) -----
  private makePlayerFallback(): Graphics {
    const g = new Graphics();
    this.drawPlayer(g);
    return g;
  }
  private drawPlayer(g: Graphics): void {
    g.clear();
    g.ellipse(0, TILE * 0.42, TILE * 0.32, TILE * 0.16).fill({ color: 0x000000, alpha: 0.2 });
    g.roundRect(-TILE * 0.28, -TILE * 0.45, TILE * 0.56, TILE * 0.7, 5).fill(0x4a73c8);
    g.circle(0, -TILE * 0.45, TILE * 0.26).fill(0xf2c89a);
    const m: Record<Facing, [number, number]> = {
      down: [0, -TILE * 0.38], up: [0, -TILE * 0.6],
      left: [-TILE * 0.16, -TILE * 0.45], right: [TILE * 0.16, -TILE * 0.45],
    };
    const [mx, my] = m[this.facing];
    g.circle(mx, my, 2.5).fill(0x1a1330);
  }

  // ----- ore: a cluster of blue crystals (diamond node), shrinking with HP -----
  private makeOreNode(ore: Ore): Container {
    if (this.crystals) {
      const c = new Container();
      c.sortableChildren = true;
      this.fillCluster(c, ore);
      return c;
    }
    const g = new Graphics();
    g.ellipse(0, TILE * 0.3, TILE * 0.34, TILE * 0.16).fill({ color: 0x42c8e8, alpha: 0.25 });
    g.poly([0, -TILE * 0.5, -TILE * 0.26, -TILE * 0.05, 0, TILE * 0.15]).fill(0x8fe4f5);
    g.poly([0, -TILE * 0.5, TILE * 0.26, -TILE * 0.05, 0, TILE * 0.15]).fill(0x3aa6d8);
    g.poly([0, -TILE * 0.5, -TILE * 0.26, -TILE * 0.05, TILE * 0.26, -TILE * 0.05]).fill(0xc9f3ff);
    return g;
  }

  /** (Re)build a crystal cluster into the node container for the ore's current HP. */
  private fillCluster(c: Container, ore: Ore): void {
    for (const ch of c.removeChildren()) ch.destroy();
    const frames = this.crystals!;
    for (const sh of clusterForHp(ore.hp, ore.maxHp)) {
      const s = new Sprite(frames[sh.frame]);
      s.anchor.set(0.5, 0.92);
      s.scale.set(this.oreScale);
      if (sh.flip) s.scale.x = -this.oreScale;
      s.x = sh.dx * this.oreScale;
      s.y = sh.dy * this.oreScale;
      s.zIndex = sh.dy;
      s.roundPixels = true;
      c.addChild(s);
    }
  }

  spawnOre(): Ore {
    const ore = makeOre(randomBlockhash(), this.village.freeCells, MAP_W);
    if (this.ores.length >= this.cap) {
      const oldest = this.ores.shift();
      // FIFO eviction: the ore's would-be reward stays in the pool (invariant #7) and any
      // partial damage on it is forfeited — clear local tracking.
      if (oldest) {
        this.oreGfx.get(oldest.id)?.destroy(); this.oreGfx.delete(oldest.id);
        this.dmgByPlayer.delete(oldest.id); this.oreBucket.delete(oldest.id);
      }
    }
    this.ores.push(ore);
    const g = this.makeOreNode(ore);
    const c = cellCenter(ore.gx, ore.gy);
    g.x = c.x; g.y = c.y; g.zIndex = c.y;
    this.entities.addChild(g);
    this.oreGfx.set(ore.id, g);
    this.onChange?.();
    return ore;
  }

  /**
   * DEMO ONLY — visualizes the sink split (95% pool / 5% creator) using in-game coins.
   * In production, sinks (upgrade/repair/marketplace) are paid ON-CHAIN in $HASHROCK,
   * NEVER in mined coins (invariant #8). Here it just moves coins around to show the flow:
   * no coins are minted/burned, so total circulation & the 1:1 treasury backing are
   * unchanged. Returns false if the player can't afford it.
   */
  payUpgrade(cost: number): boolean {
    if (this.coins < cost) return false;
    const cut = Math.round(cost * CREATOR_FEE);
    this.coins -= cost;
    this.creator += cut;        // creator's cut (backed; leaves the loop only on redeem)
    this.pool += cost - cut;    // 95% recycles to fund future mining payouts
    this.onChange?.();
    return true;
  }

  private nearestOre(): Ore | undefined {
    let best: Ore | undefined; let bestD = Infinity;
    for (const o of this.ores) {
      const c = cellCenter(o.gx, o.gy);
      const d = Math.hypot(c.x - this.px, c.y - this.py);
      if (d < MINE_RANGE && d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  /**
   * Auto-mine the locked-in ore (started by a single Space press). Deals DPS×dt each
   * frame until the ore is depleted, the player moves, or the ore leaves range/vanishes.
   */
  private handleMining(dt: number, moving: boolean): Ore | undefined {
    if (this.miningOreId == null) return undefined;
    if (moving) { this.miningOreId = null; return undefined; } // moving cancels mining
    const ore = this.ores.find((o) => o.id === this.miningOreId);
    if (!ore) { this.miningOreId = null; return undefined; }
    const c = cellCenter(ore.gx, ore.gy);
    if (Math.hypot(c.x - this.px, c.y - this.py) >= MINE_RANGE) { this.miningOreId = null; return undefined; }
    const dps = (ore.maxHp / BASE_MINE_TIME) * this.throughput;
    this.damageOre(ore, dps * dt);
    return ore;
  }

  private setMiningBar(ore?: Ore): void {
    if (!ore) { this.miningBar.visible = false; return; }
    const w = TILE, h = 5;
    const prog = 1 - Math.max(0, ore.hp) / ore.maxHp;
    const remain = (Math.max(0, ore.hp) / ore.maxHp) * BASE_MINE_TIME / this.throughput;
    this.miningBarG.clear();
    this.miningBarG.roundRect(-w / 2, 0, w, h, 2).fill({ color: 0x1a1330, alpha: 0.85 });
    this.miningBarG.roundRect(-w / 2, 0, w * prog, h, 2).fill(0xffd23f);
    this.miningBarTxt.text = `${remain.toFixed(1)}s`;
    this.miningBarTxt.y = -1;
    this.miningBar.x = this.px;
    this.miningBar.y = this.py + TILE * 0.45; // just below the feet
    this.miningBar.visible = true;
  }

  private damageOre(ore: Ore, dmg: number): void {
    const before = ore.hp;
    ore.hp -= dmg;
    this.dmgByPlayer.set(ore.id, (this.dmgByPlayer.get(ore.id) ?? 0) + Math.min(dmg, before));
    // throttle the crystal-cluster rebuild to ~12 HP buckets (cheap; not every frame)
    if (ore.hp > 0 && this.crystals) {
      const bucket = Math.ceil((ore.hp / ore.maxHp) * 12);
      const g = this.oreGfx.get(ore.id);
      if (g instanceof Container && bucket !== this.oreBucket.get(ore.id)) {
        this.oreBucket.set(ore.id, bucket);
        this.fillCluster(g, ore);
      }
    }
    if (ore.hp <= 0) this.resolveOre(ore);
  }

  private resolveOre(ore: Ore): void {
    // LOCAL reward preview: payout = k% of the pool (floor-clamped), scaled by this
    // player's share of the ore's HP (damage dealt / maxHp). Coins move pool -> player
    // (redistribution, NOT a mint). M3: the server resolves this and signs the balance.
    const share = (this.dmgByPlayer.get(ore.id) ?? ore.maxHp) / ore.maxHp;
    const reward = Math.min(this.pool, Math.round(poolPayout(this.pool) * share));
    this.pool -= reward;
    this.coins += reward;
    const c = cellCenter(ore.gx, ore.gy);
    if (reward > 0) this.floatText(c.x, c.y, `+${reward}`);

    this.oreGfx.get(ore.id)?.destroy(); this.oreGfx.delete(ore.id);
    this.dmgByPlayer.delete(ore.id); this.oreBucket.delete(ore.id);
    if (this.miningOreId === ore.id) this.miningOreId = null;
    this.ores = this.ores.filter((o) => o.id !== ore.id);
    this.onChange?.();
  }

  /** Floating "+N" coin popup at a world position; rises and fades, then self-destroys. */
  private floatText(wx: number, wy: number, msg: string): void {
    const t = new Text({
      text: msg,
      style: { fontFamily: "system-ui, sans-serif", fontSize: 16, fontWeight: "700", fill: "#ffd23f", stroke: { color: "#1a1330", width: 4 } },
    });
    t.anchor.set(0.5, 1);
    t.x = wx; t.y = wy - TILE * 0.6; t.zIndex = 1e9; // always on top
    this.entities.addChild(t);
    let life = 0;
    const tick = (ticker: { deltaMS: number }) => {
      life += ticker.deltaMS;
      t.y -= ticker.deltaMS * 0.03; // drift up
      t.alpha = Math.max(0, 1 - life / 900);
      if (life >= 900) { this.app.ticker.remove(tick); t.destroy(); }
    };
    this.app.ticker.add(tick);
  }

  private update(): void {
    const dt = this.app.ticker.deltaMS / 1000;
    let vx = 0, vy = 0;
    if (this.keys.has("a") || this.keys.has("arrowleft")) vx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) vx += 1;
    if (this.keys.has("w") || this.keys.has("arrowup")) vy -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) vy += 1;

    const moving = !!(vx || vy);
    if (moving) {
      const len = Math.hypot(vx, vy);
      const dx = (vx / len) * MOVE_SPEED * dt;
      const dy = (vy / len) * MOVE_SPEED * dt;
      // per-axis collision against prop tiles -> slide along walls
      if (!this.blockedAt(this.px + dx, this.py)) this.px += dx;
      if (!this.blockedAt(this.px, this.py + dy)) this.py += dy;
      this.facing = facingFrom(vx, vy, this.facing);
    }
    // clamp to map bounds
    const maxX = MAP_W * TILE, maxY = MAP_H * TILE;
    this.px = Math.max(TILE * 0.5, Math.min(maxX - TILE * 0.5, this.px));
    this.py = Math.max(TILE * 0.5, Math.min(maxY - TILE * 0.5, this.py));

    // auto-mine the locked ore (started by a Space press); cancels if the player moves.
    const mineTarget = this.handleMining(dt, moving);
    const mining = !!mineTarget;
    if (mining) {
      const c = cellCenter(mineTarget!.gx, mineTarget!.gy);
      this.facing = facingFrom(c.x - this.px, c.y - this.py, this.facing);
    }
    this.setMiningBar(mineTarget);

    if (this.playerCtl) this.playerCtl.update(this.facing, moving, mining);
    else this.drawPlayer(this.playerNode as Graphics);

    this.playerNode.x = this.px;
    this.playerNode.y = this.py;
    this.playerNode.zIndex = this.py;

    // camera follow, CLAMPED to the map bounds so the viewport never scrolls past the
    // edge into empty background (which reads as a fake "grass gap" beyond the forest).
    // minX/minY are <=0; on screens wider than the map we fall back to 0 (centred).
    const minX = Math.min(0, this.app.screen.width - MAP_W * TILE);
    const minY = Math.min(0, this.app.screen.height - MAP_H * TILE);
    this.scene.x = Math.round(Math.max(minX, Math.min(0, this.app.screen.width / 2 - this.px)));
    this.scene.y = Math.round(Math.max(minY, Math.min(0, this.app.screen.height / 2 - this.py)));
  }
}
