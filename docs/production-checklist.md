# Production deployment checklist

Compiled 2026-10-20 from a production-readiness hardening pass (accounts,
secrets, process model, transport). Run top to bottom on the target host.

## 1. Accounts & first boot

- Boot with `NODE_ENV=production` **before** the database exists. The
  auto-seed migration (`server/db/migrations/20260831000002-auto-seed.js`)
  skips the built-in root admin in production; the first-run setup wizard
  (`server/middleware/setupGate.js` + `setupService.js`) creates the real
  admin account with a chosen password and `is_root=1`.
- **Never copy a dev database into production.** A dev `database.sqlite`
  carries `admin@studio.com`/`admin` plus all six QA accounts. Production
  accounts come only from the setup wizard / in-app user management.
- Every destructive script refuses under `NODE_ENV=production`:
  `reset:db`, `seed:users|tickets|bulk`, `seedAccessTestUsers`,
  `seedBulkAll`, and `reseed:admin`. Lockout recovery with `reseed:admin`
  requires the explicit `RESEED_ADMIN_ALLOW_PRODUCTION=1` opt-in, and the
  reset login is then flagged `requires_password_change` so the default
  credential cannot stay live.
- Keep the default auth hardening: `AUTH_RATE_LIMIT_MAX=5` failed logins
  per account+IP per 15 min (`.env.example` raises it for dev only).

## 2. Secrets (host-local, no external service)

- `JWT_SECRET` is mandatory in production — `server/config/env.js` throws
  at boot without it. Deliver it through the production host's root `.env`
  (gitignored; never a committed file). Create it once on the host:
  `cp .env.example .env`, then set a long random value, e.g.
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `.env` never ships: the delivery zip excludes it (unless `--keep-env`),
  `.gitignore` covers `.env` and every `.env.*` variant except
  `.env.example`, and git history is clean (verified 2026-10-21 — `.env`
  was never committed on any branch). If that ever changes, rotate
  `JWT_SECRET`.
- Keep `.env` readable only by the service account on a shared host, and
  include it in your off-host backup policy (or rotate `JWT_SECRET` after
  every restore).
- No external secrets manager is used or required — the app reads only the
  process environment plus the root `.env`. `npm start` / `npm run dev`
  run their commands directly.

## 3. Process model (PM2, SQLite single-writer)

- `npm run start:prod` — fork mode, `instances: 1` (ecosystem.config.cjs).
  **Never cluster mode**: multiple writers on one SQLite file deadlock
  (`SQLITE_BUSY`).
- One API process per database, ever. The PID lock (`logs/.app.lock`) +
  watchdog refuse a second instance; do not disable `APP_LOCK_WATCHDOG_MS`.
- Persist across reboots: `npm run startup` (system service) + `npm run save`.
- Graceful shutdown is wired (SIGINT/SIGTERM → drain → WAL TRUNCATE →
  lock release); `kill_timeout` (10s) must exceed close time — raise it
  for DBs >1GB.
- `npm run reload` for zero-downtime restarts (fork-new-then-SIGINT-old).

## 4. HTTPS / reverse proxy

- Terminate TLS (nginx / Caddy / cloud proxy) in front of `:3000`; never
  expose the Node port directly. JWT lives in `localStorage`, so **plain
  HTTP is an active-session-theft risk** — HTTPS is mandatory, not optional.
- `app.set('trust proxy', 1)` is already configured — exactly ONE proxy
  hop in front, so `X-Forwarded-For`/`-Proto` are honored (rate limiter
  per-IP keys and health diagnostics depend on it).
- `helmet` is on (CSP off for the SPA's inline scripts; HSTS activates
  once responses are served over HTTPS — enable preload at the proxy).
- **Set `CORS_ORIGIN` to the real frontend origin** — the default is
  `http://localhost:5174` and will block the deployed SPA.
- Build the SPA with `VITE_API_BASE_URL` pointing at the `https://` API
  origin (`npm run build` reads it at build time); serve `dist/` from the
  same proxy origin to minimize cross-origin surface.
- Frontend and API on the same origin (proxy routes `/api` + `/uploads` +
  static) removes CORS from the critical path entirely — preferred layout.

## 5. Data, disk, backups

- Boot preflight refuses to start below `DISK_MIN_FREE_BYTES` (500MB
  default); runtime watermarks (`DISK_WARN_FREE_GB`/`DISK_CRITICAL_FREE_GB`)
  shed writes before the disk fills — tune per host, do not set to 0.
- WAL caps (`DISK_WAL_CAP_MB=256`) + periodic checkpoints prevent `-wal`
  bloat; keep the DB on local disk, never a network share.
- Schedule conversation/DB backups (`backups/`) and copy them **off the
  host**; verify each ZIP with `npm run verify:backup <zip>`.
- Prove restore on the target host before go-live:
  `npm run test:restore` (isolated instance, migration replay, tamper
  checks).
- Run full `npm run doctor` on the target host (environment probes only
  pass there) and a final `npm run test:all` against the production-shaped
  environment.
