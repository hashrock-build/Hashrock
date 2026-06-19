import { Application } from "pixi.js";
import { World } from "./world";
import { connect } from "./net";
import { loadGroundTiles, loadCrystalFrames } from "./tiles";
import { loadPlayerAnims } from "./player";
import { loadProps } from "./props";

const UPGRADE_COST = 5000; // mirror of server (DEMO sink)

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ background: "#3a5a2a", resizeTo: window, antialias: false });
  document.getElementById("game")!.appendChild(app.canvas);

  const [groundTiles, crystals, playerAnims, props] = await Promise.all([
    loadGroundTiles(), loadCrystalFrames(), loadPlayerAnims(), loadProps(),
  ]);

  const hashEl = document.getElementById("hash")!;
  let net;
  try {
    net = await connect();
  } catch (e) {
    hashEl.textContent = "⚠ server offline — start it: npm --prefix server run dev";
    console.error("[net] failed to connect", e);
    return;
  }

  const world = new World(app, { groundTiles, crystals, playerAnims, props }, net.room, net.$);
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
    (window as unknown as { world: World }).world = world; // dev inspector

  const countEl = document.getElementById("count")!;
  const coinsEl = document.getElementById("coins")!;
  const poolEl = document.getElementById("pool")!;
  const treasuryEl = document.getElementById("treasury")!;
  const creatorEl = document.getElementById("creator")!;
  const upgradeBtn = document.getElementById("upgrade") as HTMLButtonElement;
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

  const render = () => {
    countEl.textContent = `${world.oreCount}/${world.cap}`;
    coinsEl.textContent = fmt(world.coins);
    poolEl.textContent = fmt(world.pool);
    treasuryEl.textContent = fmt(world.treasury);
    creatorEl.textContent = fmt(world.creator);
    hashEl.textContent = world.lastHash;
    upgradeBtn.textContent = `⚒ Upgrade −${fmt(UPGRADE_COST)}`;
    upgradeBtn.disabled = world.coins < UPGRADE_COST;
  };
  world.onChange = render;
  render();

  upgradeBtn.addEventListener("click", () => world.upgrade());
}

main();
