# HASHROCK — Production Deploy (single VPS, e.g. Contabo)

One VPS runs everything via Docker Compose: **Postgres** + the **authoritative server** + **Caddy**
(serves the built client and terminates TLS, auto reverse-proxying the API + WebSockets). No DB
port is exposed; the treasury key is mounted at runtime, never baked into an image or git.

```
 browser ──TLS──▶ Caddy ──┬─ /            → static client (dist)
                          └─ api.<domain> → server:2567 (Colyseus WS + /stats /health)
                                              └─ db (internal only)
```

## 0. Prerequisites
- A Contabo VPS (Ubuntu 22.04/24.04, 2 vCPU / 4 GB is plenty to start).
- A domain. Create two **A records** → the VPS IP:
  - `playhashrock.com` (game) and `api.playhashrock.com` (server). Wait for DNS to propagate.
- The **treasury keypair** file `server/.treasury.json` (from `setup-chain.mjs`). Keep it secret.

## 1. Install Docker on the VPS
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in so `docker` works without sudo
docker compose version          # confirm the compose plugin is present
```

## 2. Get the code
```bash
git clone <your repo> hashrock && cd hashrock
# (or rsync the project up; the build needs src/, server/, shared/, public/, index.html)
```

## 3. Configure
```bash
cp .env.production.example .env
nano .env       # set DOMAIN, API_DOMAIN, POSTGRES_PASSWORD, SOLANA_RPC, HASHROCK_MINT, TREASURY_ADDRESS
openssl rand -hex 24            # → use as POSTGRES_PASSWORD
```
Upload the treasury secret (do NOT commit it):
```bash
scp server/.treasury.json  user@vps:~/hashrock/server/.treasury.json
chmod 600 server/.treasury.json
```

## 4. Launch
```bash
docker compose up -d --build
docker compose logs -f server   # expect: "DB ready", "Chain ready", "server → ws://...:2567"
```
Caddy fetches Let's Encrypt certs automatically (ports 80/443 must be open). First request to
each domain may take a few seconds while certs issue.

## 5. Verify
```bash
curl https://api.<domain>/health     # → ok
curl https://api.<domain>/stats      # → {"online":..,"ore":..,"mint":".."}
```
Open `https://<domain>` → landing page → **Play Now** → connect + sign in wallet → mine.

## 6. Firewall
```bash
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```
Postgres (5432) and the server (2567) are **not** published — only reachable inside the compose network.

## 7. Operate
- **Update / redeploy:** `git pull && docker compose up -d --build`
- **Logs:** `docker compose logs -f server`
- **DB backup (cron daily):**
  ```bash
  docker compose exec -T db pg_dump -U hashrock hashrock | gzip > backup-$(date +%F).sql.gz
  ```
- **Treasury SOL for fees:** the redeem signer pays priority fees — keep ~0.3+ SOL in `TREASURY_ADDRESS`.
- **Invariant check:** the server enforces 1:1 in Postgres; spot-check with
  `docker compose exec db psql -U hashrock -d hashrock -c "SELECT (SELECT COALESCE(SUM(coins),0) FROM players)+pool+creator AS coins, treasury FROM economy"`.

## Notes
- The client is built with `VITE_SERVER_URL=wss://${API_DOMAIN}` (compose build arg), so it talks
  to the API over secure WebSockets. Changing the API domain requires a rebuild (`--build`).
- `/stats` is CORS-open (read-only counters) by design; nothing economic is exposed.
- Going to **mainnet**: see **MAINNET.md** before flipping `SOLANA_RPC` / mint / treasury.
