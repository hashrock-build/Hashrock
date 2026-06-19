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
- 🟠 **Decimals decision is permanent.** Devnet uses **decimals 0** (1 token = 1 coin). If you want
  fractional $HASHROCK on mainnet, choose decimals at mint time and update the coin↔token mapping
  everywhere. You cannot change it later.
- 🟢 Run `npm run build` (client) + `npm --prefix server run typecheck` clean; pin dependency
  versions (lockfiles committed).

## B. RPC

- 🔴 **Do not use public mainnet RPC.** It is rate-limited and will drop sends. Use a paid provider
  (Helius / Triton / QuickNode) mainnet endpoint. Set `SOLANA_RPC` in `.env`. Verify it can both
  read recent txs **and** land a test transfer (the Helius *devnet* node was desynced — confirm the
  mainnet one isn't: compare `getVersion` + look up a known recent signature).

## C. Token mint (one-time)

- A fresh **mainnet treasury keypair** is already generated:
  - address **`M3pKAX6fJwNy4DVs5oh55FSegDoDoBJVyVkWF95wb1Q`**
  - secret at `server/.treasury.mainnet.json` (chmod 600, gitignored). **Back this up offline.**
  - env template ready at `server/.env.mainnet.example` (`TREASURY_SECRET_PATH=./.treasury.mainnet.json`).
- 🔴 Fund a **deployer** wallet with real SOL (mint creation + ATA + fees ≈ a few cents, but no
  airdrops on mainnet). Also send the treasury a little SOL for redeem priority fees.
- Run the setup against mainnet (uses the mainnet treasury secret + deployer):
  ```bash
  cd server
  cp .treasury.mainnet.json .treasury.json   # setup-chain.mjs mints to ./.treasury.json
  SOLANA_RPC=<paid-mainnet-rpc> DEPLOYER_KEYPAIR=/path/to/funded.json \
    node scripts/setup-chain.mjs
  # then point the server at the mainnet secret (TREASURY_SECRET_PATH=./.treasury.mainnet.json)
  ```
  This mints the fixed **1B** supply (decimals 0) to the treasury and **burns the mint authority**
  (fixed supply forever). Record `HASHROCK_MINT`, `TREASURY_ADDRESS`.
- 🔴 **Verify on a mainnet explorer**: supply = 1B, mint authority = null (burned), decimals as
  intended. This is irreversible — check before announcing.

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
  pool + creator)`; alert if it ever drifts (catches any accounting bug early).

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
1. Ship code hardening (A). 2. Set paid mainnet `SOLANA_RPC` (B). 3. `setup-chain.mjs` on mainnet,
verify mint (C). 4. Move treasury to multisig + hot float (D). 5. Economy sign-off + reconciliation
job (E). 6. `.env` → mainnet values, `docker compose up -d --build`, verify (F). 7. Confirm art/legal
(G). Only then announce.
