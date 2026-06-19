// On-chain bridge ($HASHROCK SPL on devnet, treasury = EOA). decimals 0 ⇒ 1 token == 1 coin.
// Redeem: treasury sends $HASHROCK to the player. Deposit: verify a player's SPL transfer
// INTO the treasury from its tx signature. The server holds the treasury secret (MVP; a
// multisig/program replaces this at mainnet per invariant #5).
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
import fs from "fs";

const RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const mint = new PublicKey(process.env.HASHROCK_MINT!);
const treasury = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(process.env.TREASURY_SECRET_PATH || "./.treasury.json", "utf8"))),
);

let treasuryAta: PublicKey;

export async function initChain(): Promise<void> {
  const ata = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey);
  treasuryAta = ata.address;
}

export const treasuryAddress = (): string => treasury.publicKey.toBase58();
export const mintAddress = (): string => mint.toBase58();
export const explorer = (sig: string): string => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export function isValidAddress(s: string): boolean { try { new PublicKey(s); return true; } catch { return false; } }

/** Send `amount` $HASHROCK from the treasury to `dest`. Returns the tx signature. */
export async function redeemTo(dest: string, amount: number): Promise<string> {
  const destPk = new PublicKey(dest);
  const destAta = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, destPk); // treasury pays rent if new
  return transfer(conn, treasury, treasuryAta, destAta.address, treasury, amount);
}

/** Verify a confirmed tx really moved $HASHROCK INTO the treasury; return {amount, source}. */
export async function verifyDeposit(sig: string): Promise<{ amount: number; source: string } | null> {
  const tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx || tx.meta?.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const mintStr = mint.toBase58(), treasuryAtaStr = treasuryAta.toBase58();
  const isMint = (b: { mint: string }) => b.mint === mintStr;
  const acct = (b: { accountIndex: number }) => keys[b.accountIndex];
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const before = Number(pre.find((b) => isMint(b) && acct(b) === treasuryAtaStr)?.uiTokenAmount.amount ?? 0);
  const after = Number(post.find((b) => isMint(b) && acct(b) === treasuryAtaStr)?.uiTokenAmount.amount ?? 0);
  const amount = after - before;
  if (amount <= 0) return null;
  const source = pre.find((b) => isMint(b) && acct(b) !== treasuryAtaStr)?.owner ?? "unknown";
  return { amount, source };
}
