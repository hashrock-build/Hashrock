import { Application } from "pixi.js";
import { World } from "./world";
import { loadGroundTiles, loadCrystalFrames } from "./tiles";
import { loadPlayerAnims } from "./player";
import { loadProps } from "./props";

async function main(): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#3a5a2a",
    resizeTo: window,
    antialias: false, // crisp pixels (set roundPixels on sprites for Pixel Crawler)
  });
  document.getElementById("game")!.appendChild(app.canvas);

  const [groundTiles, crystals, playerAnims, props] = await Promise.all([
    loadGroundTiles(),
    loadCrystalFrames(),
    loadPlayerAnims(),
    loadProps(),
  ]);
  const world = new World(app, { groundTiles, crystals, playerAnims, props });
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
    (window as unknown as { world: World }).world = world; // dev inspector

  const countEl = document.getElementById("count")!;
  const coinsEl = document.getElementById("coins")!;
  const poolEl = document.getElementById("pool")!;
  const treasuryEl = document.getElementById("treasury")!;
  const creatorEl = document.getElementById("creator")!;
  const hashEl = document.getElementById("hash")!;
  const upgradeBtn = document.getElementById("upgrade") as HTMLButtonElement;
  const UPGRADE_COST = 5000; // demo sink amount (coins)
  const fmt = (n: number) => n.toLocaleString("en-US");
  const render = () => {
    countEl.textContent = `${world.ores.length}/${world.cap}`;
    coinsEl.textContent = fmt(world.coins);
    poolEl.textContent = fmt(world.pool);
    treasuryEl.textContent = fmt(world.treasury);
    creatorEl.textContent = fmt(world.creator);
    upgradeBtn.textContent = `⚒ Upgrade −${fmt(UPGRADE_COST)}`;
    upgradeBtn.disabled = world.coins < UPGRADE_COST;
  };
  world.onChange = render;
  render();

  // DEMO sink (visualizes the 95%→pool / 5%→creator split). Production: on-chain $HASHROCK.
  upgradeBtn.addEventListener("click", () => world.payUpgrade(UPGRADE_COST));

  const spawn = () => {
    const ore = world.spawnOre();
    hashEl.textContent = `${ore.blockhash.slice(0, 6)}… → (${ore.gx}, ${ore.gy})`;
  };
  document.getElementById("spawn")!.addEventListener("click", spawn);

  // Demo: auto-spawn fast so the map fills. Real game = 1 per 30s/60s from a
  // confirmed Solana blockhash (relayer).
  setInterval(spawn, 1500);
  spawn();
}

main();
