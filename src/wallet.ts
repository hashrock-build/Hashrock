// Phantom wallet connector. The address is cluster-independent (it's just the keypair),
// so it receives redeemed $HASHROCK on devnet regardless of Phantom's selected network.
// (Set Phantom → Settings → Developer → Devnet to SEE the devnet token balance.)
interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
}

export function getPhantom(): PhantomProvider | undefined {
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  if (w.phantom?.solana?.isPhantom) return w.phantom.solana;
  if (w.solana?.isPhantom) return w.solana;
  return undefined;
}

/** Connect Phantom and return the address; null if absent or the user declined. */
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
