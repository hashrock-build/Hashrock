// Phantom wallet connector. The address is cluster-independent (it's just the keypair),
// so it receives redeemed $HASHROCK on devnet regardless of Phantom's selected network.
// (Set Phantom → Settings → Developer → Devnet to SEE the devnet token balance.)
interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(tx: unknown): Promise<{ signature: string }>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
}

// Accepts any injected Solana wallet (Phantom / Backpack / Solflare, …) — they all expose
// a `connect()` that returns a publicKey.
export function getPhantom(): PhantomProvider | undefined {
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; backpack?: PhantomProvider; solana?: PhantomProvider };
  const p = w.phantom?.solana ?? w.backpack ?? w.solana;
  return p && typeof p.connect === "function" ? p : undefined;
}

/** Connect the wallet and return the address; null if absent or the user declined. */
export async function connectPhantom(onlyIfTrusted = false): Promise<string | null> {
  const p = getPhantom();
  if (!p) return null;
  try {
    const res = await p.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
    return res.publicKey.toString();
  } catch {
    return null;
  }
}

export async function disconnectPhantom(): Promise<void> {
  try { await getPhantom()?.disconnect(); } catch { /* ignore */ }
}
