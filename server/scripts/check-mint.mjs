// Read-only: inspect a mainnet SPL mint (decimals/supply/authority) + optional treasury ATA balance.
//   RPC=<rpc> MINT=<ca> [OWNER=<treasury pubkey>] node scripts/check-mint.mjs
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
const RPC = process.env.RPC || "https://api.mainnet-beta.solana.com";
const MINT = process.env.MINT || "B4z8tBZ7MmdQrGMuMx4wfKGSq1YLPwcfBixzUBLe9ory";
const conn = new Connection(RPC, "confirmed");
const mintPk = new PublicKey(MINT);
const m = await getMint(conn, mintPk);
console.log("MINT:", MINT);
console.log("decimals:", m.decimals);
console.log("supply (raw):", m.supply.toString());
console.log("supply (UI):", Number(m.supply) / 10 ** m.decimals);
console.log("mintAuthority:", m.mintAuthority ? m.mintAuthority.toBase58() : "null (BURNED)");
console.log("freezeAuthority:", m.freezeAuthority ? m.freezeAuthority.toBase58() : "null");
if (process.env.OWNER) {
  const ata = await getAssociatedTokenAddress(mintPk, new PublicKey(process.env.OWNER));
  console.log("treasury ATA:", ata.toBase58());
  try { const a = await getAccount(conn, ata); console.log("treasury balance (raw):", a.amount.toString()); }
  catch { console.log("treasury ATA: not created yet (0 balance)"); }
}
