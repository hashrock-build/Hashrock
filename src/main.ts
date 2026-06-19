import { Application } from "pixi.js";
import { World } from "./world";
import { connect } from "./net";
import { getPhantom, connectPhantom, disconnectPhantom } from "./wallet";
import { signAndSend } from "./purchase";
import { CHARACTERS } from "./player";
import { CharacterPreview } from "./preview";
import { SKINS, AXES, RARITY_COLOR } from "../shared/items";
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

async function main(): Promise<void> {
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
    return;
  }

  const world = new World(app, { groundTiles, crystals, playerAnims, props }, net.room, net.$);
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
  // Upgrade: popup to pick an item (axe) and see current-vs-next level stats, then buy/equip.
  let upSel = "axe"; // selected item to upgrade (only axe for now)
  const buildUpgrade = () => {
    const items = $("upItems"); items.innerHTML = "";
    [{ key: "axe", label: "⛏ Axe" }].forEach((it) => {
      const c = document.createElement("div");
      c.className = "chip" + (upSel === it.key ? " sel" : "");
      c.textContent = it.label;
      c.onclick = () => { upSel = it.key; buildUpgrade(); };
      items.appendChild(c);
    });
    const cur = AXES[world.axe] ?? AXES[0];
    const nxt = AXES[world.axe + 1]; // the next tier up from what's equipped
    const stats = $("upStats");
    const curCol =
      `<div class="upcol"><div class="lbl">current</div>` +
      `<div class="tier"><img src="/assets/axes/axe_${cur.id}.png">${cur.name}</div>` +
      `<div class="srow">mining <span>${cur.mult}×</span></div>` +
      `<div class="srow">durability <span>${world.durability}%</span></div>` +
      `<div class="srow">tier <span>${cur.id + 1}/${AXES.length}</span></div></div>`;
    const upBtn = $("upAction") as HTMLButtonElement;
    if (!nxt) {
      stats.innerHTML = `<div class="upcols">${curCol}</div>`;
      upBtn.textContent = "Max tier reached"; upBtn.disabled = true; upBtn.onclick = null;
    } else {
      const owned = (world.axesOwned & (1 << nxt.id)) !== 0;
      const gain = `+${Math.round((nxt.mult / cur.mult - 1) * 100)}% mining`;
      stats.innerHTML =
        `<div class="upcols">${curCol}<div class="uparrow">→</div>` +
        `<div class="upcol next"><div class="lbl">after upgrade</div>` +
        `<div class="tier"><img src="/assets/axes/axe_${nxt.id}.png">${nxt.name}</div>` +
        `<div class="srow">mining <span>${nxt.mult}× <span style="color:#8ef5a8">(${gain})</span></span></div>` +
        `<div class="srow">durability <span>100%</span></div>` +
        `<div class="srow">tier <span>${nxt.id + 1}/${AXES.length}</span></div></div></div>`;
      upBtn.disabled = false;
      upBtn.textContent = owned ? `Equip ${nxt.name}` : `Upgrade to ${nxt.name} — ${fmt(nxt.price)} $HASHROCK`;
      upBtn.onclick = () => net!.room.send(owned ? "setAxe" : "buildAxePurchase", { axe: nxt.id });
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
      const label = owned ? `${a.name} · ${a.mult}×` : `${a.name} · ${a.mult}× · buy ${fmt(a.price)}`;
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
  net.room.onMessage("purchaseTx", async (m: { kind: string; axe?: number; skin?: number; price: number; tx: string }) => {
    try {
      toast("approve the payment in your wallet…");
      const sig = await signAndSend(m.tx);
      toast("verifying on-chain…");
      if (m.kind === "repair") net!.room.send("confirmRepair", { sig });
      else if (m.kind === "skin") net!.room.send("confirmSkinPurchase", { skin: m.skin, sig });
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

main();
