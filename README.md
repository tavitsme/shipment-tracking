# Shipment Tracking System (Prototype)

ระบบติดตามพัสดุสำหรับเว็บไซต์ — แสดงสถานะการขนส่งจากหลายบริษัทขนส่ง (Thailand Post, DHL, FedEx, UPS, Aramex, SF Express) ในจุดเดียวกัน เป็น prototype ที่เน้นความเรียบง่าย ปลอดภัย และ deploy ง่ายบนเซิร์ฟเวอร์ที่มีอยู่แล้ว ตัวเลขพัสดุ (tracking number) จะไม่ถูกเก็บเป็นข้อความตรงตัว ๆ แต่เก็บเฉพาะเวอร์ชันที่มาส์กและแฮช (SHA-256 + salt) เพื่อปกป้องข้อมูลส่วนบุคคลของลูกค้า

---

## Tech Stack

- **Backend:** Node.js 20 + Express (CommonJS), entry point `server/index.js`.
- **Database:** Isolated PostgreSQL 16 (own container, own database `tracking_db`, own user).
- **Reverse proxy:** The app sits behind the **existing Traefik** (owned by the n8n project). It does **not** run its own Traefik and does **not** publish port 8080 to the host.
- **Path:** Everything is mounted under `BASE_PATH` (`/tracking`) — frontend at `/tracking`, API at `/tracking/api/track`.

---

## Local Development

1. Copy the env template and fill the two required values:
   ```bash
   cp .env.example .env
   ```
   In `.env` set at minimum:
   - `DATABASE_URL` — point at a reachable Postgres. The compose postgres exposes on host port `5433`, e.g.
     `postgres://tracking_user:YOUR_PASSWORD@localhost:5433/tracking_db`
   - `TRACKING_HASH_SALT` — a long random string (generate one with
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
2. Install deps:
   ```bash
   npm install
   ```
3. Start the app (runs migrations on boot, then listens):
   ```bash
   npm run dev
   ```
   You need a reachable Postgres — either the compose one (below) or any local pg.

### Local Postgres via Docker (recommended)

Traefik is for the VPS — skip it locally. Just run the database:

```bash
docker compose up -d postgres
npm run dev
```

> Note: `docker compose up` (full) will **error locally** because `TRAEFIK_NETWORK` is empty and that network is declared `external: true`. That is expected — use the `postgres`-only command above for local dev.

---

## Deploy to VPS (step by step)

Run these on the VPS (SSH / console). The target folder on the VPS is `/docker/tracking/`.

### a. Copy the project to the VPS
Copy the whole `shipment-tracking/` folder to `/docker/tracking/` on the server.

### b. DISCOVERY (required) — find the Traefik network name
The app must join the same docker network the existing Traefik lives on. On the VPS run:

```bash
docker network ls
docker inspect n8n-traefik-1 --format '{{json .NetworkSettings.Networks}}'
```

Look at the JSON output and identify the network name. **Expected:** `n8n_default`.

### c. Create `/docker/tracking/.env`
From the `.env.example` template, fill in:
- `POSTGRES_PASSWORD` — a strong password.
- `TRACKING_HASH_SALT` — a long random string.
- `TRAEFIK_NETWORK` — the name discovered in step (b), e.g. `n8n_default`.
- Leave all carrier credentials **blank** (prototype).

### d. Build & start
From `/docker/tracking/`:

```bash
docker compose up -d --build
```

### e. Check logs
```bash
docker compose logs -f app
```
Confirm you see `migrations complete` and `listening on 8080`.

### f. Pre-warm TLS (first request)
```bash
curl -k https://vitchy.com/tracking
```
The first request may take a few seconds while Let's Encrypt issues the certificate for `vitchy.com`.

### g. Open in browser
Go to **https://vitchy.com/tracking**.

---

## Carrier Status (Prototype)

| Carrier        | Status           |
| -------------- | ---------------- |
| Thailand Post  | Not configured   |
| DHL            | Not configured   |
| FedEx          | Not configured   |
| UPS            | Not configured   |
| Aramex         | Not configured   |
| SF Express     | Not configured   |

**How to enable a carrier later:** add its credentials to `/docker/tracking/.env`, then `docker compose up -d` (no code change — `isConfigured()` flips automatically). The UI/API will start returning real results for that carrier.

---

## Privacy Note

Tracking numbers are **never** stored as plaintext. Only two representations are persisted:
- a **masked** form (e.g. last 4 digits visible), and
- a **salted SHA-256 hash** (the salt lives in `.env` as `TRACKING_HASH_SALT`, never in source).

There is no plaintext column in the database.

---

## Verification Checklist

After deploy, confirm:
- [ ] Submitting an 11-digit-only number is **rejected** (invalid format for all carriers).
- [ ] Submitting an empty value is **rejected**.
- [ ] A valid-format number whose carrier is not set shows a **`provider_not_configured`** card.
- [ ] Page serves a `<meta name="robots" content="noindex">` tag (not indexed by search engines).
- [ ] The database table contains **only** masked + hash columns (no plaintext).

---

## Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ----------------- |
| **Traefik 404** at `/tracking` | `TRAEFIK_NETWORK` in `.env` is wrong (doesn't match the real network), or the `app` container is not healthy. Re-check step (b) of Deploy and `docker compose ps`. |
| **TLS delay / first request slow** | Let's Encrypt is issuing the cert for `vitchy.com`. Wait a few seconds and retry. |
| **compose error about external network** | `TRAEFIK_NETWORK` is empty or the network doesn't exist. Set it to the discovered name (e.g. `n8n_default`) and run `docker compose up -d --build` again. |
| **App exits at boot** | `TRACKING_HASH_SALT` or `DATABASE_URL` missing/invalid. Fill `.env` and restart. |
