// One-time devnet setup for $HASHROCK (treasury = EOA, MVP).
// Creates a dedicated treasury keypair, funds it from the CLI deploy wallet, mints the
// fixed 1B supply (decimals 0 → 1 token == 1 in-game coin) to the treasury, then PERMANENTLY
// disables the mint authority (fixed supply forever). Prints the values for server/.env.
//
//   run:  node scripts/setup-chain.mjs
import {
  Connection, Keypair, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, AuthorityType } from "@solana/spl-token";
import fs from "fs";

// Works for devnet OR mainnet — set SOLANA_RPC (+ DEPLOYER_KEYPAIR for a funded mainnet payer).
// On mainnet the deployer needs REAL SOL (no airdrop) and you must move the treasury to a
// multisig afterwards — see MAINNET.md.
const RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const SUPPLY = Number(process.env.SUPPLY || 1_000_000_000); // fixed 1B, decimals 0
const TREASURY_PATH = "./.treasury.json";
const DEPLOY_PATH = process.env.DEPLOYER_KEYPAIR || `${process.env.HOME}/cora-deploy/keys/deploy-wallet.json`;
const conn = new Connection(RPC, "confirmed");
const load = (p) => Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p))));

const deployer = load(DEPLOY_PATH);

let treasury;
if (fs.existsSync(TREASURY_PATH)) { treasury = load(TREASURY_PATH); console.log("reusing existing treasury"); }
else { treasury = Keypair.generate(); fs.writeFileSync(TREASURY_PATH, JSON.stringify([...treasury.secretKey])); console.log("generated new treasury"); }
console.log("treasury:", treasury.publicKey.toBase58());

// fund treasury with SOL for fees (transfer from the funded deploy wallet)
const bal = await conn.getBalance(treasury.publicKey);
if (bal < 0.15 * LAMPORTS_PER_SOL) {
  console.log("funding treasury 0.3 SOL from deployer…");
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: deployer.publicKey, toPubkey: treasury.publicKey, lamports: 0.3 * LAMPORTS_PER_SOL,
  }));
  await sendAndConfirmTransaction(conn, tx, [deployer]);
}

console.log("creating mint (decimals 0)…");
const mint = await createMint(conn, treasury, treasury.publicKey, null, 0);

console.log("minting fixed supply to treasury…");
const ata = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey);
await mintTo(conn, treasury, mint, ata.address, treasury, SUPPLY);

console.log("disabling mint authority (fixed supply forever)…");
await setAuthority(conn, treasury, mint, treasury, AuthorityType.MintTokens, null);

console.log("\n=== DONE — put these in server/.env ===");
console.log("HASHROCK_MINT=" + mint.toBase58());
console.log("TREASURY_ADDRESS=" + treasury.publicKey.toBase58());
console.log("TREASURY_ATA=" + ata.address.toBase58());
console.log("(treasury secret saved to server/.treasury.json — gitignored)");
