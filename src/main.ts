import { Application } from "pixi.js";
import { World } from "./world";
import { connect } from "./net";
import { getPhantom, connectPhantom, disconnectPhantom } from "./wallet";
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

  // ---- on-chain redeem + balances ($HASHROCK devnet) ----
  net.room.onMessage("hashrock", (m: { amount: number }) => { $("phashrock").textContent = fmt(m.amount); });
  net.room.onMessage("walletErr", (m: { msg: string }) => toast("⚠ " + m.msg));
  net.room.onMessage("nameSet", (m: { name: string }) => toast(`✅ username set: ${m.name}`));
  net.room.onMessage("redeemOk", (m: { amount: number; url: string }) => { toast(`✅ redeemed ${fmt(m.amount)} $HASHROCK`); window.open(m.url, "_blank"); });
  net.room.onMessage("redeemErr", (m: { msg: string }) => toast("⚠ redeem: " + m.msg));

  $("redeembtn").addEventListener("click", () => {
    const v = prompt("Redeem how many coins → $HASHROCK? (min 10, sent to your connected wallet)");
    const amt = Math.floor(Number(v));
    if (amt > 0) net!.room.send("redeem", { amount: amt });
  });
  $("savename").addEventListener("click", () => {
    const name = ($("usernameinput") as HTMLInputElement).value.trim();
    if (name) net!.room.send("setName", { name });
  });

  // ---- wallet / profile (Solana wallet: Phantom / Backpack / Solflare) ----
  const walletBtn = $("wallet"), profile = $("profile");
  const myName = (): string => (net!.room.state as { players?: { get(k: string): { name?: string } | undefined } }).players?.get(net!.room.sessionId)?.name ?? "";
  const openProfile = (addr?: string) => {
    walletBtn.classList.add("hidden");
    profile.classList.remove("hidden");
    ($("usernameinput") as HTMLInputElement).value = myName();
    if (addr) {
      $("pwallet").textContent = addr;
      net!.room.send("setWallet", { address: addr }); // auto-save the connected wallet
      net!.room.send("getHashrock");
    }
    render();
  };
  walletBtn.addEventListener("click", async () => {
    if (!getPhantom()) { toast("No Solana wallet found — install Phantom/Backpack"); return; }
    const addr = await connectPhantom(false);
    if (addr) { openProfile(addr); toast("✅ wallet connected"); }
    else toast("wallet connection cancelled");
  });
  $("disconnect").addEventListener("click", async () => {
    await disconnectPhantom();
    profile.classList.add("hidden");
    walletBtn.classList.remove("hidden");
  });
  // auto-reconnect if the user already trusted this site
  connectPhantom(true).then((addr) => { if (addr) openProfile(addr); });
}

main();
