// Authoritative mining room. The server owns ore spawn (blockhash -> free cell), the
// FIFO cap, mining validation (time-based DPS while in range & not moving), and the
// reward pool. Clients only send intents (move / mine / upgrade) and render synced state.
//
// Economy is authoritative IN-MEMORY for responsiveness and mirrored to Postgres (db.ts)
// for durability + audit (ledger). On boot the pool/treasury/creator load from the DB.
//
// Ore positions use the shared deterministic map-gen (shared/mapgen.ts) — the same module
// the client renders from — so server & client agree on every free cell.
import { Room, Client } from "colyseus";
import { MineState, OreState, PlayerState } from "./schema";
import * as db from "../db";
import * as chain from "../chain";
import * as gen from "../../../shared/mapgen";

const TILE = gen.TILE;
const MAP_W = gen.MAP_W, MAP_H = gen.MAP_H;
const ORE_HP = Number(process.env.ORE_HP ?? 100);
const ORE_CAP = Number(process.env.ORE_CAP ?? 150);
const POOL_SEED = Number(process.env.POOL_SEED ?? 100_000_000);
const DAILY_EMISSION = Number(process.env.DAILY_EMISSION ?? 0.1);
const ORE_PER_DAY = Number(process.env.ORE_PER_DAY ?? 1440);
const REWARD_FLOOR = Number(process.env.REWARD_FLOOR ?? 1);
const CREATOR_FEE = Number(process.env.CREATOR_FEE ?? 0.05);
const BASE_MINE_TIME = Number(process.env.BASE_MINE_TIME_SEC ?? 30);
const SPAWN_INTERVAL = Number(process.env.SPAWN_INTERVAL_SEC ?? 60) * 1000;
const UPGRADE_COST = 5000; // DEMO sink (coins). Real upgrades = on-chain $HASHROCK (invariant #8).
const REDEEM_MIN = Number(process.env.MIN_REDEEM ?? 10);
const REWARD_RATE = DAILY_EMISSION / ORE_PER_DAY;
const MINE_RANGE = TILE * 1.6;
const TICK_MS = 100;

const poolPayout = (pool: number) =>
  Math.min(pool, Math.max(REWARD_FLOOR, Math.floor(pool * REWARD_RATE)));
const cellCenter = (gx: number, gy: number) => ({ x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 });
const persist = (p: Promise<unknown>) => p.catch((e) => console.error("[db]", e));

export class MineRoom extends Room<MineState> {
  maxClients = 50;
  autoDispose = false; // single persistent world: ore keeps living across player connects
  private nextOreId = 1;
  private oreOrder: number[] = [];           // FIFO insertion order
  private freeCells: number[] = [];          // ore-spawnable cells (shared deterministic map-gen)
  private pid = new Map<string, string>();   // sessionId -> persistent playerId
  private wallet = new Map<string, string>(); // sessionId -> Solana address (for redeem)
  private dmg = new Map<number, Map<string, number>>(); // oreId -> (sessionId -> damage)

  async onCreate(): Promise<void> {
    this.setState(new MineState());
    await db.initSchema(POOL_SEED);
    const eco = await db.getEconomy();
    this.state.pool = eco.pool;
    this.state.creator = eco.creator;
    this.state.treasury = eco.treasury;
    this.state.cap = ORE_CAP;

    this.freeCells = gen.buildVillage().freeCells; // server & client share this exact map

    this.onMessage("move", (client, m: { x: number; y: number }) => this.onMove(client, m));
    this.onMessage("mine", (client, m: { oreId: number }) => this.onMineStart(client, m));
    this.onMessage("stopMine", (client) => { const p = this.state.players.get(client.sessionId); if (p) p.miningOreId = 0; });
    this.onMessage("upgrade", (client) => this.onUpgrade(client));
    this.onMessage("setWallet", (client, m: { address: string }) => this.onSetWallet(client, m));
    this.onMessage("redeem", (client, m: { amount: number }) => this.onRedeem(client, m));
    this.onMessage("deposit", (client, m: { sig: string }) => this.onDeposit(client, m));

    this.clock.setInterval(() => this.spawnOre(), SPAWN_INTERVAL);
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS);
    this.spawnOre();
  }

  async onJoin(client: Client, opts: { name?: string; playerId?: string } = {}): Promise<void> {
    const playerId = (opts.playerId || client.sessionId).slice(0, 64);
    const name = (opts.name || "miner").slice(0, 16);
    this.pid.set(client.sessionId, playerId);
    const coins = await db.ensurePlayer(playerId, name);
    const w = await db.getWallet(playerId);
    if (w) this.wallet.set(client.sessionId, w);
    const p = new PlayerState();
    const c = cellCenter(MAP_W >> 1, MAP_H >> 1);
    p.x = c.x; p.y = c.y; p.name = name; p.coins = coins; p.throughput = 1;
    this.state.players.set(client.sessionId, p);
    client.send("chainInfo", { treasury: chain.treasuryAddress(), mint: chain.mintAddress(), wallet: w ?? null });
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.pid.delete(client.sessionId);
    this.wallet.delete(client.sessionId);
  }

  // --- intents (authoritative) ---
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

  // DEMO sink (coins): 95% -> pool, 5% -> creator. Mirrors economy to the DB.
  private onUpgrade(client: Client): void {
    const p = this.state.players.get(client.sessionId);
    if (!p || p.coins < UPGRADE_COST) return;
    const cut = Math.round(UPGRADE_COST * CREATOR_FEE);
    p.coins -= UPGRADE_COST;
    this.state.creator += cut;
    this.state.pool += UPGRADE_COST - cut;
    persist(db.persistUpgrade(this.pid.get(client.sessionId)!, UPGRADE_COST, cut));
  }

  private async onSetWallet(client: Client, m: { address: string }): Promise<void> {
    const addr = (m?.address ?? "").trim();
    if (!chain.isValidAddress(addr)) { client.send("walletErr", { msg: "invalid Solana address" }); return; }
    this.wallet.set(client.sessionId, addr);
    await db.setWallet(this.pid.get(client.sessionId)!, addr);
    client.send("walletSet", { address: addr });
  }

  // REDEEM: burn coins (authoritative) then release $HASHROCK from treasury; refund on failure.
  private async onRedeem(client: Client, m: { amount: number }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId);
    const amount = Math.floor(m?.amount ?? 0);
    if (!p) return;
    if (!dest) return void client.send("redeemErr", { msg: "set your wallet address first" });
    if (amount < REDEEM_MIN) return void client.send("redeemErr", { msg: `min redeem is ${REDEEM_MIN}` });
    if (amount > p.coins) return void client.send("redeemErr", { msg: "not enough coins" });
    const playerId = this.pid.get(client.sessionId)!;
    p.coins -= amount; this.state.treasury -= amount;
    await db.persistRedeem(playerId, amount);
    try {
      const sig = await chain.redeemTo(dest, amount);
      client.send("redeemOk", { amount, sig, url: chain.explorer(sig) });
    } catch (e) {
      p.coins += amount; this.state.treasury += amount;
      await db.refundRedeem(playerId, amount);
      client.send("redeemErr", { msg: "on-chain transfer failed (refunded)" });
      console.error("[redeem]", e);
    }
  }

  // DEPOSIT: verify a player's $HASHROCK transfer into the treasury → mint coins 1:1.
  private async onDeposit(client: Client, m: { sig: string }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const sig = (m?.sig ?? "").trim();
    if (!p || !sig) return void client.send("depositErr", { msg: "missing tx signature" });
    try {
      const dep = await chain.verifyDeposit(sig);
      if (!dep) return void client.send("depositErr", { msg: "no $HASHROCK deposit found in that tx" });
      const ok = await db.persistDeposit(this.pid.get(client.sessionId)!, dep.amount, sig);
      if (!ok) return void client.send("depositErr", { msg: "already credited" });
      p.coins += dep.amount; this.state.treasury += dep.amount;
      client.send("depositOk", { amount: dep.amount, sig, url: chain.explorer(sig) });
    } catch (e) { client.send("depositErr", { msg: "verify failed" }); console.error("[deposit]", e); }
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
    this.broadcast("ev", { k: "spawn", id: ore.id, hash: blockhash, gx: ore.gx, gy: ore.gy });
    if (this.oreOrder.length > this.state.cap) {
      const evicted = this.oreOrder.shift()!; // FIFO: its reward stays in the pool (invariant #7)
      this.state.ores.delete(String(evicted));
      this.dmg.delete(evicted);
      this.broadcast("ev", { k: "evict", id: evicted });
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
    this.broadcast("ev", { k: "mine", id: ore.id, gx: ore.gx, gy: ore.gy });
    if (contrib) {
      for (const [sessionId, d] of contrib) {
        const reward = Math.min(this.state.pool, Math.round(payout * (d / ore.maxHp)));
        if (reward <= 0) continue;
        this.state.pool -= reward;
        const p = this.state.players.get(sessionId);
        if (p) p.coins += reward;
        const playerId = this.pid.get(sessionId);
        if (playerId) persist(db.persistReward(playerId, reward, ore.id)); // durable + audit
      }
    }
    this.dmg.delete(ore.id);
    this.state.ores.delete(String(ore.id));
    this.oreOrder = this.oreOrder.filter((id) => id !== ore.id);
    this.state.players.forEach((p) => { if (p.miningOreId === ore.id) p.miningOreId = 0; });
  }
}
