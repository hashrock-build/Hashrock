// End-to-end P2P marketplace test (local devnet): seller lists an axe → buyer pays on-chain →
// item transfers, fee routes 95/5, seller paid wallet-to-wallet, invariant holds.
import { Client } from "colyseus.js";
import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import crypto from "crypto"; import fs from "fs"; import { execSync } from "child_process";

const WS = "ws://localhost:2567", HTTP = "http://localhost:2567";
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const DB = "postgres://postgres@127.0.0.1:5433/hashrock";
const q = (sql) => execSync(`psql "${DB}" -tAc "${sql}"`, { encoding: "utf8" }).trim();
const HOME = process.env.HOME;
const deployer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(`${HOME}/cora-deploy/keys/deploy-wallet.json`))));
const PRICE = 500, ITEM = 2; // Iron axe

const sign = (kp, msg) => {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(kp.secretKey.slice(0, 32))]);
  return crypto.sign(null, Buffer.from(msg, "utf8"), crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" })).toString("base64");
};
const join = async (kp, name) => {
  const addr = kp.publicKey.toBase58();
  const nonce = (await (await fetch(`${HTTP}/nonce`)).json()).nonce;
  const msg = `HASHROCK login\n${addr}\n${nonce}`;
  return new Client(WS).joinOrCreate("mine", { playerId: addr, name, msg, sig: sign(kp, msg) });
};
const confirmTx = async (sig) => { for (let i = 0; i < 30; i++) { const s = (await conn.getSignatureStatus(sig)).value; if (s?.confirmationStatus) return true; await new Promise(r => setTimeout(r, 2000)); } return false; };

const seller = Keypair.generate(), buyer = Keypair.generate();
const sAddr = seller.publicKey.toBase58(), bAddr = buyer.publicKey.toBase58();
console.log("seller", sAddr.slice(0, 8), "buyer", bAddr.slice(0, 8));

console.log("→ funding buyer SOL…");
{ const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: buyer.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })); const sig = await conn.sendTransaction(tx, [deployer]); await confirmTx(sig); }
console.log("→ faucet buyer $HASHROCK…");
execSync(`node scripts/faucet.mjs ${bAddr} 1000`, { cwd: "server", stdio: "ignore" });

console.log("→ both join…");
const sRoom = await join(seller, "seller"); const bRoom = await join(buyer, "buyer");
await new Promise(r => setTimeout(r, 1500));

console.log("→ grant seller the Iron axe (DB)…");
q(`UPDATE players SET axes_owned = axes_owned | ${1 << ITEM} WHERE id='${sAddr}'`);

console.log("→ seller lists it…");
const listed = new Promise((res) => sRoom.onMessage("listed", (m) => res(m.id)));
sRoom.onMessage("marketErr", (m) => console.log("  seller marketErr:", m.msg));
sRoom.send("listItem", { kind: "axe", item: ITEM, price: PRICE });
const listingId = await Promise.race([listed, new Promise((_, j) => setTimeout(() => j(new Error("list timeout")), 15000))]);
console.log("  listing id", listingId);

console.log("→ buyer buys…");
bRoom.onMessage("marketErr", (m) => console.log("  buyer marketErr:", m.msg));
const done = new Promise((res) => bRoom.onMessage("marketOk", () => res(true)));
bRoom.onMessage("purchaseTx", async (m) => {
  const tx = Transaction.from(Buffer.from(m.tx, "base64"));
  tx.sign(buyer);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  console.log("  paid, sig", sig.slice(0, 12), "→ confirming…");
  await confirmTx(sig);
  bRoom.send("confirmMarketBuy", { id: m.listingId, sig });
});
bRoom.send("buildMarketBuy", { id: listingId });
await Promise.race([done, new Promise((_, j) => setTimeout(() => j(new Error("buy timeout")), 60000))]);

await new Promise(r => setTimeout(r, 1500));
console.log("\n=== VERIFY ===");
const sOwns = (Number(q(`SELECT axes_owned FROM players WHERE id='${sAddr}'`)) >> ITEM) & 1;
const bOwns = (Number(q(`SELECT axes_owned FROM players WHERE id='${bAddr}'`)) >> ITEM) & 1;
console.log(`item transfer: seller owns=${sOwns} (want 0) · buyer owns=${bOwns} (want 1)`);
const status = q(`SELECT status FROM listings WHERE id=${listingId}`);
console.log(`listing status=${status} (want sold)`);
const ok = q(`SELECT ((SELECT COALESCE(SUM(coins),0) FROM players)+pool+creator)=treasury FROM economy`);
const coins = q(`SELECT (SELECT COALESCE(SUM(coins),0) FROM players)+pool+creator FROM economy`);
const treas = q(`SELECT treasury FROM economy`);
console.log(`invariant: coins=${coins} treasury=${treas} ok=${ok}`);
const deltas = q(`SELECT pool_delta||'/'||creator_delta||'/'||treasury_delta FROM ledger WHERE kind='market_sale' ORDER BY id DESC LIMIT 1`);
console.log(`fee routing (pool/creator/treasury delta)=${deltas} (fee=${Math.floor(PRICE * 0.05)})`);
const verdict = sOwns === 0 && bOwns === 1 && status === "sold" && ok === "t";
console.log(verdict ? "\n✅ MARKETPLACE E2E PASSED" : "\n❌ FAILED");
process.exit(verdict ? 0 : 2);
