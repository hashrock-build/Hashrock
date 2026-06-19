// One-time login nonces (replay protection for wallet sign-in). The client GETs a nonce, signs a
// message containing it, and joins; the server consumes the nonce exactly once. In-memory is fine
// for a single server; move to Redis if you ever run multiple instances.
import crypto from "crypto";

const TTL_MS = 2 * 60 * 1000; // 2 minutes to connect after fetching
const store = new Map<string, number>(); // nonce -> expiry

/** Issue a fresh single-use nonce. */
export function issueNonce(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  store.set(nonce, Date.now() + TTL_MS);
  if (store.size > 10000) sweep(); // bound memory
  return nonce;
}

/** Consume a nonce: true only if it exists and hasn't expired (then it's burned). */
export function consumeNonce(nonce: string): boolean {
  const exp = store.get(nonce);
  if (exp === undefined) return false;
  store.delete(nonce);
  return Date.now() < exp;
}

function sweep(): void {
  const now = Date.now();
  for (const [n, exp] of store) if (exp < now) store.delete(n);
}
