// On-chain purchase helper: take the server-built (unsigned) transfer, have the wallet
// sign + send it, and return the signature for the server to verify.
import { Transaction } from "@solana/web3.js";
import { getPhantom } from "./wallet";

export async function signAndSend(txBase64: string): Promise<string> {
  const provider = getPhantom();
  if (!provider) throw new Error("no wallet");
  const bytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
  const tx = Transaction.from(bytes);
  const res = await provider.signAndSendTransaction(tx);
  return res.signature;
}
