import { Application } from "pixi.js";
import { World } from "./world";
import { connect, roomStats } from "./net";
import { getPhantom, connectPhantom, disconnectPhantom } from "./wallet";
import { signAndSend } from "./purchase";
import { CHARACTERS } from "./player";
import { CharacterPreview } from "./preview";
import { SKINS, AXES, RARITY_COLOR, AXE_MAX_LEVEL, axeLevel, effAxeMult, axeUpgradeCost } from "../shared/items";
import { loadGroundTiles, loadCrystalFrames } from "./tiles";
import { loadCharacters } from "./player";
import { loadProps } from "./props";

const $ = (id: string) => document.getElementById(id)!;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

let toastTimer: number | undefined;
function toast(msg: string): void {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 1800);
}

async function enterGame(viewOnly = false): Promise<void> {
  const app = new Application();
  await app.init({ background: "#3a5a2a", resizeTo: window, antialias: false });
  $("game").appendChild(app.canvas);

  const [groundTiles, crystals, playerAnims, props] = await Promise.all([
    loadGroundTiles(), loadCrystalFrames(), loadCharacters(), loadProps(),
  ]);

  let net;
  try {
    net = await connect();
  } catch (e) {
    toast("⚠ server offline — start: npm --prefix server run dev");
    console.error("[net] connect failed", e);
    document.body.classList.remove("playing"); // back to landing
    return;
  }

  const world = new World(app, { groundTiles, crystals, playerAnims, props }, net.room, net.$);
  world.setSpectator(viewOnly);
  if (viewOnly) {
    $("actions").style.display = "none";
    const pill = document.createElement("div");
    pill.id = "viewPill";
    pill.style.cssText = "position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:40;display:flex;gap:8px;align-items:center;background:rgba(20,18,30,.9);border:1px solid #34304e;border-radius:11px;padding:7px 12px;font-size:12px;color:#cfe0ff";
    pill.innerHTML = `👁 View only — explore the village. <button id="startPlaying" class="mini" style="margin-left:4px">⛏ Start Playing</button>`;
    document.body.appendChild(pill);
    $("startPlaying").addEventListener("click", () => { world.setSpectator(false); $("actions").style.display = ""; pill.remove(); toast("⛏ mining enabled — press Space near ore"); });
  }
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
    (window as unknown as { world: World }).world = world;

  // live character preview (shown inside Profile / Marketplace cards)
  const preview = new CharacterPreview(playerAnims);
  const updatePreview = () => preview.set(world.body, world.skin, world.axe);
  const mountPreview = (slotId: string) => preview.ready.then(() => { $(slotId).appendChild(preview.canvas); updatePreview(); });

  // ---- HUD render (authoritative state) ----
  const upgradeBtn = $("upgrade") as HTMLButtonElement;
  const render = () => {
    $("coins").textContent = fmt(world.coins);
    $("treasury").textContent = fmt(world.treasury);
    $("count").textContent = `${world.oreCount}/${world.cap}`;
    $("pcoins").textContent = fmt(world.coins);
    $("dur").textContent = String(world.durability);
    $("pdur").textContent = String(world.durability);
    if ($("profileModal").classList.contains("show")) { buildPickers(); updatePreview(); }
    if ($("marketModal").classList.contains("show")) { buildShop(); buildSkins(); updatePreview(); }
    if ($("upgradeModal").classList.contains("show")) buildUpgrade();
  };

  // ---- live event feed (comment-style: newest at bottom, oldest rises off the top) ----
  const logEl = $("feed");
  const pushFeed = (cls: string, text: string) => {
    const div = document.createElement("div");
    div.className = `e ${cls}`; div.textContent = text;
    logEl.appendChild(div);
    while (logEl.childElementCount > 6) logEl.removeChild(logEl.firstChild!);
  };
  pushFeed("e", "● connected — watching ore…"); // immediate proof the feed renders
  net.room.onMessage("ev", (m: { k: string; id?: number; hash?: string; gx?: number; gy?: number }) => {
    console.log("[ev]", m);
    if (m.k === "spawn") pushFeed("spawn", `⛏ ${(m.hash ?? "").slice(0, 6)}… → (${m.gx},${m.gy})`);
    else if (m.k === "mine") pushFeed("mine", `✅ mined #${m.id} (${m.gx},${m.gy})`);
    else if (m.k === "evict") pushFeed("evict", `✗ unmined #${m.id}`);
  });

  world.onChange = render;
  render();

  // ---- actions ----
  // Upgrade: pick an OWNED axe tier and level it up (1→10). Each level boosts mining throughput;
  // paid on-chain in $HASHROCK. Tiers themselves are bought in the Marketplace.
  let upTier = -1; // selected axe tier to level (-1 = default to equipped)
  const buildUpgrade = () => {
    const owned = AXES.filter((a) => (world.axesOwned & (1 << a.id)) !== 0);
    if (upTier < 0 || !(world.axesOwned & (1 << upTier))) upTier = world.axe; // default to equipped axe
    // item chips = each owned axe tier
    const items = $("upItems"); items.innerHTML = "";
    owned.forEach((a) => {
      const lvl = axeLevel(world.axeLevels, a.id);
      const c = document.createElement("div");
      c.className = "chip" + (upTier === a.id ? " sel" : "");
      c.innerHTML = `<img src="/assets/axes/axe_${a.id}.png" alt="">${a.name} · L${lvl}`;
      c.onclick = () => { upTier = a.id; buildUpgrade(); };
      items.appendChild(c);
    });
    const a = AXES[upTier] ?? AXES[0];
    const lvl = axeLevel(world.axeLevels, a.id);
    const atMax = lvl >= AXE_MAX_LEVEL;
    const curMult = effAxeMult(a.id, lvl);
    const stats = $("upStats");
    const curCol =
      `<div class="upcol"><div class="lbl">current · level ${lvl}/${AXE_MAX_LEVEL}</div>` +
      `<div class="tier"><img src="/assets/axes/axe_${a.id}.png">${a.name}</div>` +
      `<div class="srow">mining <span>${curMult.toFixed(2)}×</span></div>` +
      `<div class="srow">tier base <span>${a.mult}×</span></div></div>`;
    const upBtn = $("upAction") as HTMLButtonElement;
    if (atMax) {
      stats.innerHTML = `<div class="upcols">${curCol}</div>`;
      upBtn.textContent = `${a.name} is max level (${AXE_MAX_LEVEL})`; upBtn.disabled = true; upBtn.onclick = null;
    } else {
      const nextMult = effAxeMult(a.id, lvl + 1);
      const cost = axeUpgradeCost(a.id, lvl);
      const gain = `+${Math.round((nextMult / curMult - 1) * 100)}%`;
      stats.innerHTML =
        `<div class="upcols">${curCol}<div class="uparrow">→</div>` +
        `<div class="upcol next"><div class="lbl">level ${lvl + 1}/${AXE_MAX_LEVEL}</div>` +
        `<div class="tier"><img src="/assets/axes/axe_${a.id}.png">${a.name}</div>` +
        `<div class="srow">mining <span>${nextMult.toFixed(2)}× <span style="color:#8ef5a8">(${gain})</span></span></div>` +
        `<div class="srow">tier base <span>${a.mult}×</span></div></div></div>`;
      upBtn.disabled = false;
      upBtn.textContent = `Upgrade to L${lvl + 1} — ${fmt(cost)} $HASHROCK`;
      upBtn.onclick = () => net!.room.send("buildAxeUpgrade", { tier: a.id });
    }
  };
  upgradeBtn.addEventListener("click", () => { buildUpgrade(); showModal("upgradeModal"); });
  const buildShop = () => {
    const el = $("shopaxes"); el.innerHTML = "";
    AXES.forEach((a) => {
      const owned = (world.axesOwned & (1 << a.id)) !== 0;
      const row = document.createElement("div");
      row.className = "shoprow";
      row.innerHTML =
        `<img src="/assets/axes/axe_${a.id}.png" alt="">` +
        `<div class="info"><b>${a.name}</b><span class="dim">${a.mult}× mining</span></div>` +
        `<button class="${owned ? "ghost" : ""} mini">${owned ? (world.axe === a.id ? "equipped" : "equip") : "buy " + fmt(a.price)}</button>`;
      row.querySelector("button")!.addEventListener("click", () =>
        net!.room.send(owned ? "setAxe" : "buildAxePurchase", { axe: a.id }));
      el.appendChild(row);
    });
  };
  const buildSkins = () => {
    const el = $("shopskins"); el.innerHTML = "";
    SKINS.filter((s) => (s.price ?? 0) > 0).forEach((s) => {
      const owned = (world.skinsOwned & (1 << s.id)) !== 0;
      const hex = "#" + (s.color >>> 0).toString(16).padStart(6, "0");
      const row = document.createElement("div");
      row.className = "shoprow";
      row.innerHTML =
        `<span class="swatch" style="background:${hex}"></span>` +
        `<div class="info"><b>${s.name}</b><span class="dim">${s.rarity} · color skin</span></div>` +
        `<button class="${owned ? "ghost" : ""} mini">${owned ? (world.skin === s.id ? "equipped" : "equip") : "buy " + fmt(s.price ?? 0)}</button>`;
      row.querySelector("button")!.addEventListener("click", () =>
        net!.room.send(owned ? "setSkin" : "buildSkinPurchase", { skin: s.id }));
      el.appendChild(row);
    });
  };
  $("marketplace").addEventListener("click", () => { buildShop(); buildSkins(); showModal("marketModal"); mountPreview("pvMarket"); });
  $("otc").addEventListener("click", () => toast("🤝 OTC Market — planned"));

  // ---- modal helpers ----
  const showModal = (id: string) => $(id).classList.add("show");
  const closeModal = (id: string) => $(id).classList.remove("show");
  for (const id of ["profileModal", "redeemModal", "marketModal", "redeemDoneModal", "buyDoneModal", "upgradeModal"]) {
    $(id).addEventListener("click", (e) => { if (e.target === $(id)) closeModal(id); });
  }
  $("profileClose").addEventListener("click", () => closeModal("profileModal"));
  $("redeemClose").addEventListener("click", () => closeModal("redeemModal"));
  $("marketClose").addEventListener("click", () => closeModal("marketModal"));
  $("redeemDoneClose").addEventListener("click", () => closeModal("redeemDoneModal"));
  $("buyDoneClose").addEventListener("click", () => closeModal("buyDoneModal"));
  $("upgradeClose").addEventListener("click", () => closeModal("upgradeModal"));
  // generic purchase/repair success popup (card + View on Solscan; no auto-opening tabs)
  const showBuyDone = (icon: string, head: string, msg: string, url: string) => {
    $("bdIcon").textContent = icon; $("bdHead").textContent = head; $("bdMsg").textContent = msg;
    ($("bdLink") as HTMLAnchorElement).href = url;
    showModal("buyDoneModal");
  };

  // ---- cosmetic / axe pickers (rebuilt from authoritative state) ----
  const hex6 = (c: number) => "#" + (c >>> 0).toString(16).padStart(6, "0");
  function buildPickers(): void {
    const cp = $("charpicker"); cp.innerHTML = "";
    CHARACTERS.forEach((name, i) => {
      const c = document.createElement("div");
      c.className = "chip" + (world.body === i ? " sel" : "");
      c.textContent = name;
      c.onclick = () => net!.room.send("setBody", { body: i });
      cp.appendChild(c);
    });
    // color skins: owned → equip; locked → buy on-chain (🔒 price)
    const sp = $("skinpicker"); sp.innerHTML = "";
    SKINS.forEach((s) => {
      const owned = (world.skinsOwned & (1 << s.id)) !== 0;
      const sel = world.skin === s.id;
      const c = document.createElement("div");
      c.className = "chip" + (sel ? " sel" : "");
      c.style.borderColor = sel ? "#ffd23f" : RARITY_COLOR[s.rarity];
      c.title = owned ? s.rarity : `${s.rarity} — buy in marketplace`;
      c.innerHTML = `<span class="dot" style="background:${hex6(s.color)};border:1px solid #555"></span>${s.name}${owned ? "" : ` 🔒${fmt(s.price ?? 0)}`}`;
      c.onclick = () => net!.room.send(owned ? "setSkin" : "buildSkinPurchase", { skin: s.id });
      sp.appendChild(c);
    });
    const ap = $("axepicker"); ap.innerHTML = "";
    AXES.forEach((a) => {
      const owned = (world.axesOwned & (1 << a.id)) !== 0;
      const c = document.createElement("div");
      c.className = "chip" + (world.axe === a.id ? " sel" : "");
      const label = owned ? `${a.name} · L${axeLevel(world.axeLevels, a.id)} · ${effAxeMult(a.id, axeLevel(world.axeLevels, a.id)).toFixed(2)}×` : `${a.name} · ${a.mult}× · buy ${fmt(a.price)}`;
      c.innerHTML = `<img src="/assets/axes/axe_${a.id}.png" alt="">${label}`;
      c.onclick = () => net!.room.send(owned ? "setAxe" : "buildAxePurchase", { axe: a.id });
      ap.appendChild(c);
    });
  }

  // ---- on-chain message handlers ----
  net.room.onMessage("hashrock", (m: { amount: number }) => { $("phashrock").textContent = fmt(m.amount); });
  net.room.onMessage("walletErr", (m: { msg: string }) => toast("⚠ " + m.msg));
  net.room.onMessage("nameSet", (m: { name: string }) => toast(`✅ username set: ${m.name}`));
  net.room.onMessage("redeemOk", (m: { amount: number; sig: string; url: string }) => {
    closeModal("redeemModal");
    $("rdAmount").textContent = fmt(m.amount);
    ($("rdLink") as HTMLAnchorElement).href = m.url;
    ($("redeemconfirm") as HTMLButtonElement).disabled = false;
    showModal("redeemDoneModal");
  });
  net.room.onMessage("redeemErr", (m: { msg: string }) => { ($("redeemconfirm") as HTMLButtonElement).disabled = false; toast("⚠ redeem: " + m.msg); });

  // on-chain purchase (axe / color skin / repair): server builds tx → wallet signs+sends → server verifies + grants
  net.room.onMessage("purchaseTx", async (m: { kind: string; axe?: number; skin?: number; tier?: number; price: number; tx: string }) => {
    try {
      toast("approve the payment in your wallet…");
      const sig = await signAndSend(m.tx);
      toast("verifying on-chain…");
      if (m.kind === "repair") net!.room.send("confirmRepair", { sig });
      else if (m.kind === "skin") net!.room.send("confirmSkinPurchase", { skin: m.skin, sig });
      else if (m.kind === "upgrade") net!.room.send("confirmAxeUpgrade", { tier: m.tier, sig });
      else net!.room.send("confirmAxePurchase", { axe: m.axe, sig });
    } catch (e) { toast("cancelled"); console.error(e); }
  });
  net.room.onMessage("buyOk", (m: { axe: number; url: string }) => {
    buildPickers(); buildShop(); buildUpgrade();
    showBuyDone("⛏", "✅ Axe Purchased", `${AXES[m.axe]?.name} axe equipped`, m.url);
  });
  net.room.onMessage("skinOk", (m: { skin: number; url: string }) => {
    buildPickers(); buildSkins(); updatePreview();
    showBuyDone("🎨", "✅ Skin Purchased", `${SKINS[m.skin]?.name} color skin equipped`, m.url);
  });
  net.room.onMessage("upgradeOk", (m: { tier: number; level: number; url: string }) => {
    buildUpgrade(); buildPickers();
    showBuyDone("⚒", "✅ Axe Upgraded", `${AXES[m.tier]?.name} is now level ${m.level}`, m.url);
  });
  net.room.onMessage("repairOk", (m: { url: string }) => {
    buildUpgrade();
    showBuyDone("🔧", "✅ Axe Repaired", "durability restored to 100%", m.url);
  });
  net.room.onMessage("buyErr", (m: { msg: string }) => toast("⚠ " + m.msg));

  $("repair").addEventListener("click", () => {
    if (world.durability >= 100) return void toast("axe already at full durability");
    net!.room.send("buildRepair");
  });

  // ---- wallet button: Connect → (connected) Profile → opens popup ----
  const walletBtn = $("wallet") as HTMLButtonElement;
  let connected = false;
  const onConnected = (addr: string) => {
    connected = true;
    walletBtn.textContent = "👤 Profile";
    $("pwallet").textContent = addr;
    net!.room.send("setWallet", { address: addr });
    net!.room.send("getHashrock");
  };
  const openProfile = () => {
    ($("usernameinput") as HTMLInputElement).value = world.pname;
    buildPickers();
    render();
    showModal("profileModal");
    mountPreview("pvProfile");
  };
  walletBtn.addEventListener("click", async () => {
    if (connected) return openProfile();
    if (!getPhantom()) return void toast("No Solana wallet found — install Phantom/Backpack");
    const addr = await connectPhantom(false);
    if (addr) { onConnected(addr); toast("✅ wallet connected — click Profile"); }
    else toast("wallet connection cancelled");
  });

  // ---- profile actions ----
  $("savename").addEventListener("click", () => {
    const name = ($("usernameinput") as HTMLInputElement).value.trim();
    if (name) net!.room.send("setName", { name });
  });
  const openRedeem = () => {
    if (!connected) return void toast("connect your wallet first");
    $("rcoins").textContent = fmt(world.coins);
    ($("redeemamount") as HTMLInputElement).value = "";
    ($("redeemconfirm") as HTMLButtonElement).disabled = false;
    closeModal("profileModal"); showModal("redeemModal");
  };
  $("redeembtn").addEventListener("click", openRedeem);
  $("redeemAction").addEventListener("click", openRedeem);
  $("redeemconfirm").addEventListener("click", () => {
    const amt = Math.floor(Number(($("redeemamount") as HTMLInputElement).value));
    if (amt <= 0) return void toast("enter a redeem amount");
    if (amt > world.coins) return void toast("not enough coins");
    ($("redeemconfirm") as HTMLButtonElement).disabled = true; // prevent double-submit during on-chain release
    toast("releasing $HASHROCK on-chain… (devnet can take ~1–2 min)");
    net!.room.send("redeem", { amount: amt });
  });
  $("disconnect").addEventListener("click", async () => {
    await disconnectPhantom();
    connected = false;
    walletBtn.textContent = "🔗 Connect Wallet";
    closeModal("profileModal");
  });

  // auto-reconnect if already trusted (button → Profile, popup stays closed)
  connectPhantom(true).then((addr) => { if (addr) onConnected(addr); });
}

// ===== Landing / start page controller (shown first; game boots on Play/View) =====
function initLanding(): void {
  let started = false;
  const start = (viewOnly: boolean) => {
    if (started) return; started = true;
    document.body.classList.add("playing");
    enterGame(viewOnly);
  };
  $("playBtn").addEventListener("click", () => start(false));
  $("landingWallet").addEventListener("click", () => start(false));

  // sub-page nav (How to Play / Whitepaper / Docs)
  document.querySelectorAll<HTMLElement>("[data-page]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); $(a.dataset.page!).classList.add("show"); }));
  document.querySelectorAll<HTMLElement>("[data-back]").forEach((b) =>
    b.addEventListener("click", () => (b.closest(".page") as HTMLElement)?.classList.remove("show")));

  // copy CA
  $("caCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("caAddr").textContent ?? ""); toast("📋 contract address copied"); } catch { toast("copy failed"); }
  });

  // live "miners online" (lightweight /stats; refresh every 10s). CA stays "coming soon" for now.
  const refreshOnline = () => roomStats().then((s) => { $("stOnline").textContent = String(s.online); }).catch(() => {});
  refreshOnline();
  setInterval(refreshOnline, 10000);
}

initLanding();
