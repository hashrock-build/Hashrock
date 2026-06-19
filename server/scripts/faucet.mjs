// Devnet test faucet: transfer $HASHROCK from the treasury to a wallet, for testing.
// NOT part of the economy loop — purely a devnet convenience to fund a tester.
// Robust send: priority fee + re-broadcast loop + getSignatureStatus polling (devnet drops
// fee-less txs and the websocket confirm hangs).
//
//   run:  node scripts/faucet.mjs <destAddress> <amount>
import "dotenv/config";
import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddress, getAccount, createTransferInstruction } from "@solana/spl-token";
import fs from "fs";

const RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const mint = new PublicKey(process.env.HASHROCK_MINT);
const treasury = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(process.env.TREASURY_SECRET_PATH || "./.treasury.json", "utf8"))),
);

const dest = process.argv[2];
const amount = Math.floor(Number(process.argv[3]));
if (!dest || !(amount > 0)) { console.error("usage: node scripts/faucet.mjs <destAddress> <amount>"); process.exit(1); }
const destPk = new PublicKey(dest);

const bal = async (owner) => {
  try { return Number((await getAccount(conn, await getAssociatedTokenAddress(mint, owner))).amount); }
  catch { return 0; }
};

async function sendAndConfirm(instructions) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: treasury.publicKey, recentBlockhash: blockhash });
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 30_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }), // priority fee
      ...instructions,
    );
    tx.sign(treasury);
    const raw = tx.serialize();
    let sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    for (let i = 0; i < 16; i++) {
      const st = (await conn.getSignatureStatus(sig)).value;
      if (st?.err) throw new Error("tx failed: " + JSON.stringify(st.err));
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig;
      await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {}); // re-broadcast
      if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) break; // expired → rebuild
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(`  attempt ${attempt + 1} expired, retrying with fresh blockhash…`);
  }
  throw new Error("could not confirm after retries");
}

console.log(`RPC: ${RPC.split("?")[0]}`);
console.log(`treasury ${treasury.publicKey.toBase58()} balance: ${(await bal(treasury.publicKey)).toLocaleString()}`);
console.log(`dest     ${dest} balance BEFORE: ${(await bal(destPk)).toLocaleString()}`);

const treasuryAta = await getAssociatedTokenAddress(mint, treasury.publicKey);
const destAta = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, destPk);
const sig = await sendAndConfirm([createTransferInstruction(treasuryAta, destAta.address, treasury.publicKey, amount)]);

console.log(`\n✅ sent ${amount.toLocaleString()} $HASHROCK`);
console.log(`tx: https://solscan.io/tx/${sig}?cluster=devnet`);
console.log(`dest balance AFTER: ${(await bal(destPk)).toLocaleString()}`);
process.exit(0);
