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
import { SKINS, HAIRS, HATS, AXES, axeMult, axePrice, skinPrice } from "../../../shared/items";

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
const DUR_PER_ORE = 2;     // axe durability lost per ore fully mined
const DUR_PENALTY = 0.35;  // throughput multiplier when durability hits 0
const REPAIR_COST = 3000;  // $HASHROCK to fully repair (sink → 95% pool / 5% creator)
const REWARD_RATE = DAILY_EMISSION / ORE_PER_DAY;
const MINE_RANGE = TILE * 1.6;
const MOVE_SPEED = 130; // px/s — server validates client moves against this (+ tolerance)
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
  private blocked!: Uint8Array;              // collision map (anti-cheat: reject moves into walls)
  private lastMoveAt = new Map<string, number>(); // sessionId -> last move ms (speed check)
  private pid = new Map<string, string>();   // sessionId -> persistent playerId
  private wallet = new Map<string, string>(); // sessionId -> Solana address (for redeem)
  private dmg = new Map<number, Map<string, number>>(); // oreId -> (sessionId -> damage)
  private seenDeposits = new Set<string>(); // tx sigs already processed by the deposit watcher

  async onCreate(): Promise<void> {
    this.setState(new MineState());
    await db.initSchema(POOL_SEED);
    const eco = await db.getEconomy();
    this.state.pool = eco.pool;
    this.state.creator = eco.creator;
    this.state.treasury = eco.treasury;
    this.state.cap = ORE_CAP;

    const village = gen.buildVillage(); // server & client share this exact map
    this.freeCells = village.freeCells;
    this.blocked = village.blocked;

    this.onMessage("move", (client, m: { x: number; y: number }) => this.onMove(client, m));
    this.onMessage("mine", (client, m: { oreId: number }) => this.onMineStart(client, m));
    this.onMessage("stopMine", (client) => { const p = this.state.players.get(client.sessionId); if (p) p.miningOreId = 0; });
    this.onMessage("upgrade", (client) => this.onUpgrade(client));
    this.onMessage("setWallet", (client, m: { address: string }) => this.onSetWallet(client, m));
    this.onMessage("setName", (client, m: { name: string }) => this.onSetName(client, m));
    this.onMessage("setBody", (client, m: { body: number }) => this.equip(client, "body", m?.body, 2));
    this.onMessage("setSkin", (client, m: { skin: number }) => this.equip(client, "skin", m?.skin, SKINS.length));
    this.onMessage("setHair", (client, m: { hair: number }) => this.equip(client, "hair", m?.hair, HAIRS.length));
    this.onMessage("setHat", (client, m: { hat: number }) => this.equip(client, "hat", m?.hat, HATS.length));
    this.onMessage("setAxe", (client, m: { axe: number }) => this.equip(client, "axe", m?.axe, AXES.length));
    this.onMessage("buildAxePurchase", (client, m: { axe: number }) => this.onBuildAxePurchase(client, m));
    this.onMessage("confirmAxePurchase", (client, m: { axe: number; sig: string }) => this.onConfirmAxePurchase(client, m));
    this.onMessage("buildSkinPurchase", (client, m: { skin: number }) => this.onBuildSkinPurchase(client, m));
    this.onMessage("confirmSkinPurchase", (client, m: { skin: number; sig: string }) => this.onConfirmSkinPurchase(client, m));
    this.onMessage("buildRepair", (client) => this.onBuildRepair(client));
    this.onMessage("confirmRepair", (client, m: { sig: string }) => this.onConfirmRepair(client, m));
    this.onMessage("getHashrock", (client) => this.sendHashrock(client));
    this.onMessage("redeem", (client, m: { amount: number }) => this.onRedeem(client, m));
    this.onMessage("deposit", (client, m: { sig: string }) => this.onDeposit(client, m));

    this.clock.setInterval(() => this.spawnOre(), SPAWN_INTERVAL);
    this.clock.setInterval(() => this.pollDeposits(), 15000); // auto-credit incoming deposits
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS);
    this.spawnOre();
  }

  async onJoin(client: Client, opts: { name?: string; playerId?: string } = {}): Promise<void> {
    const playerId = (opts.playerId || client.sessionId).slice(0, 64);
    const name = (opts.name || "miner").slice(0, 16);
    this.pid.set(client.sessionId, playerId);
    const prof = await db.ensurePlayer(playerId, name);
    const w = await db.getWallet(playerId);
    if (w) this.wallet.set(client.sessionId, w);
    const p = new PlayerState();
    const c = cellCenter(MAP_W >> 1, MAP_H >> 1);
    p.x = c.x; p.y = c.y;
    p.name = prof.name; p.coins = prof.coins;
    p.body = prof.body; p.skin = prof.skin; p.hair = prof.hair; p.hat = prof.hat; p.axe = prof.axe; p.axeOwned = prof.axeOwned;
    p.skinsOwned = prof.skinsOwned;
    p.durability = prof.durability;
    p.throughput = axeMult(prof.axe);
    this.state.players.set(client.sessionId, p);
    client.send("chainInfo", { treasury: chain.treasuryAddress(), mint: chain.mintAddress(), wallet: w ?? null });
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.pid.delete(client.sessionId);
    this.wallet.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
  }

  // --- intents (authoritative) ---
  private onMove(client: Client, m: { x: number; y: number }): void {
    const p = this.state.players.get(client.sessionId);
    if (!p || typeof m?.x !== "number" || typeof m?.y !== "number") return;
    const now = Date.now();
    const last = this.lastMoveAt.get(client.sessionId);
    this.lastMoveAt.set(client.sessionId, now);
    const dt = last === undefined ? 1 : Math.min(1, (now - last) / 1000);
    const maxDist = MOVE_SPEED * dt * 1.8 + 8; // anti-teleport: cap step to ~speed × dt
    let nx = Math.max(0, Math.min(MAP_W * TILE, m.x));
    let ny = Math.max(0, Math.min(MAP_H * TILE, m.y));
    const dx = nx - p.x, dy = ny - p.y, dist = Math.hypot(dx, dy);
    if (dist > maxDist) { nx = p.x + (dx / dist) * maxDist; ny = p.y + (dy / dist) * maxDist; }
    if (!this.blockedAt(nx, ny)) { p.x = nx; p.y = ny; } // reject moving into walls/water
    p.miningOreId = 0; // moving cancels mining (server-enforced)
  }

  private blockedAt(wx: number, wy: number): boolean {
    const gx = Math.floor(wx / TILE), gy = Math.floor(wy / TILE);
    if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return true;
    return this.blocked[gy * MAP_W + gx] === 1;
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
    this.sendHashrock(client);
  }

  private async onSetName(client: Client, m: { name: string }): Promise<void> {
    const name = (m?.name ?? "").trim().slice(0, 16);
    if (!name) return;
    const p = this.state.players.get(client.sessionId);
    if (p) p.name = name;
    await db.setName(this.pid.get(client.sessionId)!, name);
    client.send("nameSet", { name });
  }

  // Equip a cosmetic/axe slot. NOTE: free for now (demo/preview); real items are bought
  // on-chain (marketplace) later. Cosmetics are visual; axe also sets throughput.
  private equip(client: Client, slot: "body" | "skin" | "hair" | "hat" | "axe", raw: number | undefined, len: number): void {
    const v = Math.floor(raw ?? 0);
    const p = this.state.players.get(client.sessionId);
    if (!p || v < 0 || v >= len) return;
    if (slot === "axe" && v > p.axeOwned) { client.send("buyErr", { msg: "buy this axe first" }); return; }
    if (slot === "skin" && !(p.skinsOwned & (1 << v))) { client.send("buyErr", { msg: "buy this color skin first" }); return; }
    p[slot] = v;
    if (slot === "axe") p.throughput = axeMult(v);
    persist(db.setSlot(this.pid.get(client.sessionId)!, slot, v));
  }

  // On-chain axe purchase. Step 1: build the $HASHROCK transfer for the wallet to sign.
  private async onBuildAxePurchase(client: Client, m: { axe: number }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId);
    const axe = Math.floor(m?.axe ?? 0);
    if (!p) return;
    if (!dest) return void client.send("buyErr", { msg: "connect your wallet first" });
    if (axe <= 0 || axe >= AXES.length) return void client.send("buyErr", { msg: "invalid axe" });
    if (axe <= p.axeOwned) return void client.send("buyErr", { msg: "already owned — just equip it" });
    try {
      const txb64 = await chain.buildPurchaseTx(dest, axePrice(axe));
      client.send("purchaseTx", { kind: "axe", axe, price: axePrice(axe), tx: txb64 });
    } catch (e) { client.send("buyErr", { msg: "need $HASHROCK in your wallet" }); console.error("[buy]", e); }
  }

  // Step 2: the wallet signed+sent the payment → verify it hit the treasury, grant the axe,
  // route 95% pool / 5% creator (dedupe by sig).
  private async onConfirmAxePurchase(client: Client, m: { axe: number; sig: string }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId);
    const axe = Math.floor(m?.axe ?? 0), sig = (m?.sig ?? "").trim();
    if (!p || !dest || !sig || axe <= 0 || axe >= AXES.length) return void client.send("buyErr", { msg: "bad request" });
    const price = axePrice(axe);
    try {
      const dep = await chain.verifyDepositRetry(sig);
      if (!dep || dep.amount < price || dep.source !== dest) return void client.send("buyErr", { msg: "payment not verified" });
      const cut = Math.round(price * CREATOR_FEE);
      if (!(await db.persistAxeBuy(this.pid.get(client.sessionId)!, axe, price, cut, sig))) return void client.send("buyErr", { msg: "already processed" });
      p.axe = axe; p.axeOwned = Math.max(p.axeOwned, axe); p.throughput = axeMult(axe);
      this.state.pool += price - cut; this.state.creator += cut; this.state.treasury += price;
      client.send("buyOk", { axe, sig, url: chain.explorer(sig) });
      this.sendHashrock(client);
    } catch (e) { client.send("buyErr", { msg: "purchase verify failed" }); console.error("[buy]", e); }
  }

  // On-chain COLOR-SKIN purchase. Step 1: build the $HASHROCK transfer for the wallet to sign.
  private async onBuildSkinPurchase(client: Client, m: { skin: number }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId);
    const skin = Math.floor(m?.skin ?? 0);
    if (!p) return;
    if (!dest) return void client.send("buyErr", { msg: "connect your wallet first" });
    if (skin <= 0 || skin >= SKINS.length) return void client.send("buyErr", { msg: "invalid skin" });
    if (p.skinsOwned & (1 << skin)) return void client.send("buyErr", { msg: "already owned — just equip it" });
    try {
      const txb64 = await chain.buildPurchaseTx(dest, skinPrice(skin));
      client.send("purchaseTx", { kind: "skin", skin, price: skinPrice(skin), tx: txb64 });
    } catch (e) { client.send("buyErr", { msg: "need $HASHROCK in your wallet" }); console.error("[buyskin]", e); }
  }
  // Step 2: wallet paid → verify it hit the treasury, grant+equip the skin, route 95/5 (dedupe by sig).
  private async onConfirmSkinPurchase(client: Client, m: { skin: number; sig: string }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId);
    const skin = Math.floor(m?.skin ?? 0), sig = (m?.sig ?? "").trim();
    if (!p || !dest || !sig || skin <= 0 || skin >= SKINS.length) return void client.send("buyErr", { msg: "bad request" });
    const price = skinPrice(skin);
    try {
      const dep = await chain.verifyDepositRetry(sig);
      if (!dep || dep.amount < price || dep.source !== dest) return void client.send("buyErr", { msg: "payment not verified" });
      const cut = Math.round(price * CREATOR_FEE);
      if (!(await db.persistSkinBuy(this.pid.get(client.sessionId)!, skin, price, cut, sig))) return void client.send("buyErr", { msg: "already processed" });
      p.skinsOwned |= (1 << skin); p.skin = skin;
      this.state.pool += price - cut; this.state.creator += cut; this.state.treasury += price;
      client.send("skinOk", { skin, sig, url: chain.explorer(sig) });
      this.sendHashrock(client);
    } catch (e) { client.send("buyErr", { msg: "skin verify failed" }); console.error("[buyskin]", e); }
  }

  // On-chain repair (fixed cost): restore durability to 100, route 95% pool / 5% creator.
  private async onBuildRepair(client: Client): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId);
    if (!p) return;
    if (!dest) return void client.send("buyErr", { msg: "connect your wallet first" });
    if (p.durability >= 100) return void client.send("buyErr", { msg: "axe already at full durability" });
    try {
      const txb64 = await chain.buildPurchaseTx(dest, REPAIR_COST);
      client.send("purchaseTx", { kind: "repair", price: REPAIR_COST, tx: txb64 });
    } catch (e) { client.send("buyErr", { msg: "need $HASHROCK in your wallet" }); console.error("[repair]", e); }
  }
  private async onConfirmRepair(client: Client, m: { sig: string }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId);
    const sig = (m?.sig ?? "").trim();
    if (!p || !dest || !sig) return void client.send("buyErr", { msg: "bad request" });
    try {
      const dep = await chain.verifyDepositRetry(sig);
      if (!dep || dep.amount < REPAIR_COST || dep.source !== dest) return void client.send("buyErr", { msg: "payment not verified" });
      const cut = Math.round(REPAIR_COST * CREATOR_FEE);
      if (!(await db.persistRepair(this.pid.get(client.sessionId)!, REPAIR_COST, cut, sig))) return void client.send("buyErr", { msg: "already processed" });
      p.durability = 100;
      this.state.pool += REPAIR_COST - cut; this.state.creator += cut; this.state.treasury += REPAIR_COST;
      client.send("repairOk", { sig, url: chain.explorer(sig) });
      this.sendHashrock(client);
    } catch (e) { client.send("buyErr", { msg: "repair verify failed" }); console.error("[repair]", e); }
  }

  private async sendHashrock(client: Client): Promise<void> {
    const addr = this.wallet.get(client.sessionId);
    const amount = addr ? await chain.tokenBalance(addr) : 0;
    client.send("hashrock", { amount });
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
      this.sendHashrock(client); // refresh on-chain balance

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

  // Auto-watcher: poll the treasury account, credit any new $HASHROCK deposit to the
  // player whose registered wallet sent it (dedupe by signature; safe for offline players).
  private async pollDeposits(): Promise<void> {
    let sigs: string[];
    try { sigs = await chain.recentTreasurySigs(15); } catch { return; }
    for (const sig of sigs) {
      if (this.seenDeposits.has(sig)) continue;
      this.seenDeposits.add(sig);
      try {
        const dep = await chain.verifyDeposit(sig);
        if (!dep) continue;
        const playerId = await db.playerByWallet(dep.source);
        if (!playerId) continue;
        if (!(await db.persistDeposit(playerId, dep.amount, sig))) continue; // already credited
        this.state.treasury += dep.amount;
        const sid = [...this.pid.entries()].find(([, pidv]) => pidv === playerId)?.[0];
        if (sid) {
          const p = this.state.players.get(sid);
          if (p) p.coins += dep.amount;
          this.clients.find((c) => c.sessionId === sid)?.send("depositOk", { amount: dep.amount, sig, url: chain.explorer(sig) });
        }
      } catch (e) { console.error("[deposit-watch]", e); }
    }
  }

  // --- spawn (blockhash -> free cell) + FIFO ---
  private spawnOre(): void {
    if (!this.freeCells.length) return;
    // ore position is derived from the latest Solana blockhash (relayer). Fall back to a
    // local pseudo-hash only until the relayer has fetched one (startup / RPC hiccup).
    const realbh = chain.currentBlockhash();
    const blockhash = realbh || `local${Math.floor(Math.random() * 1e9).toString(16)}`;
    const id = this.nextOreId++;
    // devnet getLatestBlockhash is "sticky" (same value for ~60s), so mix in the ore id to
    // spread spawns — the blockhash is still the on-chain entropy seed, the id de-collides.
    const value = realbh ? (chain.blockhashValue(realbh) + id * 2654435761) >>> 0 : Math.floor(Math.random() * 65536);
    const cell = this.freeCells[value % this.freeCells.length];
    const ore = new OreState();
    ore.id = id;
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
      const dps = (ore.maxHp / BASE_MINE_TIME) * p.throughput * (p.durability > 0 ? 1 : DUR_PENALTY);
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
        const p = this.state.players.get(sessionId);
        const playerId = this.pid.get(sessionId);
        if (p && d > 0) { // mining wears the axe down
          p.durability = Math.max(0, p.durability - DUR_PER_ORE);
          if (playerId) persist(db.setDurability(playerId, p.durability));
        }
        const reward = Math.min(this.state.pool, Math.round(payout * (d / ore.maxHp)));
        if (reward <= 0) continue;
        this.state.pool -= reward;
        if (p) p.coins += reward;
        if (playerId) persist(db.persistReward(playerId, reward, ore.id)); // durable + audit
      }
    }
    this.dmg.delete(ore.id);
    this.state.ores.delete(String(ore.id));
    this.oreOrder = this.oreOrder.filter((id) => id !== ore.id);
    this.state.players.forEach((p) => { if (p.miningOreId === ore.id) p.miningOreId = 0; });
  }
}
