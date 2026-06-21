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
import { consumeNonce } from "../nonce";
import * as gen from "../../../shared/mapgen";
import { SKINS, HAIRS, HATS, AXES, axePrice, skinPrice,
  AXE_MAX_LEVEL, axeLevel, setAxeLevelBits, effAxeMult, axeUpgradeCost } from "../../../shared/items";
import { vipTier } from "../../../shared/vip";

const TILE = gen.TILE;
const MAP_W = gen.MAP_W, MAP_H = gen.MAP_H;
const ORE_HP = Number(process.env.ORE_HP ?? 100);
const ORE_CAP = Number(process.env.ORE_CAP ?? 150);
const POOL_SEED = Number(process.env.POOL_SEED ?? 100_000_000);
const DAILY_EMISSION = Number(process.env.DAILY_EMISSION ?? 0.1);
const ORE_PER_DAY = Number(process.env.ORE_PER_DAY ?? 1440);
const REWARD_FLOOR = Number(process.env.REWARD_FLOOR ?? 1);
const CREATOR_FEE = Number(process.env.CREATOR_FEE ?? 0.05);
const MARKET_FEE = Number(process.env.MARKET_FEE ?? 0.05); // P2P marketplace fee (of sale price) → sink
const BASE_MINE_TIME = Number(process.env.BASE_MINE_TIME_SEC ?? 30);
const SPAWN_INTERVAL = Number(process.env.SPAWN_INTERVAL_SEC ?? 60) * 1000;
const CAVE_MIN_HOLD = Number(process.env.CAVE_MIN_HOLD ?? 100); // $HASHROCK gate to enter the cave zone
const FORGE_MIN_HOLD = Number(process.env.FORGE_MIN_HOLD ?? 500); // higher VIP tier gate for the forge
const GARDEN_MIN_HOLD = Number(process.env.GARDEN_MIN_HOLD ?? 1000); // premium gate for the garden zone
// per-zone config: $HASHROCK hold-gate (0 = open) + ore spawn interval (ms)
const ZONE_HOLD: Record<string, number> = { cave: CAVE_MIN_HOLD, forge: FORGE_MIN_HOLD, garden: GARDEN_MIN_HOLD };
const ZONE_SPAWN_MS: Record<string, number> = { cave: 30_000, forge: 20_000, garden: 15_000 }; // garden = 4× base (60s/4)
const UPGRADE_COST = 500; // DEMO sink (coins). Real upgrades = on-chain $HASHROCK (invariant #8).
const REDEEM_MIN = Number(process.env.MIN_REDEEM ?? 10);
const DUR_PER_ORE = 2;     // axe durability lost per ore fully mined
const DUR_PENALTY = 0.35;  // throughput multiplier when durability hits 0
const REPAIR_COST = Number(process.env.REPAIR_COST ?? 10); // $HASHROCK to fully repair (sink → 95% pool / 5% creator)
const REWARD_RATE = DAILY_EMISSION / ORE_PER_DAY;
const MINE_RANGE = TILE * 1.6;
const MOVE_SPEED = 130; // px/s — server validates client moves against this (+ tolerance)
const TICK_MS = 100;

const poolPayout = (pool: number) =>
  Math.min(pool, Math.max(REWARD_FLOOR, Math.floor(pool * REWARD_RATE)));
const cellCenter = (gx: number, gy: number) => ({ x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 });
const persist = (p: Promise<unknown>) => p.catch((e) => console.error("[db]", e));

// Live, lightweight stats for the landing page (read by the /stats HTTP route).
export const liveStats = { online: 0, ore: 0 };

export class MineRoom extends Room<MineState> {
  maxClients = 50;
  autoDispose = false; // single persistent world: ore keeps living across player connects
  private nextOreId = 1;
  private oreOrder: number[] = [];           // FIFO insertion order
  private freeCells: number[] = [];          // ore-spawnable cells (shared deterministic map-gen)
  private blocked!: Uint8Array;              // collision map (anti-cheat: reject moves into walls)
  private zone = "village";                  // "village" (default) or "cave" (M5 gated zone)
  private lastMoveAt = new Map<string, number>(); // sessionId -> last move ms (speed check)
  private pid = new Map<string, string>();   // sessionId -> persistent playerId
  private wallet = new Map<string, string>(); // sessionId -> Solana address (for redeem)
  private dmg = new Map<number, Map<string, number>>(); // oreId -> (sessionId -> damage)
  private seenDeposits = new Set<string>(); // tx sigs already processed by the deposit watcher

  async onCreate(options?: { zone?: string }): Promise<void> {
    this.setState(new MineState());
    // NOTE: schema is created/migrated ONCE at boot (index.ts) before the server listens. Re-running
    // the DDL here per-room caused concurrent ALTERs to deadlock when several zones spin up at once.
    const eco = await db.getEconomy();
    this.state.pool = eco.pool;
    this.state.creator = eco.creator;
    this.state.treasury = eco.treasury;
    this.state.cap = ORE_CAP;

    // zone selects which deterministic map to host; the client renders the SAME map (shared gen)
    this.zone = options?.zone === "cave" ? "cave" : options?.zone === "forge" ? "forge" : options?.zone === "garden" ? "garden" : "village";
    const map = this.zone === "cave" ? gen.buildCave() : this.zone === "forge" ? gen.buildForge() : this.zone === "garden" ? gen.buildGarden() : gen.buildVillage();
    this.freeCells = map.freeCells;
    this.blocked = map.blocked;
    console.log(`[room] zone=${this.zone} freeCells=${this.freeCells.length}`);

    this.onMessage("move", (client, m: { x: number; y: number }) => this.onMove(client, m));
    this.onMessage("mine", (client, m: { oreId: number }) => this.onMineStart(client, m));
    this.onMessage("stopMine", (client) => { const p = this.state.players.get(client.sessionId); if (p) p.miningOreId = 0; });
    this.onMessage("upgrade", (client) => this.onUpgrade(client));
    this.onMessage("setWallet", (client, m: { address: string }) => this.onSetWallet(client, m));
    this.onMessage("setName", (client, m: { name: string }) => this.onSetName(client, m));
    this.onMessage("setBody", (client, m: { body: number }) => this.equip(client, "body", m?.body, 1));
    this.onMessage("setSkin", (client, m: { skin: number }) => this.equip(client, "skin", m?.skin, SKINS.length));
    this.onMessage("setHair", (client, m: { hair: number }) => this.equip(client, "hair", m?.hair, HAIRS.length));
    this.onMessage("setHat", (client, m: { hat: number }) => this.equip(client, "hat", m?.hat, HATS.length));
    this.onMessage("setAxe", (client, m: { axe: number }) => this.equip(client, "axe", m?.axe, AXES.length));
    this.onMessage("buildAxePurchase", (client, m: { axe: number }) => this.onBuildAxePurchase(client, m));
    this.onMessage("confirmAxePurchase", (client, m: { axe: number; sig: string }) => this.onConfirmAxePurchase(client, m));
    this.onMessage("buildSkinPurchase", (client, m: { skin: number }) => this.onBuildSkinPurchase(client, m));
    this.onMessage("confirmSkinPurchase", (client, m: { skin: number; sig: string }) => this.onConfirmSkinPurchase(client, m));
    this.onMessage("buildAxeUpgrade", (client, m: { tier: number }) => this.onBuildAxeUpgrade(client, m));
    this.onMessage("confirmAxeUpgrade", (client, m: { tier: number; sig: string }) => this.onConfirmAxeUpgrade(client, m));
    this.onMessage("buildRepair", (client) => this.onBuildRepair(client));
    this.onMessage("confirmRepair", (client, m: { sig: string }) => this.onConfirmRepair(client, m));
    this.onMessage("getHashrock", (client) => this.sendHashrock(client));
    this.onMessage("redeem", (client, m: { amount: number }) => this.onRedeem(client, m));
    this.onMessage("deposit", (client, m: { sig: string }) => this.onDeposit(client, m));
    // P2P marketplace
    this.onMessage("listings", (client) => this.sendListings(client));
    this.onMessage("listItem", (client, m: { kind: string; item: number; price: number }) => this.onListItem(client, m));
    this.onMessage("cancelListing", (client, m: { id: number }) => this.onCancelListing(client, m));
    this.onMessage("buildMarketBuy", (client, m: { id: number }) => this.onBuildMarketBuy(client, m));
    this.onMessage("confirmMarketBuy", (client, m: { id: number; sig: string }) => this.onConfirmMarketBuy(client, m));

    // Pre-seed the deposit watcher with the treasury's pre-existing txs (e.g. the initial reserve
    // funding) so they can NEVER be mis-credited to a player who later registers the funding
    // wallet — only transfers that arrive while we're live count. App deposits still go through
    // onDeposit() immediately, and persistDeposit dedupes by sig regardless.
    try { (await chain.recentTreasurySigs(25)).forEach((s) => this.seenDeposits.add(s)); }
    catch { /* RPC flaky at boot — watcher still needs a registered-wallet match to credit anything */ }

    const spawnMs = ZONE_SPAWN_MS[this.zone] ?? SPAWN_INTERVAL; // gated zones spawn faster
    this.clock.setInterval(() => this.spawnOre(), spawnMs);
    this.clock.setInterval(() => this.pollDeposits(), 30000); // auto-credit incoming deposits (eased to spare the RPC quota)
    this.clock.setInterval(() => this.refreshTreasury(), 60000); // HUD treasury mirrors on-chain reserve (cached read)
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS);
    this.spawnOre();
    this.refreshTreasury();
  }

  /** HUD "Treasury" shows the REAL on-chain $HASHROCK reserve (balances UI with on-chain). */
  private async refreshTreasury(): Promise<void> {
    try { this.state.treasury = await chain.treasuryBalance(); } catch { /* keep last value */ }
  }

  async onJoin(client: Client, opts: { name?: string; playerId?: string; msg?: string; sig?: string } = {}): Promise<void> {
    // IDENTITY = the wallet address, proven by an ed25519 signature. playerId MUST be a valid
    // Solana address whose signed login message verifies — otherwise reject the join. This binds
    // every account to a wallet only its owner can sign for (no UUID accounts, no impersonation).
    const addr = (opts.playerId || "").trim();
    const msg = opts.msg || "", sig = opts.sig || "";
    if (!chain.isValidAddress(addr)) throw new Error("connect a wallet to play");
    if (!msg.includes(addr) || !chain.verifyWalletSig(addr, msg, sig)) throw new Error("wallet signature invalid");
    // the signed message ends with a server-issued one-time nonce — consume it (replay protection)
    const nonce = (msg.trim().split("\n").pop() || "").trim();
    if (!consumeNonce(nonce)) throw new Error("login expired — reconnect");

    // Only GATED zones (cave/forge) need an on-chain balance read on join. The free village must NOT
    // block login on the RPC (a throttled RPC there = stuck "loading" after connect). Village VIP tier
    // is filled in right after join when the client sends getHashrock (sendHashrock refreshes p.vip).
    const minHold = ZONE_HOLD[this.zone] ?? 0;
    let held = 0;
    if (minHold > 0) {
      held = await chain.tokenBalance(addr);
      if (held < minHold) throw new Error(`the ${this.zone} requires holding ≥${minHold} $HASHROCK (you hold ${Math.floor(held)})`);
    }

    const playerId = addr;
    const name = (opts.name || "miner").slice(0, 16);
    this.pid.set(client.sessionId, playerId);
    const prof = await db.ensurePlayer(playerId, name);
    this.wallet.set(client.sessionId, playerId); // authenticated wallet = redeem destination
    if ((await db.getWallet(playerId)) !== playerId) await db.setWallet(playerId, playerId);
    const w = playerId;
    const p = new PlayerState();
    const c = cellCenter(MAP_W >> 1, MAP_H >> 1);
    p.x = c.x; p.y = c.y;
    p.name = prof.name; p.coins = prof.coins;
    p.body = prof.body; p.skin = prof.skin; p.hair = prof.hair; p.hat = prof.hat; p.axe = prof.axe; p.axesOwned = prof.axesOwned;
    p.axeLevels = prof.axeLevels; p.skinsOwned = prof.skinsOwned;
    p.durability = prof.durability;
    p.throughput = effAxeMult(prof.axe, axeLevel(prof.axeLevels, prof.axe));
    p.vip = vipTier(held); // VIP Club tier from on-chain holdings (status/access only)
    this.state.players.set(client.sessionId, p);
    liveStats.online++;
    client.send("chainInfo", { treasury: chain.treasuryAddress(), mint: chain.mintAddress(), wallet: w ?? null });
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.pid.delete(client.sessionId);
    this.wallet.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
    liveStats.online = Math.max(0, liveStats.online - 1);
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
    // Identity = the authenticated wallet (playerId). Reject any attempt to rebind the redeem
    // destination to a different address — you can only ever redeem to the wallet you signed in with.
    if (addr !== this.pid.get(client.sessionId)) { client.send("walletErr", { msg: "redeem only to your signed-in wallet" }); return; }
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
    if (slot === "axe" && !(p.axesOwned & (1 << v))) { client.send("buyErr", { msg: "buy this axe first" }); return; }
    if (slot === "skin" && !(p.skinsOwned & (1 << v))) { client.send("buyErr", { msg: "buy this color skin first" }); return; }
    p[slot] = v;
    if (slot === "axe") p.throughput = effAxeMult(v, axeLevel(p.axeLevels, v));
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
    if (p.axesOwned & (1 << axe)) return void client.send("buyErr", { msg: "already owned — just equip it" });
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
      p.axe = axe; p.axesOwned |= (1 << axe); p.throughput = effAxeMult(axe, axeLevel(p.axeLevels, axe));
      this.state.pool += price - cut; this.state.creator += cut; this.refreshTreasury();
      client.send("buyOk", { axe, sig, url: chain.explorer(sig) });
      this.sendHashrock(client);
    } catch (e) { client.send("buyErr", { msg: "purchase verify failed" }); console.error("[buy]", e); }
  }

  // ───────── P2P marketplace (server-authoritative listings, on-chain settlement) ─────────
  private async sendListings(client: Client): Promise<void> { client.send("listings", await db.activeListings()); }
  private broadcastListings(): void { db.activeListings().then((l) => this.broadcast("listings", l)).catch(() => {}); }

  private async onListItem(client: Client, m: { kind: string; item: number; price: number }): Promise<void> {
    const playerId = this.pid.get(client.sessionId);
    if (!playerId) return;
    const kind = m?.kind === "axe" ? "axe" : "skin";
    const item = Math.floor(m?.item ?? 0), price = Math.floor(m?.price ?? 0);
    if (!(price > 0) || price > 1e9) return void client.send("marketErr", { msg: "invalid price" });
    const r = await db.createListing(playerId, kind, item, price);
    if ("err" in r) return void client.send("marketErr", { msg: r.err });
    client.send("listed", { id: r.id });
    this.broadcastListings();
  }

  private async onCancelListing(client: Client, m: { id: number }): Promise<void> {
    const playerId = this.pid.get(client.sessionId);
    if (!playerId) return;
    await db.cancelListing(Math.floor(m?.id ?? 0), playerId);
    this.broadcastListings();
  }

  // Step 1: build the buyer-signed tx (pays seller price−fee + fee to treasury, atomic).
  private async onBuildMarketBuy(client: Client, m: { id: number }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId), playerId = this.pid.get(client.sessionId);
    if (!p || !dest || !playerId) return void client.send("marketErr", { msg: "connect your wallet first" });
    const listing = await db.getActiveListing(Math.floor(m?.id ?? 0));
    if (!listing) return void client.send("marketErr", { msg: "listing no longer available" });
    if (listing.sellerId === playerId) return void client.send("marketErr", { msg: "that's your own listing" });
    const owned = listing.kind === "axe" ? p.axesOwned : p.skinsOwned;
    if (owned & (1 << listing.item)) return void client.send("marketErr", { msg: "you already own that item" });
    const fee = Math.floor(listing.price * MARKET_FEE), sellerAmount = listing.price - fee;
    try {
      const tx = await chain.buildMarketTx(dest, listing.sellerId, sellerAmount, fee);
      client.send("purchaseTx", { kind: "market", listingId: listing.id, price: listing.price, tx });
    } catch (e) { client.send("marketErr", { msg: "need $HASHROCK in your wallet" }); console.error("[market]", e); }
  }

  // Step 2: verify the confirmed tx paid seller + treasury → transfer the item + route the fee.
  private async onConfirmMarketBuy(client: Client, m: { id: number; sig: string }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId), playerId = this.pid.get(client.sessionId);
    const sig = (m?.sig ?? "").trim();
    if (!p || !dest || !playerId || !sig) return void client.send("marketErr", { msg: "bad request" });
    const listing = await db.getActiveListing(Math.floor(m?.id ?? 0));
    if (!listing) return void client.send("marketErr", { msg: "listing already sold/cancelled" });
    const fee = Math.floor(listing.price * MARKET_FEE), sellerAmount = listing.price - fee, cut = Math.round(fee * CREATOR_FEE);
    try {
      const v = await chain.verifyMarketTxRetry(sig, listing.sellerId, sellerAmount, fee);
      if (!v || v.buyer !== dest) return void client.send("marketErr", { msg: "payment not verified" });
      const r = await db.settleMarketSale(listing.id, playerId, fee, cut, sig);
      if (!r.ok) return void client.send("marketErr", { msg: r.reason || "settle failed" });
      const bit = 1 << listing.item;
      if (listing.kind === "axe") p.axesOwned |= bit; else p.skinsOwned |= bit;
      this.state.pool += fee - cut; this.state.creator += cut; this.refreshTreasury();
      // reflect the loss on the seller's live state if they're online
      const sellSid = [...this.pid.entries()].find(([, pid]) => pid === listing.sellerId)?.[0];
      if (sellSid) {
        const sp = this.state.players.get(sellSid);
        if (sp) {
          if (listing.kind === "axe") { sp.axesOwned &= ~bit; if (sp.axe === listing.item) sp.axe = 0; }
          else { sp.skinsOwned &= ~bit; if (sp.skin === listing.item) sp.skin = 0; }
        }
        this.clients.find((c) => c.sessionId === sellSid)?.send("marketSold", { kind: listing.kind, item: listing.item, price: listing.price });
      }
      client.send("marketOk", { sig, url: chain.explorer(sig), kind: listing.kind, item: listing.item });
      this.sendHashrock(client);
      this.broadcastListings();
    } catch (e) { client.send("marketErr", { msg: "purchase verify failed" }); console.error("[market]", e); }
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
      this.state.pool += price - cut; this.state.creator += cut; this.refreshTreasury();
      client.send("skinOk", { skin, sig, url: chain.explorer(sig) });
      this.sendHashrock(client);
    } catch (e) { client.send("buyErr", { msg: "skin verify failed" }); console.error("[buyskin]", e); }
  }

  // On-chain axe LEVEL upgrade. Step 1: build the $HASHROCK transfer for the wallet to sign.
  private async onBuildAxeUpgrade(client: Client, m: { tier: number }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId);
    const tier = Math.floor(m?.tier ?? 0);
    if (!p) return;
    if (!dest) return void client.send("buyErr", { msg: "connect your wallet first" });
    if (tier < 0 || tier >= AXES.length) return void client.send("buyErr", { msg: "invalid axe" });
    if (!(p.axesOwned & (1 << tier))) return void client.send("buyErr", { msg: "you don't own this axe" });
    const lvl = axeLevel(p.axeLevels, tier);
    if (lvl >= AXE_MAX_LEVEL) return void client.send("buyErr", { msg: "already max level" });
    try {
      const txb64 = await chain.buildPurchaseTx(dest, axeUpgradeCost(tier, lvl));
      client.send("purchaseTx", { kind: "upgrade", tier, price: axeUpgradeCost(tier, lvl), tx: txb64 });
    } catch (e) { client.send("buyErr", { msg: "need $HASHROCK in your wallet" }); console.error("[upgrade]", e); }
  }
  // Step 2: wallet paid → verify it hit the treasury, bump the tier's level, route 95/5 (dedupe by sig).
  private async onConfirmAxeUpgrade(client: Client, m: { tier: number; sig: string }): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    const dest = this.wallet.get(client.sessionId);
    const tier = Math.floor(m?.tier ?? 0), sig = (m?.sig ?? "").trim();
    if (!p || !dest || !sig || tier < 0 || tier >= AXES.length) return void client.send("buyErr", { msg: "bad request" });
    if (!(p.axesOwned & (1 << tier))) return void client.send("buyErr", { msg: "you don't own this axe" });
    const lvl = axeLevel(p.axeLevels, tier);
    if (lvl >= AXE_MAX_LEVEL) return void client.send("buyErr", { msg: "already max level" });
    const newLevel = lvl + 1;
    const price = axeUpgradeCost(tier, lvl);
    const packed = setAxeLevelBits(p.axeLevels, tier, newLevel);
    try {
      const dep = await chain.verifyDepositRetry(sig);
      if (!dep || dep.amount < price || dep.source !== dest) return void client.send("buyErr", { msg: "payment not verified" });
      const cut = Math.round(price * CREATOR_FEE);
      if (!(await db.persistAxeUpgrade(this.pid.get(client.sessionId)!, tier, newLevel, packed, price, cut, sig))) return void client.send("buyErr", { msg: "already processed" });
      p.axeLevels = packed;
      if (p.axe === tier) p.throughput = effAxeMult(tier, newLevel); // refresh live throughput if equipped
      this.state.pool += price - cut; this.state.creator += cut; this.refreshTreasury();
      client.send("upgradeOk", { tier, level: newLevel, sig, url: chain.explorer(sig) });
      this.sendHashrock(client);
    } catch (e) { client.send("buyErr", { msg: "upgrade verify failed" }); console.error("[upgrade]", e); }
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
      this.state.pool += REPAIR_COST - cut; this.state.creator += cut; this.refreshTreasury();
      client.send("repairOk", { sig, url: chain.explorer(sig) });
      this.sendHashrock(client);
    } catch (e) { client.send("buyErr", { msg: "repair verify failed" }); console.error("[repair]", e); }
  }

  private async sendHashrock(client: Client): Promise<void> {
    const addr = this.wallet.get(client.sessionId);
    const amount = addr ? await chain.tokenBalance(addr) : 0;
    const p = this.state.players.get(client.sessionId);
    if (p) p.vip = vipTier(amount); // refresh VIP tier whenever the balance is re-read (buy/redeem/deposit)
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
    p.coins -= amount;
    await db.persistRedeem(playerId, amount);
    try {
      const sig = await chain.redeemTo(dest, amount);
      client.send("redeemOk", { amount, sig, url: chain.explorer(sig) });
      this.sendHashrock(client); // refresh on-chain balance
      this.refreshTreasury();

    } catch (e) {
      if (e instanceof chain.TxUncertainError) {
        // tx might still land — refunding here would risk a double-pay. Keep coins burned; the
        // release either settles (player got paid) or is reconciled manually from the ledger.
        client.send("redeemErr", { msg: "redeem is taking long to confirm — do NOT retry; check your wallet shortly" });
        console.error("[redeem] UNCERTAIN — NOT refunded, reconcile manually:", playerId, amount, e);
        return;
      }
      p.coins += amount; // definitive failure (erred / blockhash expired) → no funds moved → safe to refund
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
      p.coins += dep.amount; this.refreshTreasury();
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
        this.refreshTreasury();
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
    liveStats.ore = this.state.ores.size;
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
      if (!this.wallet.has(sessionId)) { p.miningOreId = 0; return; } // no wallet bound → can't mine/earn
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
        // fractional share: round to 6 decimals (matches $HASHROCK) instead of whole coins, so two
        // miners of one ore each see their slice (e.g. 0.5 + 0.5). The pool keeps any rounding dust.
        const reward = Math.min(this.state.pool, Math.round(payout * (d / ore.maxHp) * 1e6) / 1e6);
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
