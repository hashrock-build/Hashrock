// Authoritative mining room. The server owns ore spawn (blockhash -> free cell), the
// FIFO cap, mining validation (time-based DPS while in range & not moving), and the
// reward pool. Clients only send intents (move / mine) and render the synced state.
//
// ⚠️ Economy is IN-MEMORY for now (state.pool). Postgres persistence + deposit/redeem
// land next (blocked on the local Postgres install). Map free-cells are a PLACEHOLDER
// central region until the shared deterministic map-gen is extracted (so server & client
// agree on ore positions). Both are marked TODO below.
import { Room, Client } from "colyseus";
import { MineState, OreState, PlayerState } from "./schema";

const TILE = 32;
const MAP_W = 112, MAP_H = 112;
const ORE_HP = Number(process.env.ORE_HP ?? 100);
const ORE_CAP = Number(process.env.ORE_CAP ?? 150);
const POOL_SEED = Number(process.env.POOL_SEED ?? 100_000_000);
const DAILY_EMISSION = Number(process.env.DAILY_EMISSION ?? 0.1);
const ORE_PER_DAY = Number(process.env.ORE_PER_DAY ?? 1440);
const REWARD_FLOOR = Number(process.env.REWARD_FLOOR ?? 1);
const BASE_MINE_TIME = Number(process.env.BASE_MINE_TIME_SEC ?? 30);
const SPAWN_INTERVAL = Number(process.env.SPAWN_INTERVAL_SEC ?? 60) * 1000;
const REWARD_RATE = DAILY_EMISSION / ORE_PER_DAY;
const MINE_RANGE = TILE * 1.6;
const TICK_MS = 100; // mining simulation step

const poolPayout = (pool: number) =>
  Math.min(pool, Math.max(REWARD_FLOOR, Math.floor(pool * REWARD_RATE)));

const cellCenter = (gx: number, gy: number) => ({ x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 });

export class MineRoom extends Room<MineState> {
  maxClients = 50;
  private nextOreId = 1;
  private oreOrder: number[] = []; // FIFO insertion order of ore ids
  private freeCells: number[] = []; // PLACEHOLDER (see TODO)
  // per-ore damage contribution: oreId -> (sessionId -> damage). Drives the multi-user split.
  private dmg = new Map<number, Map<string, number>>();

  onCreate(): void {
    this.setState(new MineState());
    this.state.pool = POOL_SEED; // TODO(DB): load the live pool from Postgres
    this.state.cap = ORE_CAP;
    this.state.mapSeed = 0; // village is deterministic; client regenerates the same map

    // TODO(map): replace with the shared deterministic free-cell list (terrain/blocked).
    for (let gy = 36; gy < 76; gy++) for (let gx = 36; gx < 76; gx++) this.freeCells.push(gy * MAP_W + gx);

    this.onMessage("move", (client, m: { x: number; y: number }) => this.onMove(client, m));
    this.onMessage("mine", (client, m: { oreId: number }) => this.onMineStart(client, m));
    this.onMessage("stopMine", (client) => { const p = this.state.players.get(client.sessionId); if (p) p.miningOreId = 0; });

    this.clock.setInterval(() => this.spawnOre(), SPAWN_INTERVAL);
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS);
    this.spawnOre();
  }

  onJoin(client: Client, opts: { name?: string } = {}): void {
    const p = new PlayerState();
    const c = cellCenter(MAP_W >> 1, MAP_H >> 1);
    p.x = c.x; p.y = c.y;
    p.name = (opts.name || "miner").slice(0, 16);
    p.coins = 0;      // TODO(DB): load this player's balance from Postgres
    p.throughput = 1; // TODO: derive from the player's upgrades
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
  }

  // --- intents (authoritative validation) ---
  private onMove(client: Client, m: { x: number; y: number }): void {
    const p = this.state.players.get(client.sessionId);
    if (!p || typeof m?.x !== "number" || typeof m?.y !== "number") return;
    // clamp to map; TODO: speed/rate validation to stop teleport-to-ore cheats
    p.x = Math.max(0, Math.min(MAP_W * TILE, m.x));
    p.y = Math.max(0, Math.min(MAP_H * TILE, m.y));
    p.miningOreId = 0; // moving cancels mining (server-enforced)
  }

  private onMineStart(client: Client, m: { oreId: number }): void {
    const p = this.state.players.get(client.sessionId);
    const ore = m && this.state.ores.get(String(m.oreId));
    if (!p || !ore) return;
    const c = cellCenter(ore.gx, ore.gy);
    if (Math.hypot(c.x - p.x, c.y - p.y) < MINE_RANGE) p.miningOreId = ore.id;
  }

  // --- spawn (blockhash -> free cell) + FIFO ---
  private spawnOre(): void {
    if (!this.freeCells.length) return;
    // TODO(3b): use a confirmed Solana blockhash from the relayer instead of random
    const blockhash = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    const cell = this.freeCells[parseInt(blockhash.slice(-4), 16) % this.freeCells.length];
    const ore = new OreState();
    ore.id = this.nextOreId++;
    ore.gx = cell % MAP_W; ore.gy = Math.floor(cell / MAP_W);
    ore.hp = ORE_HP; ore.maxHp = ORE_HP; ore.blockhash = blockhash;
    this.state.ores.set(String(ore.id), ore);
    this.oreOrder.push(ore.id);
    if (this.oreOrder.length > this.state.cap) {
      const evicted = this.oreOrder.shift()!; // FIFO: oldest out; its reward stays in the pool
      this.state.ores.delete(String(evicted));
      this.dmg.delete(evicted);
    }
  }

  // --- mining simulation: apply DPS to each miner's target ore ---
  private tick(dtMs: number): void {
    const dt = dtMs / 1000;
    this.state.players.forEach((p, sessionId) => {
      if (!p.miningOreId) return;
      const ore = this.state.ores.get(String(p.miningOreId));
      if (!ore) { p.miningOreId = 0; return; }
      const c = cellCenter(ore.gx, ore.gy);
      if (Math.hypot(c.x - p.x, c.y - p.y) >= MINE_RANGE) { p.miningOreId = 0; return; }
      const dps = (ore.maxHp / BASE_MINE_TIME) * p.throughput;
      const dealt = Math.min(dps * dt, ore.hp);
      ore.hp -= dps * dt;
      let m = this.dmg.get(ore.id); if (!m) { m = new Map(); this.dmg.set(ore.id, m); }
      m.set(sessionId, (m.get(sessionId) ?? 0) + dealt);
      if (ore.hp <= 0) this.resolveOre(ore);
    });
  }

  // --- reward: split poolPayout by each player's damage share (multi-user) ---
  private resolveOre(ore: OreState): void {
    const contrib = this.dmg.get(ore.id);
    const payout = poolPayout(this.state.pool);
    if (contrib) {
      for (const [sessionId, d] of contrib) {
        const reward = Math.min(this.state.pool, Math.round(payout * (d / ore.maxHp)));
        if (reward <= 0) continue;
        this.state.pool -= reward;
        const p = this.state.players.get(sessionId);
        if (p) p.coins += reward; // TODO(DB): persist balance + pool transactionally
      }
    }
    this.dmg.delete(ore.id);
    this.state.ores.delete(String(ore.id));
    this.oreOrder = this.oreOrder.filter((id) => id !== ore.id);
    this.state.players.forEach((p) => { if (p.miningOreId === ore.id) p.miningOreId = 0; });
  }
}
