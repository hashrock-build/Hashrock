import "dotenv/config";
import { createServer } from "http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MineRoom, liveStats } from "./rooms/MineRoom";
import { issueNonce } from "./nonce";
import * as db from "./db";
import * as chain from "./chain";

const port = Number(process.env.PORT ?? 2567);
const POOL_SEED = Number(process.env.POOL_SEED ?? 100_000_000);

// Ensure the economy schema exists + is seeded before accepting connections.
await db.initSchema(POOL_SEED);
const eco = await db.getEconomy();
console.log(`DB ready · pool ${eco.pool.toLocaleString()} · treasury ${eco.treasury.toLocaleString()}`);

await chain.initChain();
console.log(`Chain ready · $HASHROCK ${chain.mintAddress()} · treasury ${chain.treasuryAddress()}`);

chain.startBlockhashRelayer(); // ore spawns derive position from the latest Solana blockhash
console.log(`Blockhash relayer started (${process.env.SOLANA_CLUSTER || "devnet"})`);

const httpServer = createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok"); return; }
  if (req.url === "/stats") { // live landing-page stats (CORS-open, public, read-only)
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ online: liveStats.online, ore: liveStats.ore, mint: chain.mintAddress() }));
    return;
  }
  if (req.url === "/nonce") { // one-time login nonce (replay protection for wallet sign-in)
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ nonce: issueNonce() }));
    return;
  }
  res.writeHead(404); res.end();
});

const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define("mine", MineRoom);                       // village zone (default)
gameServer.define("cave", MineRoom, { zone: "cave" });     // M5 cave/dungeon zone
gameServer.define("forge", MineRoom, { zone: "forge" });   // M5 forge/volcanic zone (VIP tier)

gameServer.listen(port);
console.log(`HASHROCK authoritative server → ws://localhost:${port}  (rooms: "mine", "cave", "forge")`);
