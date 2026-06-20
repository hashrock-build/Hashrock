// On-chain bridge ($HASHROCK SPL, treasury = EOA). 1 in-game coin == 1 whole $HASHROCK; raw
// on-chain units = coins × 10**decimals (devnet legacy mint = 0, mainnet = 6 — see TOKEN_DECIMALS).
// Redeem: treasury sends $HASHROCK to the player. Deposit: verify a player's SPL transfer
// INTO the treasury from its tx signature. The server holds the treasury secret (MVP; a
// multisig/program replaces this at mainnet per invariant #5).
import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddress, getAccount, createTransferInstruction, getMint } from "@solana/spl-token";
import bs58 from "bs58";
import fs from "fs";
import crypto from "crypto";

const RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const mint = new PublicKey(process.env.HASHROCK_MINT!);
const treasury = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(process.env.TREASURY_SECRET_PATH || "./.treasury.json", "utf8"))),
);

let treasuryAta: PublicKey;

// Token decimals: 1 in-game coin == 1 whole $HASHROCK == 10**decimals raw on-chain units.
// The legacy devnet mint was decimals 0 (raw == coin); mainnet $HASHROCK is decimals 6. ALL
// raw↔coin conversion lives here so the rest of the server stays in whole coins. Set
// TOKEN_DECIMALS in .env; initChain() reads the real on-chain value and HARD-FAILS on a
// mismatch (money safety — never run with the wrong scale).
const ENV_DECIMALS = process.env.TOKEN_DECIMALS !== undefined ? Number(process.env.TOKEN_DECIMALS) : null;
let decimals = ENV_DECIMALS ?? 0;
let unitsPerCoin = 10 ** decimals;
const toRaw = (coins: number): number => Math.round(coins * unitsPerCoin); // coins → raw units (coins are integers, so exact)
const toCoins = (raw: number): number => raw / unitsPerCoin;               // raw → coins (may be fractional; floor before crediting)

export async function initChain(): Promise<void> {
  // Derive the treasury ATA OFFLINE (no RPC) — it was already created during setup, so we
  // don't need the network at boot. Best-effort confirm it on-chain with a few retries, but
  // NEVER let a transient devnet 503 crash startup: gameplay must boot even if RPC is flaky.
  treasuryAta = await getAssociatedTokenAddress(mint, treasury.publicKey);
  // Resolve token decimals from the on-chain mint (authoritative). HARD-FAIL on env mismatch;
  // only fall back to the env/default if the RPC is unreachable (don't block boot on flaky RPC).
  try {
    const m = await getMint(conn, mint);
    if (ENV_DECIMALS !== null && m.decimals !== ENV_DECIMALS)
      throw new Error(`FATAL: TOKEN_DECIMALS=${ENV_DECIMALS} but on-chain mint decimals=${m.decimals} — refusing to run (would mis-scale every redeem/deposit)`);
    decimals = m.decimals;
    unitsPerCoin = 10 ** decimals;
    console.log(`[chain] $HASHROCK decimals=${decimals} (1 coin = ${unitsPerCoin} raw units)`);
  } catch (e) {
    if ((e as Error).message.startsWith("FATAL")) throw e;
    console.warn(`[chain] could not read mint decimals (${(e as Error).message}); using TOKEN_DECIMALS=${decimals}`);
  }
  for (let i = 0; i < 4; i++) {
    try { const ata = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey); treasuryAta = ata.address; return; }
    catch (e) {
      console.error(`[chain] treasury ATA check failed (try ${i + 1}/4):`, (e as Error).message);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  console.warn("[chain] booting with derived treasury ATA (devnet RPC unavailable) — on-chain ops retry at call time");
}

// --- blockhash relayer: continuously cache the latest Solana blockhash; ore spawns
// derive their position from it (the on-chain source of randomness). ---
let latestBlockhash = "";
export const currentBlockhash = (): string => latestBlockhash;
export function startBlockhashRelayer(intervalMs = 2000): void {
  const poll = async () => {
    try { latestBlockhash = (await conn.getLatestBlockhash()).blockhash; }
    catch (e) { console.error("[relayer]", (e as Error).message); }
  };
  poll();
  setInterval(poll, intervalMs);
}
/** Deterministic 0..65535 from a base58 blockhash (last 2 bytes) — MVP "last 4 hex" rule. */
export function blockhashValue(bh: string): number {
  try { const b = bs58.decode(bh); return ((b[b.length - 2] << 8) | b[b.length - 1]) >>> 0; }
  catch { return 0; }
}

export const treasuryAddress = (): string => treasury.publicKey.toBase58();
export const mintAddress = (): string => mint.toBase58();
const CLUSTER = process.env.SOLANA_CLUSTER || "devnet"; // "mainnet-beta" on mainnet (Solscan omits the param for mainnet)
export const explorer = (sig: string): string =>
  CLUSTER.startsWith("mainnet") ? `https://solscan.io/tx/${sig}` : `https://solscan.io/tx/${sig}?cluster=${CLUSTER}`;
export function isValidAddress(s: string): boolean { try { new PublicKey(s); return true; } catch { return false; } }

/** Verify a wallet signed `message`, proving ownership of `address` (a Solana ed25519 pubkey).
 *  `sigB64` is the base64 signature from the client. Uses Node crypto (ed25519) — wraps the raw
 *  32-byte pubkey in DER/SPKI, no extra deps. */
export function verifyWalletSig(address: string, message: string, sigB64: string): boolean {
  try {
    const pub = bs58.decode(address);
    const sig = Buffer.from(sigB64, "base64");
    if (pub.length !== 32 || sig.length !== 64) return false;
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub)]);
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(message, "utf8"), key, Buffer.from(sig));
  } catch { return false; }
}

/** On-chain $HASHROCK balance held by the treasury, in coins (the real reserve, shown in the HUD). */
export async function treasuryBalance(): Promise<number> {
  try { return toCoins(Number((await getAccount(conn, treasuryAta)).amount)); } catch { return 0; }
}

/** On-chain $HASHROCK balance of an address in coins (0 if no token account yet). */
export async function tokenBalance(address: string): Promise<number> {
  try {
    const ata = await getAssociatedTokenAddress(mint, new PublicKey(address));
    return toCoins(Number((await getAccount(conn, ata)).amount));
  } catch { return 0; }
}

/** Thrown when a treasury send couldn't be confirmed AND couldn't be proven dead — the tx might
 *  still land, so the caller MUST NOT refund (would risk a double-pay). Needs manual reconcile. */
export class TxUncertainError extends Error {
  constructor(public sig: string) { super(`tx unconfirmed and not provably expired (sig ${sig})`); }
}

/** SAFE treasury-signed send (mainnet-correct). Sends ONE transaction (one blockhash, one sig)
 *  and re-broadcasts the SAME tx until it either confirms or its blockhash EXPIRES. A Solana tx
 *  is includable only while blockHeight ≤ lastValidBlockHeight; once exceeded it can NEVER land,
 *  so the caller can refund safely. We never resend with a fresh blockhash (that creates a second
 *  sig that could double-pay). We avoid sendAndConfirmTransaction (its websocket confirm hangs on
 *  some RPCs). Returns the sig on success; throws on definitive failure (safe to refund) or
 *  TxUncertainError (do NOT refund). */
async function treasurySend(instructions: TransactionInstruction[], hardCapMs = 180000): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: treasury.publicKey, recentBlockhash: blockhash }).add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }), // priority fee
    ...instructions,
  );
  tx.sign(treasury);
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 }); // preflight catches bad txs before they cost anything
  const stop = Date.now() + hardCapMs;
  while (Date.now() < stop) {
    const st = (await conn.getSignatureStatus(sig, { searchTransactionHistory: true })).value;
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig; // ✅ settled
    if (st?.err) throw new Error("tx failed on-chain: " + JSON.stringify(st.err)); // erred → no funds moved → safe to refund
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error("blockhash expired — tx can never land (safe to refund)");
    await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {}); // re-broadcast the SAME tx (idempotent)
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new TxUncertainError(sig); // near-impossible (cap >> blockhash validity); never refund on this
}

/** Send `amount` $HASHROCK from the treasury to `dest`. Returns the tx signature. */
export async function redeemTo(dest: string, amount: number): Promise<string> {
  const destPk = new PublicKey(dest);
  const destAta = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, destPk); // treasury pays rent if new
  return treasurySend([createTransferInstruction(treasuryAta, destAta.address, treasury.publicKey, toRaw(amount))]);
}

/** Build an UNSIGNED $HASHROCK transfer (payer → treasury) for the client to sign with the
 *  wallet. Returns a base64 transaction. Used for on-chain purchases (axes, items). */
export async function buildPurchaseTx(payer: string, amount: number): Promise<string> {
  const payerPk = new PublicKey(payer);
  const payerAta = await getAssociatedTokenAddress(mint, payerPk);
  const tx = new Transaction().add(createTransferInstruction(payerAta, treasuryAta, payerPk, toRaw(amount)));
  tx.feePayer = payerPk;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/** verifyDeposit with retry, since a freshly-sent tx may not be confirmed yet. */
export async function verifyDepositRetry(sig: string, tries = 6, delayMs = 2500): Promise<{ amount: number; source: string } | null> {
  for (let i = 0; i < tries; i++) {
    const r = await verifyDeposit(sig);
    if (r) return r;
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return null;
}

/** Recent tx signatures touching the treasury token account (for the deposit watcher). */
export async function recentTreasurySigs(limit = 15): Promise<string[]> {
  const sigs = await conn.getSignaturesForAddress(treasuryAta, { limit });
  return sigs.map((s) => s.signature);
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
  const rawDelta = after - before;
  if (rawDelta <= 0) return null;
  const amount = Math.floor(toCoins(rawDelta)); // raw → whole coins (floor: never credit more than backed; dust stays as treasury reserve)
  if (amount <= 0) return null;                  // sub-1-coin dust deposit
  const source = pre.find((b) => isMint(b) && acct(b) !== treasuryAtaStr)?.owner ?? "unknown";
  return { amount, source };
}
