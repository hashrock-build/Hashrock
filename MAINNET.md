# HASHROCK — Mainnet Migration Checklist

Mainnet handles **real value**, so the bar is higher than devnet. Work top-to-bottom; do not
skip the 🔴 items. The economy is only as safe as its weakest accounting path (see the
"ECONOMIC INVARIANTS" section of `CLAUDE.md` — they do not change on mainnet).

---

## A. Code hardening (do BEFORE touching mainnet)

- ✅ **Redeem refund is now double-pay-safe.** `treasurySend` sends ONE tx (one blockhash, one
  sig) and re-broadcasts the SAME tx until it confirms or its blockhash **expires** — and a Solana
  tx can never land after `blockHeight > lastValidBlockHeight`, so a refund after expiry is safe.
  It no longer resends under fresh blockhashes (that created a second sig that could double-pay —
  the cause of the inflated devnet balances). If it can't confirm AND can't prove the tx dead, it
  throws `TxUncertainError` and `onRedeem` does **NOT** refund (keeps coins burned for manual
  reconcile) instead of risking a double-pay.
- ✅ **Login replay closed with a server nonce.** Client GETs `/nonce` (one-time, 2-min TTL),
  signs `HASHROCK login\n<addr>\n<nonce>`, joins; the server `consumeNonce()`s it exactly once.
  A captured signature can't be replayed (nonce already burned). (In-memory store — move to Redis
  if you run multiple server instances.)
- 🟠 **Rate-limit** redeem/purchase/login per wallet + per IP; alert on anomalies.
- ✅ **Decimals handled (mainnet mint = decimals 6).** The mainnet $HASHROCK is **decimals 6**
  (devnet legacy was 0). `chain.ts` now centralises raw↔coin conversion (`1 coin = 10**decimals
  raw`): redeem/purchase multiply up, deposits floor down to whole coins. Set `TOKEN_DECIMALS=6`
  in `.env`; `initChain()` reads the on-chain mint and **hard-fails on mismatch** so the server
  can never run mis-scaled. (Verify with `node scripts/check-mint.mjs`.)
- 🟢 Run `npm run build` (client) + `npm --prefix server run typecheck` clean; pin dependency
  versions (lockfiles committed).

## B. RPC

- 🔴 **Do not use public mainnet RPC.** It is rate-limited and will drop sends. Use a paid provider
  (Helius / Triton / QuickNode) mainnet endpoint. Set `SOLANA_RPC` in `.env`. Verify it can both
  read recent txs **and** land a test transfer (the Helius *devnet* node was desynced — confirm the
  mainnet one isn't: compare `getVersion` + look up a known recent signature).

## C. Token mint (ALREADY DONE — do NOT re-mint)

$HASHROCK is **already live on mainnet** (launched on Orynth). Do **not** run `setup-chain.mjs`
(that creates a brand-new mint — for devnet self-mint only). Verified on-chain
(`node scripts/check-mint.mjs`):
- Mint (CA): **`B4z8tBZ7MmdQrGMuMx4wfKGSq1YLPwcfBixzUBLe9ory`**
- supply ≈ **500K**, **mint authority = null (burned)** ✓ (fixed supply forever), **decimals = 6**,
  freeze authority = null ✓.
- Put it in `.env`: `HASHROCK_MINT=B4z8…ory`, `TOKEN_DECIMALS=6`, `SOLANA_CLUSTER=mainnet-beta`.

Treasury wallet (the redeem signer / reserve holder):
- A **fresh mainnet treasury keypair** is generated:
  - address **`3cvBQmNZHDBo8XL6nT7YaqGYNzYSqRPVWbHvYPKdVvzL`**
  - its $HASHROCK ATA (deposit target): **`14Y4UuZQBFbUgdUeuSsYR5BqYAsBnWiAANmSxdFnKgPS`**
  - secret at `server/.treasury.mainnet.json` (chmod 600, gitignored). **🔴 Back this up offline.**
- 🔴 **Fund the treasury** with the initial reserve: **20,000 $HASHROCK** (this is the backing —
  `POOL_SEED` MUST be ≤ this, see §E) **plus a little SOL** (≈0.05) for redeem priority + new-ATA
  rent. A standard wallet transfer auto-creates the ATA above.
- 🔴 **Verify the funding** before launch: `OWNER=3cvB…vzL node scripts/check-mint.mjs` should show
  the treasury balance = 20000 (× 10^6 raw). This is real value — check before announcing.

## D. Treasury security (invariant #5: treasury must NOT be arbitrarily withdrawable)

The treasury both **holds the backing supply** and **signs redeems**. A hot key on the server that
holds 1B is unacceptable for mainnet. Choose one:

- **Recommended (MVP-mainnet):** split into a **cold multisig** + a **hot float**.
  - Move the bulk of $HASHROCK to a **Squads multisig** (cold). It never signs automatically.
  - Keep only a small **operating float** in the server's hot redeem wallet (`server/.treasury.json`),
    sized to a few days of expected redemptions. Top it up from the multisig as needed.
  - Backing stays 1:1 (cold + hot + pool + player coins === total minted); only the *signing surface*
    shrinks. Document the float-management procedure.
- **Target (roadmap M5):** an on-chain **program** that releases $HASHROCK only against a
  server-signed, burn-matched redeem authorization (no raw treasury key on the server at all).
- 🔴 Treasury secret handling: never in git/images; on the VPS `chmod 600`, restrict SSH, consider a
  secrets manager. Rotating it means migrating tokens to a new account.

## E. Economy review (sign-off before launch)

- 🔴 Re-confirm every invariant holds on mainnet config (1–9 in `CLAUDE.md`). Especially:
  coins minted ONLY on confirmed deposit; mining = pool redistribution (no mint); sinks paid in
  $HASHROCK (95% pool / 5% creator); **fixed pie** (upgrades shift share, never emission).
- Re-check the locked numbers (`MVP.md` "Economy v2"): pool seed, daily emission %, upgrade pricing
  (≥ ~30-day payback), durability recycle. Adjust `.env` (`POOL_SEED`, `DAILY_EMISSION`,
  `CREATOR_FEE`, …) deliberately — they are economic policy, not knobs.
- 🔴 **Backing reconciliation job:** periodically assert `on-chain treasury balance ≥ (player coins +
  pool + creator)`; alert if it ever drifts (catches any accounting bug early). (Treasury funded with
  ~23.9k $HASHROCK vs `POOL_SEED=20000` → starts over-collateralized by ~3.9k, which is fine.)
- 🔴 **Reset user data before launch.** Devnet coins were backed only by worthless devnet $HASHROCK;
  they must NOT carry into mainnet (would be unbacked → breaks invariant #3). Start mainnet on a
  FRESH database, or wipe an existing one:
  ```bash
  cd server
  DATABASE_URL=<mainnet-db> POOL_SEED=20000 CONFIRM=yes node scripts/reset-db.mjs
  ```
  This truncates `players` + `ledger` and re-seeds `economy` to pool=treasury=20000 (0 player coins).
  Verify `verifyInvariant()` holds and that on-chain treasury (~23.9k) ≥ DB treasury (20k) afterwards.

## F. Infra & ops

- Follow **DEPLOY.md** (Docker Compose + Caddy TLS). Point real DNS.
- 🟠 Automated **Postgres backups** off-box (the ledger is the audit trail — losing it loses the
  accounting history). Test a restore.
- 🟠 Monitoring/alerting: server up, RPC errors, redeem failures, treasury SOL low, invariant drift.
- 🟢 Keep `SPAWN_INTERVAL_SEC` etc. at production values; load-test with expected concurrent miners.

## G. Legal / assets

- 🔴 **Art license:** Pixel Crawler / Shield Arc assets are **gameplay-only — NOT sellable/NFT**
  (see `CLAUDE.md` + `assets/.../Terms.txt`). Sellable cosmetics on mainnet need original/commissioned
  art with full rights. Do not mint pack art as NFTs.
- Token disclaimers / terms of service / regional compliance as appropriate.

---

### Flip-the-switch summary
1. Ship code hardening (A) — incl. decimals-6 conversion. 2. Set paid mainnet `SOLANA_RPC` +
`SOLANA_CLUSTER=mainnet-beta` (B). 3. Mint already exists — set `HASHROCK_MINT` + `TOKEN_DECIMALS=6`
and **fund the treasury with 20,000 $HASHROCK** + SOL; verify (C). 4. Move bulk to multisig + hot
float (D). 5. Economy sign-off + reconciliation job — `POOL_SEED=20000` ≤ treasury; **reset user data
(`reset-db.mjs`)** so no devnet balances carry over (E). 6. `.env` → mainnet values,
`docker compose up -d --build`, verify (F). 7. Confirm art/legal (G). Only then announce.
