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
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
    (window as unknown as { world: World }).world = world; // dev inspector

  const countEl = document.getElementById("count")!;
  const hashEl = document.getElementById("hash")!;
  const render = () => { countEl.textContent = `${world.ores.length}/${world.cap}`; };
  world.onChange = render;
  render();

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
