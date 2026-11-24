# scripts/loadTests — k6 load & stress suite

> **Safety rule:** the test database (`scripts/loadTests/.runtime/database.loadtest.sqlite*`)
> is the **only** database this suite ever touches. The dev seed in `database.sqlite`
> is never read or written by load traffic. `.gitignore` enforces this.

## Layout

```
scripts/loadTests/
├── lib/
│   ├── config.js     # BASE_URL, thresholds, default creds
│   ├── auth.js       # one-shot login (called from k6 setup())
│   ├── fixtures.js   # seed kit/consumable rows via the API
│   └── metrics.js    # custom k6 Trend/Rate/Counter definitions
├── scenarios/
│   ├── read-heavy.js
│   ├── write-heavy.js
│   └── auth-bruteforce.js
└── .runtime/         # .gitignored — load-test SQLite database
```

## Prerequisite: install k6

The scripts invoke the `k6` binary. Install once on the host:

- Windows: `winget install k6.k6` or download the MSI from https://k6.io
- macOS: `brew install k6`
- Linux: see https://k6.io/docs/getting-started/installation/

Verify with `k6 version`.

## Runbook

Always run in this order. **Never** start the dev server (`npm run dev`) and
the load-test server (`npm run test:server`) at the same time — they bind to
different ports (3000 vs 3100) but a mistake here could corrupt the dev DB.

1. **Seed the test DB.** Running the test server once is enough — the server
   calls `getDb()` which auto-runs the schema + seed against `DB_PATH`.

   ```bash
   rm -rf scripts/loadTests/.runtime
   npm run test:server
   ```

   Wait until you see `Server running on http://localhost:3100`, then Ctrl-C.

2. **Start the test server in the background.**

   ```bash
   npm run test:server
   ```

   The script sets `LOAD_TEST_MODE=1` and `DB_PATH` to the load-test SQLite
   path. Rate limiters are bypassed and the dev DB is untouched.

3. **Run a scenario.**

   ```bash
   npm run load:read
   npm run load:write
   npm run load:auth
   ```

   Every `load:*` script first runs a **fail-fast preflight**
   (`scripts/loadTests/preflight.js`) and only starts k6 when all checks
   pass:

   - the load-test server answers `/api/health` on `BASE_URL` (and the URL
     is not the dev server on :3000),
   - the server's WAL starts under 1MB (`PREFLIGHT_WAL_MAX_MB`) — read from
     the health endpoint's `wal_bytes`, with a filesystem fallback to
     `<DB_PATH>-wal`; a WAL that starts big only grows under load and the
     measured tail would describe leftover state, not the code under test
     (if it fails: rerun step 1 to wipe + reseed, or force a
     `PRAGMA wal_checkpoint(TRUNCATE)`),
   - the host has ≥ 2GB free RAM (`PREFLIGHT_MIN_FREE_RAM_MB`) — a
     memory-starved 200-VU run produces p95 noise that looks like a
     regression.

   A failed preflight prints which check failed and exits non-zero **before
   k6 starts**. k6 itself prints a summary to stdout; thresholds gate
   pass/fail: a failing threshold exits non-zero.

4. **Stop the server.** Ctrl-C in the test-server shell, or kill the node
   process by PID.

## Overrides

| Env var | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:3100` | Override target host (e.g. staging) |
| `ADMIN_USERNAME` | `admin` | Seeded root admin username |
| `ADMIN_PASSWORD` | `admin` | Seeded root admin password |
| `RATE_LIMITS_ON` | _(unset)_ | Set to `1` to enable the `Rate limit active (429)` check in `load:auth` — only meaningful against a server with rate limiters enabled (the default test server runs with `LOAD_TEST_MODE=1`, which disables them by design) |
| `PREFLIGHT_WAL_MAX_MB` | `1` | Preflight WAL ceiling in MB before a scenario may start |
| `PREFLIGHT_MIN_FREE_RAM_MB` | `2048` | Preflight host free-RAM floor in MB |

## Threshold cheat sheet

| Scenario | p(95) | p(99) | Error rate |
|---|---|---|---|
| read-heavy | < 300 ms | < 600 ms | < 1 % |
| write-heavy | < 800 ms | < 1500 ms | < 5 % |
| auth-bruteforce | n/a | n/a | > 50 % (mostly 401s/429s; add `RATE_LIMITS_ON=1` to also assert 429s) |
