// Runtime proof for the M5 cave gate + 30s spawn. Signs an ed25519 login (Node crypto),
// joins the "cave" room: a 0-balance wallet must be REJECTED, the treasury wallet (holds devnet
// $HASHROCK) must JOIN; then we watch ore spawns to confirm the ~30s cadence.
import { Client } from "colyseus.js";
import { Keypair } from "@solana/web3.js";
import crypto from "crypto";
import fs from "fs";

const PORT = process.env.TPORT || "2599";
const WS = `ws://localhost:${PORT}`, HTTP = `http://localhost:${PORT}`;

const sign = (kp, msg) => {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(kp.secretKey.slice(0, 32))]);
  const key = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return crypto.sign(null, Buffer.from(msg, "utf8"), key).toString("base64");
};
const join = async (kp, label) => {
  const addr = kp.publicKey.toBase58();
  const nonce = (await (await fetch(`${HTTP}/nonce`)).json()).nonce;
  const msg = `HASHROCK login\n${addr}\n${nonce}`;
  try {
    const room = await new Client(WS).joinOrCreate("cave", { playerId: addr, name: "tester", msg, sig: sign(kp, msg) });
    console.log(`${label}: JOINED ✓`);
    return room;
  } catch (e) { console.log(`${label}: REJECTED → ${(e?.message || e?.code || e)}`); return null; }
};

console.log("— GATE —");
await join(Keypair.generate(), "random wallet (0 $HASHROCK)");
const treasury = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("server/.treasury.json"))));
const room = await join(treasury, "treasury wallet (holds devnet $HASHROCK)");

if (room) {
  console.log("— SPAWN (watching ore for 65s; cave should add one ~every 30s) —");
  const t0 = Date.now(); let last = -1;
  await new Promise((done) => {
    const iv = setInterval(() => {
      const n = room.state.ores.size, t = ((Date.now() - t0) / 1000).toFixed(0);
      if (n !== last) { console.log(`  t=${t}s  ores=${n}`); last = n; }
      if (Date.now() - t0 > 65000) { clearInterval(iv); done(); }
    }, 1000);
  });
  room.leave();
}
process.exit(0);
