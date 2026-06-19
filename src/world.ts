// Networked client world: renders the AUTHORITATIVE server state (ore, players, pool)
// and sends intents (move / mine / upgrade). The server owns all economy + ore logic;
// this file is a renderer + input layer. The map (ground/props/collision) is generated
// locally from shared/mapgen.ts — identical to the server's, so ore lands on valid cells.
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { Room } from "colyseus.js";
import { TILE, cellCenter, facingFrom, Facing } from "./topdown";
import { clusterForHp, CRYSTAL_W, GroundTiles } from "./tiles";
import { Player, PlayerAnims } from "./player";
import { WorldProps } from "./props";
import { MAP_W, MAP_H, idx, inB, buildVillage, Village } from "./village";
import { GroundLayer } from "./ground";
import { SKINS } from "../shared/items";

const MINE_RANGE = TILE * 1.6;
const MOVE_SPEED = 130;        // px/sec (client prediction; server validates range)
const MOVE_SEND_MS = 80;       // throttle position updates to the server
const BASE_MINE_TIME = 30;     // for the local progress bar only (server is authoritative)

interface NetOre { id: number; gx: number; gy: number; hp: number; maxHp: number; blockhash: string; }
interface NetPlayer { x: number; y: number; name: string; coins: number; throughput: number; miningOreId: number; skin: number; hair: number; hat: number; axe: number; axesOwned: number; axeLevels: number; body: number; durability: number; }

export interface WorldAssets {
  groundTiles?: GroundTiles;
  crystals?: Texture[];
  playerAnims?: PlayerAnims[]; // selectable character bodies
  props?: WorldProps;
}

export class World {
  app: Application;
  scene: Container;
  entities: Container;
  decorLayer: Container;
  ground?: GroundLayer;
  village: Village;

  playerNode: Container;
  playerCtl?: Player;
  facing: Facing = "down";
  px: number;
  py: number;
  keys = new Set<string>();
  crystals?: Texture[];
  oreScale = 1;

  private room: Room;
  private cb: any; // getStateCallbacks proxy (loosely typed)
  private oreGfx = new Map<number, Container>();
  private oreBucket = new Map<number, number>();
  private others = new Map<string, { c: Container; body: Graphics; skin: number }>();
  private miningOreId: number | null = null;
  private miningBar!: Container;
  private miningBarG!: Graphics;
  private miningBarTxt!: Text;
  private nameLabel!: Text; // local player's username, floating above the head
  private lastMoveSent = 0;
  private lastSentX = -1; private lastSentY = -1;

  lastHash = "—";
  onChange?: () => void;

  constructor(app: Application, assets: WorldAssets, room: Room, cb: any) {
    this.app = app;
    this.room = room;
    this.cb = cb;
    this.crystals = assets.crystals;
    this.oreScale = assets.crystals ? TILE / CRYSTAL_W : 1;
    this.village = buildVillage(assets.props!);

    this.scene = new Container();
    this.app.stage.addChild(this.scene);

    if (assets.groundTiles) {
      this.ground = new GroundLayer(app, MAP_W, MAP_H, this.village.terrain, assets.groundTiles);
      this.scene.addChild(this.ground.container);
    }
    this.decorLayer = new Container();
    this.scene.addChild(this.decorLayer);
    this.entities = new Container();
    this.entities.sortableChildren = true;
    this.scene.addChild(this.entities);

    this.miningBar = new Container();
    this.miningBar.visible = false;
    this.miningBar.zIndex = 2e9;
    this.miningBarG = new Graphics();
    this.miningBarTxt = new Text({ text: "", style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "700", fill: "#ffffff", stroke: { color: "#1a1330", width: 3 } } });
    this.miningBarTxt.anchor.set(0.5, 1);
    this.miningBar.addChild(this.miningBarG, this.miningBarTxt);
    this.entities.addChild(this.miningBar);

    this.nameLabel = new Text({ text: "", style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "700", fill: "#ffffff", stroke: { color: "#1a1330", width: 3 } } });
    this.nameLabel.anchor.set(0.5, 1);
    this.entities.addChild(this.nameLabel);

    this.buildProps();

    const start = cellCenter(this.village.spawn.gx, this.village.spawn.gy);
    this.px = start.x; this.py = start.y;
    if (assets.playerAnims) {
      this.playerCtl = new Player(assets.playerAnims, TILE / 16);
      this.playerNode = this.playerCtl.sprite;
    } else {
      this.playerNode = this.makePlayerFallback();
    }
    this.entities.addChild(this.playerNode);

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key === " ") { e.preventDefault(); this.requestMine(); }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));

    this.subscribe();
    this.app.ticker.add(() => this.update());
  }

  // ---- HUD getters (read straight from authoritative state) ----
  // NOTE: state maps (players/ores) can be momentarily undefined before the first sync
  // patch — every accessor below is optional-chained so the first HUD render never throws.
  private get state(): any { return this.room.state; }
  get coins(): number { return this.state?.players?.get(this.room.sessionId)?.coins ?? 0; }
  get pool(): number { return this.state?.pool ?? 0; }
  get creator(): number { return this.state?.creator ?? 0; }
  get treasury(): number { return this.state?.treasury ?? 0; }
  get oreCount(): number { return this.state?.ores?.size ?? 0; }
  get cap(): number { return this.state?.cap ?? 150; }
  get skin(): number { return this.state?.players?.get(this.room.sessionId)?.skin ?? 0; }
  get hair(): number { return this.state?.players?.get(this.room.sessionId)?.hair ?? 0; }
  get hat(): number { return this.state?.players?.get(this.room.sessionId)?.hat ?? 0; }
  get axe(): number { return this.state?.players?.get(this.room.sessionId)?.axe ?? 0; }
  get axesOwned(): number { return this.state?.players?.get(this.room.sessionId)?.axesOwned ?? 1; }
  get axeLevels(): number { return this.state?.players?.get(this.room.sessionId)?.axeLevels ?? 0; }
  get skinsOwned(): number { return this.state?.players?.get(this.room.sessionId)?.skinsOwned ?? 1; }
  get body(): number { return this.state?.players?.get(this.room.sessionId)?.body ?? 0; }
  get durability(): number { return this.state?.players?.get(this.room.sessionId)?.durability ?? 100; }
  get pname(): string { return this.state?.players?.get(this.room.sessionId)?.name ?? ""; }

  upgrade(): void { this.room.send("upgrade"); }

  // ---- server state subscriptions ----
  private subscribe(): void {
    const $ = this.cb;
    $(this.state).ores.onAdd((ore: NetOre) => {
      this.addOre(ore);
      this.lastHash = `${ore.blockhash.slice(0, 6)}… → (${ore.gx}, ${ore.gy})`;
      this.onChange?.();
      $(ore).listen("hp", () => this.refreshOre(ore));
    });
    $(this.state).ores.onRemove((ore: NetOre) => { this.removeOre(ore.id); this.onChange?.(); });

    $(this.state).players.onAdd((p: NetPlayer, sid: string) => {
      if (sid === this.room.sessionId) {
        $(p).listen("coins", (v: number, prev: number) => {
          if (prev !== undefined && v > prev) this.floatText(this.px, this.py, `+${v - prev}`);
          this.onChange?.();
        });
        this.applySkin(p.skin);
        $(p).listen("skin", (v: number) => this.applySkin(v));
        this.playerCtl?.setBody(p.body);
        $(p).listen("body", (v: number) => { this.playerCtl?.setBody(v); this.applySkin(this.skin); this.onChange?.(); });
        $(p).listen("axe", () => this.onChange?.());
      } else {
        this.addOther(sid, p);
        $(p).onChange(() => this.updateOther(sid, p));
      }
    });
    $(this.state).players.onRemove((_p: NetPlayer, sid: string) => this.removeOther(sid));

    $(this.state).listen("pool", () => this.onChange?.());
    $(this.state).listen("creator", () => this.onChange?.());
    $(this.state).listen("treasury", () => this.onChange?.());
  }

  // ---- ore rendering (driven by server) ----
  private addOre(ore: NetOre): void {
    const g = this.makeOreNode(ore);
    const c = cellCenter(ore.gx, ore.gy);
    g.x = c.x; g.y = c.y; g.zIndex = c.y;
    this.entities.addChild(g);
    this.oreGfx.set(ore.id, g);
    this.oreBucket.set(ore.id, 12);
  }
  private refreshOre(ore: NetOre): void {
    if (!this.crystals || ore.hp <= 0) return;
    const bucket = Math.ceil((ore.hp / ore.maxHp) * 12);
    const g = this.oreGfx.get(ore.id);
    if (g instanceof Container && bucket !== this.oreBucket.get(ore.id)) {
      this.oreBucket.set(ore.id, bucket);
      this.fillCluster(g, ore.hp, ore.maxHp);
    }
  }
  private removeOre(id: number): void {
    this.oreGfx.get(id)?.destroy(); this.oreGfx.delete(id); this.oreBucket.delete(id);
    if (this.miningOreId === id) this.miningOreId = null;
  }

  // ---- other players (simple avatars, outfit-tinted) ----
  private addOther(sid: string, p: NetPlayer): void {
    const c = new Container();
    const body = new Graphics();
    body.ellipse(0, TILE * 0.42, TILE * 0.3, TILE * 0.15).fill({ color: 0x000000, alpha: 0.2 });
    body.roundRect(-TILE * 0.26, -TILE * 0.42, TILE * 0.52, TILE * 0.66, 5).fill(0xc06b4a);
    body.circle(0, -TILE * 0.42, TILE * 0.24).fill(0xf2c89a);
    body.tint = SKINS[p.skin]?.color ?? 0xffffff;
    const name = new Text({ text: p.name, style: { fontFamily: "system-ui, sans-serif", fontSize: 10, fill: "#fff", stroke: { color: "#1a1330", width: 3 } } });
    name.anchor.set(0.5, 1); name.y = -TILE * 0.7;
    c.addChild(body, name);
    c.x = p.x; c.y = p.y; c.zIndex = p.y;
    this.entities.addChild(c);
    this.others.set(sid, { c, body, skin: p.skin });
  }
  private updateOther(sid: string, p: NetPlayer): void {
    const o = this.others.get(sid);
    if (!o) return;
    o.c.x = p.x; o.c.y = p.y; o.c.zIndex = p.y;
    if (p.skin !== o.skin) { o.body.tint = SKINS[p.skin]?.color ?? 0xffffff; o.skin = p.skin; }
  }
  private applySkin(skinId: number): void {
    const tint = SKINS[skinId]?.color ?? 0xffffff;
    if (this.playerCtl) this.playerCtl.sprite.tint = tint; // tint body only, not cosmetics
    else this.playerNode.tint = tint;
  }
  private removeOther(sid: string): void { this.others.get(sid)?.c.destroy(); this.others.delete(sid); }

  // ---- props / map (client-rendered from shared gen) ----
  private buildProps(): void {
    for (const p of this.village.props) {
      const s = new Sprite(p.def.texture);
      s.anchor.set(p.def.anchorX, p.def.anchorY); s.scale.set(p.def.scale); s.roundPixels = true;
      s.x = (p.gx + p.def.footW / 2) * TILE; s.y = (p.gy + p.def.footH) * TILE; s.zIndex = s.y;
      this.entities.addChild(s);
    }
    for (const d of this.village.decor) {
      const s = new Sprite(d.def.texture);
      s.anchor.set(d.def.anchorX, d.def.anchorY); s.scale.set(d.def.scale); s.roundPixels = true;
      s.x = (d.gx + 0.5) * TILE; s.y = (d.gy + 1) * TILE;
      this.decorLayer.addChild(s);
    }
  }
  private blockedAt(worldX: number, worldY: number): boolean {
    const gx = Math.floor(worldX / TILE), gy = Math.floor(worldY / TILE);
    if (!inB(gx, gy)) return true;
    return this.village.blocked[idx(gx, gy)] === 1;
  }

  private makePlayerFallback(): Graphics { const g = new Graphics(); this.drawPlayer(g); return g; }
  private drawPlayer(g: Graphics): void {
    g.clear();
    g.ellipse(0, TILE * 0.42, TILE * 0.32, TILE * 0.16).fill({ color: 0x000000, alpha: 0.2 });
    g.roundRect(-TILE * 0.28, -TILE * 0.45, TILE * 0.56, TILE * 0.7, 5).fill(0x4a73c8);
    g.circle(0, -TILE * 0.45, TILE * 0.26).fill(0xf2c89a);
    const m: Record<Facing, [number, number]> = { down: [0, -TILE * 0.38], up: [0, -TILE * 0.6], left: [-TILE * 0.16, -TILE * 0.45], right: [TILE * 0.16, -TILE * 0.45] };
    const [mx, my] = m[this.facing];
    g.circle(mx, my, 2.5).fill(0x1a1330);
  }

  private makeOreNode(ore: NetOre): Container {
    if (this.crystals) { const c = new Container(); c.sortableChildren = true; this.fillCluster(c, ore.hp, ore.maxHp); return c; }
    const g = new Graphics();
    g.ellipse(0, TILE * 0.3, TILE * 0.34, TILE * 0.16).fill({ color: 0x42c8e8, alpha: 0.25 });
    g.poly([0, -TILE * 0.5, -TILE * 0.26, -TILE * 0.05, 0, TILE * 0.15]).fill(0x8fe4f5);
    g.poly([0, -TILE * 0.5, TILE * 0.26, -TILE * 0.05, 0, TILE * 0.15]).fill(0x3aa6d8);
    g.poly([0, -TILE * 0.5, -TILE * 0.26, -TILE * 0.05, TILE * 0.26, -TILE * 0.05]).fill(0xc9f3ff);
    return g as unknown as Container;
  }
  private fillCluster(c: Container, hp: number, maxHp: number): void {
    for (const ch of c.removeChildren()) ch.destroy();
    const frames = this.crystals!;
    for (const sh of clusterForHp(hp, maxHp)) {
      const s = new Sprite(frames[sh.frame]);
      s.anchor.set(0.5, 0.92); s.scale.set(this.oreScale);
      if (sh.flip) s.scale.x = -this.oreScale;
      s.x = sh.dx * this.oreScale; s.y = sh.dy * this.oreScale; s.zIndex = sh.dy; s.roundPixels = true;
      c.addChild(s);
    }
  }

  private floatText(wx: number, wy: number, msg: string): void {
    const t = new Text({ text: msg, style: { fontFamily: "system-ui, sans-serif", fontSize: 16, fontWeight: "700", fill: "#ffd23f", stroke: { color: "#1a1330", width: 4 } } });
    t.anchor.set(0.5, 1); t.x = wx; t.y = wy - TILE * 0.6; t.zIndex = 1e9;
    this.entities.addChild(t);
    let life = 0;
    const tick = (ticker: { deltaMS: number }) => {
      life += ticker.deltaMS; t.y -= ticker.deltaMS * 0.03; t.alpha = Math.max(0, 1 - life / 900);
      if (life >= 900) { this.app.ticker.remove(tick); t.destroy(); }
    };
    this.app.ticker.add(tick);
  }

  // ---- intents ----
  private requestMine(): void {
    if (this.miningOreId != null) return;
    const ore = this.nearestOre();
    if (ore) {
      this.miningOreId = ore.id;
      // sync our exact position FIRST so the server's range check uses where we actually
      // are (move clears mining server-side, so it must precede the mine intent)
      this.room.send("move", { x: this.px, y: this.py });
      this.room.send("mine", { oreId: ore.id });
    }
  }
  private nearestOre(): NetOre | undefined {
    let best: NetOre | undefined, bestD = Infinity;
    this.state?.ores?.forEach((o: NetOre) => {
      const c = cellCenter(o.gx, o.gy);
      const d = Math.hypot(c.x - this.px, c.y - this.py);
      if (d < MINE_RANGE && d < bestD) { best = o; bestD = d; }
    });
    return best;
  }

  private setMiningBar(ore?: NetOre): void {
    if (!ore) { this.miningBar.visible = false; return; }
    const me = this.state?.players?.get(this.room.sessionId) as NetPlayer | undefined;
    const thr = me?.throughput ?? 1;
    const w = TILE, h = 5;
    const prog = 1 - Math.max(0, ore.hp) / ore.maxHp;
    const remain = (Math.max(0, ore.hp) / ore.maxHp) * BASE_MINE_TIME / thr;
    this.miningBarG.clear();
    this.miningBarG.roundRect(-w / 2, 0, w, h, 2).fill({ color: 0x1a1330, alpha: 0.85 });
    this.miningBarG.roundRect(-w / 2, 0, w * prog, h, 2).fill(0xffd23f);
    this.miningBarTxt.text = `${remain.toFixed(1)}s`;
    this.miningBarTxt.y = -1;
    this.miningBar.x = this.px; this.miningBar.y = this.py + TILE * 0.45;
    this.miningBar.visible = true;
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
      const dx = (vx / len) * MOVE_SPEED * dt, dy = (vy / len) * MOVE_SPEED * dt;
      if (!this.blockedAt(this.px + dx, this.py)) this.px += dx;
      if (!this.blockedAt(this.px, this.py + dy)) this.py += dy;
      this.facing = facingFrom(vx, vy, this.facing);
    }
    const maxX = MAP_W * TILE, maxY = MAP_H * TILE;
    this.px = Math.max(TILE * 0.5, Math.min(maxX - TILE * 0.5, this.px));
    this.py = Math.max(TILE * 0.5, Math.min(maxY - TILE * 0.5, this.py));

    // mining: server is authoritative; client shows progress + cancels on move
    if (moving && this.miningOreId != null) { this.miningOreId = null; this.room.send("stopMine"); }
    let mineActive = false;
    if (this.miningOreId != null) {
      const ore = this.state?.ores?.get(String(this.miningOreId)) as NetOre | undefined;
      if (!ore) { this.miningOreId = null; }
      else {
        const c = cellCenter(ore.gx, ore.gy);
        if (Math.hypot(c.x - this.px, c.y - this.py) >= MINE_RANGE) { this.miningOreId = null; this.room.send("stopMine"); }
        else { mineActive = true; this.facing = facingFrom(c.x - this.px, c.y - this.py, this.facing); this.setMiningBar(ore); }
      }
    }
    if (!mineActive) this.setMiningBar(undefined);

    if (this.playerCtl) this.playerCtl.update(this.facing, moving, mineActive);
    else this.drawPlayer(this.playerNode as Graphics);
    this.playerNode.x = this.px; this.playerNode.y = this.py; this.playerNode.zIndex = this.py;
    // username floating above the local player
    const nm = this.pname;
    if (this.nameLabel.text !== nm) this.nameLabel.text = nm;
    this.nameLabel.x = this.px; this.nameLabel.y = this.py - TILE * 2.1; this.nameLabel.zIndex = this.py + 0.5;
    // (no overlay pickaxe — the character's mining animation already swings one)


    // throttled position send — ONLY while moving (a "move" msg cancels mining server-side,
    // so we must not send it while standing & mining). Resting pos is ~1 frame off, well
    // within MINE_RANGE, so the server validates mining fine from the last moving update.
    const now = performance.now();
    if (moving && now - this.lastMoveSent > MOVE_SEND_MS && (this.px !== this.lastSentX || this.py !== this.lastSentY)) {
      this.room.send("move", { x: this.px, y: this.py });
      this.lastSentX = this.px; this.lastSentY = this.py; this.lastMoveSent = now;
    }

    // camera follow, clamped to map bounds
    const minX = Math.min(0, this.app.screen.width - MAP_W * TILE);
    const minY = Math.min(0, this.app.screen.height - MAP_H * TILE);
    this.scene.x = Math.round(Math.max(minX, Math.min(0, this.app.screen.width / 2 - this.px)));
    this.scene.y = Math.round(Math.max(minY, Math.min(0, this.app.screen.height / 2 - this.py)));
  }
}
