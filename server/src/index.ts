import "dotenv/config";
import { createServer } from "http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MineRoom } from "./rooms/MineRoom";

const port = Number(process.env.PORT ?? 2567);

const httpServer = createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok"); return; }
  res.writeHead(404); res.end();
});

const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define("mine", MineRoom);

gameServer.listen(port);
console.log(`HASHROCK authoritative server → ws://localhost:${port}  (room: "mine")`);
