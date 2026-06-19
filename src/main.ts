import { Application } from "pixi.js";
import { World } from "./world";
import { connect } from "./net";
import { getPhantom, connectPhantom, disconnectPhantom } from "./wallet";
import { signAndSend } from "./purchase";
import { SKINS, AXES, RARITY_COLOR, type Cosmetic } from "../shared/items";
import { loadGroundTiles, loadCrystalFrames } from "./tiles";
import { loadPlayerAnims } from "./player";
import { loadProps } from "./props";

const UPGRADE_COST = 5000; // mirror of server (DEMO sink)
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
    loadGroundTiles(), loadCrystalFrames(), loadPlayerAnims(), loadProps(),
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

  // ---- HUD render (authoritative state) ----
  const upgradeBtn = $("upgrade") as HTMLButtonElement;
  const render = () => {
    $("coins").textContent = fmt(world.coins);
    $("treasury").textContent = fmt(world.treasury);
    $("count").textContent = `${world.oreCount}/${world.cap}`;
    $("pcoins").textContent = fmt(world.coins);
    if ($("profileModal").classList.contains("show")) buildPickers();
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
  // Upgrade will branch into axe / character / speed later; for now it runs the demo sink.
  upgradeBtn.addEventListener("click", () => {
    if (world.coins < UPGRADE_COST) { toast(`Need ${fmt(UPGRADE_COST)} coins to upgrade`); return; }
    world.upgrade();
    toast("⚒ Upgraded (demo sink → 95% pool / 5% creator)");
  });
  $("marketplace").addEventListener("click", () => toast("🛒 Marketplace — planned"));
  $("otc").addEventListener("click", () => toast("🤝 OTC Market — planned"));

  // ---- modal helpers ----
  const showModal = (id: string) => $(id).classList.add("show");
  const closeModal = (id: string) => $(id).classList.remove("show");
  for (const id of ["profileModal", "redeemModal"]) {
    $(id).addEventListener("click", (e) => { if (e.target === $(id)) closeModal(id); });
  }
  $("profileClose").addEventListener("click", () => closeModal("profileModal"));
  $("redeemClose").addEventListener("click", () => closeModal("redeemModal"));

  // ---- cosmetic / axe pickers (rebuilt from authoritative state) ----
  const cosChip = (it: Cosmetic, sel: boolean, onpick: () => void): HTMLElement => {
    const c = document.createElement("div");
    c.className = "chip" + (sel ? " sel" : "");
    c.style.borderColor = sel ? "#ffd23f" : RARITY_COLOR[it.rarity];
    c.title = it.rarity;
    const hex = "#" + (it.color >>> 0).toString(16).padStart(6, "0");
    c.innerHTML = `<span class="dot" style="background:${it.color ? hex : "transparent"};border:1px solid #555"></span>${it.name}`;
    c.onclick = onpick;
    return c;
  };
  const fillCos = (elId: string, list: Cosmetic[], cur: number, msg: string, key: string) => {
    const el = $(elId); el.innerHTML = "";
    list.forEach((it) => el.appendChild(cosChip(it, cur === it.id, () => net!.room.send(msg, { [key]: it.id }))));
  };
  function buildPickers(): void {
    fillCos("skinpicker", SKINS, world.skin, "setSkin", "skin");
    const ap = $("axepicker"); ap.innerHTML = "";
    AXES.forEach((a) => {
      const owned = a.id <= world.axeOwned;
      const c = document.createElement("div");
      c.className = "chip" + (world.axe === a.id ? " sel" : "");
      const label = owned ? `${a.name} · ${a.mult}×` : `${a.name} · ${a.mult}× · buy ${fmt(a.price)}`;
      c.innerHTML = `<span class="dot" style="background:${a.color}"></span>${label}`;
      c.onclick = () => net!.room.send(owned ? "setAxe" : "buildAxePurchase", { axe: a.id });
      ap.appendChild(c);
    });
  }

  // ---- on-chain message handlers ----
  net.room.onMessage("hashrock", (m: { amount: number }) => { $("phashrock").textContent = fmt(m.amount); });
  net.room.onMessage("walletErr", (m: { msg: string }) => toast("⚠ " + m.msg));
  net.room.onMessage("nameSet", (m: { name: string }) => toast(`✅ username set: ${m.name}`));
  net.room.onMessage("redeemOk", (m: { amount: number; url: string }) => { toast(`✅ redeemed ${fmt(m.amount)} $HASHROCK`); window.open(m.url, "_blank"); closeModal("redeemModal"); });
  net.room.onMessage("redeemErr", (m: { msg: string }) => toast("⚠ redeem: " + m.msg));

  // on-chain purchase (axe): server builds tx → wallet signs+sends → server verifies + grants
  net.room.onMessage("purchaseTx", async (m: { axe: number; price: number; tx: string }) => {
    try {
      toast("approve the payment in your wallet…");
      const sig = await signAndSend(m.tx);
      toast("verifying purchase on-chain…");
      net!.room.send("confirmAxePurchase", { axe: m.axe, sig });
    } catch (e) { toast("purchase cancelled"); console.error(e); }
  });
  net.room.onMessage("buyOk", (m: { axe: number; url: string }) => { toast(`✅ bought ${AXES[m.axe]?.name} axe`); window.open(m.url, "_blank"); buildPickers(); });
  net.room.onMessage("buyErr", (m: { msg: string }) => toast("⚠ " + m.msg));

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
  $("redeembtn").addEventListener("click", () => {
    $("rcoins").textContent = fmt(world.coins);
    ($("redeemamount") as HTMLInputElement).value = "";
    closeModal("profileModal"); showModal("redeemModal");
  });
  $("redeemconfirm").addEventListener("click", () => {
    const amt = Math.floor(Number(($("redeemamount") as HTMLInputElement).value));
    if (amt > 0) net!.room.send("redeem", { amount: amt });
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
