// Generate a FRESH mainnet treasury keypair → ./.treasury.mainnet.json (chmod 600, gitignored).
// Backs up any existing file first. Prints the public address + its $HASHROCK ATA.
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import fs from "fs";
const OUT = "./.treasury.mainnet.json";
const MINT = process.env.MINT || "B4z8tBZ7MmdQrGMuMx4wfKGSq1YLPwcfBixzUBLe9ory";
if (fs.existsSync(OUT)) {
  const bak = OUT + ".bak-" + Date.now();
  fs.copyFileSync(OUT, bak);
  console.log("backed up existing →", bak);
}
const kp = Keypair.generate();
fs.writeFileSync(OUT, JSON.stringify([...kp.secretKey]));
fs.chmodSync(OUT, 0o600);
const ata = await getAssociatedTokenAddress(new PublicKey(MINT), kp.publicKey);
console.log("=== NEW MAINNET TREASURY ===");
console.log("TREASURY_ADDRESS=" + kp.publicKey.toBase58());
console.log("treasury $HASHROCK ATA (send 20k here):", ata.toBase58());
console.log("secret saved → " + OUT + " (chmod 600, gitignored) — BACK THIS UP OFFLINE");
