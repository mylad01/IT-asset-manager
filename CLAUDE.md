# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IT Asset Manager — a studio/property IT asset tracking app. React 19 + Vite SPA frontend talking to an Express 5 REST API backed by a single SQLite (WAL mode) database. Everything is ESM (`"type": "module"`); PM2 config is the one `.cjs` exception.

## Commands

**Development** (two processes — both required):
- `npm start` — API server on `http://localhost:3000` (auto-detects and kills stale lock processes via `npm run kill` before starting)
- `npm run dev` — Vite frontend on `http://localhost:5174` with HMR

**Lint**: `npm run lint` (oxlint; config in `.oxlintrc.json`)

**Build**: `npm run build` (outputs to `dist/`)

**Database**:
- `npm run reset:db` — wipe + recreate schema + full reseed (departments, asset types, root admin, all 6 test users, 25 assets). Refuses to run when `NODE_ENV=production`.
- `npm run db:migrate` / `npm run db:migrate:status` — Umzug migrations (also run automatically on server boot via `getDb()`)
- `npm run seed:users` / `seed:tickets` / `seed:bulk` / `reseed:admin`

**Verification scripts** — there is NO test runner (no jest/vitest). Verification is standalone Node scripts run manually:
- `node scripts/testDatabase.js` — connection, migrations, query timeouts, transaction rollback
- `node scripts/testLogging.js` — Pino logging, redaction, request-ID correlation
- `node scripts/testAuthLimiter.js` — auth rate-limiter contract: failed-attempts-only + email/IP keys (own :3989, temp DB, AUTH_RATE_LIMIT_MAX=5)
- `node scripts/testSecurity.js` — validation, auth, rate limiting (needs server running on :3000)
- `node scripts/testProcessManagement.js` — PM2 lifecycle, lock-file handoff
- `node scripts/testLifecyclePanel.js` — UI regression for the Settings lifecycle panel: debounced saves, Saved tick, run-now confirm modal (needs dev stack on :3000 + :5174)
- `node scripts/testDiskStatusBanner.js` — UI regression for the disk-status banner: amber/red escalation, dismissal TTL, recovery auto-clear; intercepts the API, touches no data (needs dev stack on :5174)
- `node scripts/testTicketBadge.js` — ticket-linked badge E2E: seeds a real ticket-linked conversation via the API, asserts the amber sidebar badge + header chip in the browser (no stray `0`), then soft-deletes AND purges the seed with proof — self-cleaning (needs stack on :3000 + :5174).
- `node scripts/testLeaveContract.js` — leave schema ⇄ validator vocabulary contract (`LEAVE_STATUSES` ⇄ `sqlite_master` CHECK literals, `LEAVE_DECISIONS` = statuses − Pending; no server).
- `node scripts/testLeaveUploads.js` — leave upload allowlist/content matrix + `privateUploadsGuard` path-bypass units (isolated temp `UPLOADS_DIR`; no server).
- `node scripts/testLeaveDates.js` — `shared/leaveDates.js` date-math units (leap/rollover/inclusive ranges/Sunday-first matrix; no server).
- `node scripts/testLeaveFrontendUpload.js` — client dropzone magic-byte guard ⇄ server `validateLeaveFile` policy contract (no server).
- `node scripts/testLeaveRequests.js` — leave workflow API contract: dept-scoped inbox, overlap 409, decide guards, attachment auth matrix, guard 404 proofs (needs :3000).
- `node scripts/testLeaveUiSmoke.js` — leave UI regression: role plumbing, `/leave`, `/leave-approvals`, sidebar badge, deep links (needs :3000 + :5174).
- `node scripts/testDataTableFirstLoad.js` — DataTable first-load regression gate (`npm run test:tables`): every DataTable-backed page (users-admin, assets, storage, user-assets, my-assets, helpdesk, my-tickets) must render rows on a FRESH load while its backing API is non-empty; /api/ GETs are delay-intercepted (~600ms passthrough, real server answers) so the table always mounts BEFORE its data — the deterministic form of the 2026-10-12 stale-memo bug the DataTable useMemo ref-cache caused; strict row===count on the raw-array pages, empty-state-checked invariant elsewhere, read-only on data; phase 2 (`TABLE_PHASE=parallel` runs it alone) delays /api/users far past its Promise.all sibling on users-admin to gate the ref-counted useApi isLoading — the loading gate must hold until EVERY parallel response lands (needs dev stack on :3000 + :5174).
- `node scripts/testAllApi.mjs` — full-API sweep: every endpoint as admin + Staff + Read-Only (the Read-Only phase asserts 200 on page-backing GETs and 403 on writes/admin-only GETs; needs server running on :3000)
- `node scripts/testAbortCleanup.mjs` — abort-safety contract for testAllApi's seed hygiene: generates an injected-throw probe copy of the CURRENT testAllApi per seeder phase (asset/user/kit/consumable/type/leave), runs each against an isolated instance (own :3993, seeded temp DB, restarted per probe for fresh in-memory limiters — `LOAD_TEST_MODE=1` is unusable here because it force-overrides `DB_PATH` to the shared load-test DB), and asserts the abort fired with the seed observable beforehand plus all seven fixed identifiers absent afterward (self-contained, no dev stack).
- `node scripts/testConversations.js` — conversation workspace API: messages, reactions, participants, archive, export, role guardrails (needs server running on :3000)
- `node scripts/testConversationTypeContract.js` — conversations.type schema ⇄ validator contract: migration `up()`/`down()` against both legacy CHECK shapes (restores downgraded rows, unlinks duplicate ticket chats, enforces `uq_conversations_ticket`) plus zod parity — the CHECK literals, the create enum, and the query-filter enum must be the same set (no server; in-memory DB).
- `node scripts/testThemeContrast.js` — WCAG contrast floors for every theme preset's token pairs (parses index.css's cascade layers itself, no server); wired into `test:all` — floors are shipped-baseline regression gates, below-AA values print as WARN debt.
- `node scripts/testTrendPresets.js` — UI regression for the trend theme presets: gallery renders every registry label, Noir/Matcha/Aurora/Slate clicks apply their `[data-theme]` token blocks (computed `--glass-bg`/`--sidebar-text`), Matcha survives reload via pre-paint, original theme restored (needs dev stack on :3000 + :5174).
- `node scripts/testConversationBackup.js` — conversation backup: zip contents, history log, auto-backup settings (needs server running on :3000)
- `node scripts/testBackupRestoreDrill.js` — backup RESTORE drill: extracts a real backup ZIP, boots an isolated instance (:3120) on the restored DB, verifies integrity/auth/counts/attachments + reboot survival (`npm run test:restore`; catches migration-replay bugs the creation-side suite cannot see). Also verifies the ZIP's SHA256SUMS manifest (all entries + tool cross-check + tamper detection).
- `test-security.ps1` — PowerShell security sweep

**Load testing** (k6, must be installed separately — see `scripts/loadTests/README.md`):
- `npm run test:server` — isolated server on :3100 using `scripts/loadTests/.runtime/database.loadtest.sqlite` (`LOAD_TEST_MODE=1` disables rate limiters)
- `npm run load:read` / `load:write` / `load:auth`
- The load-test DB is the only one load traffic touches; never point it at the dev DB.

**Production (PM2)**: `npm run start:prod`, `reload` (zero-downtime), `stop`, `restart`, `status`, `logs`, `monit`.

**Lock management**: `npm run kill` — interactive terminal UI to detect and kill stale server processes blocking startup.

**Delivery**: `npm run clean:delivery` — stop the dev stack, wipe runtime state (uploads, logs, root `*.log`, `backups/`, `dist/`, stale `delivery/`, `scripts/.runtime/*.bak`, `%TEMP%sb3`), reseed via `reset:db`, then zip the project to `delivery/it-asset-manager.zip` (excludes `node_modules/`, `.env`, `logs/`, `*.zip` — `.env.example` always ships) and read the archive back to assert it. Flags: `--dry-run`, `--no-stop`, `--strip-env` (also delete `.env` from the project), `--keep-env`.

## Architecture

### Backend layering (`server/`)

Request flow: `routes/*Routes.js` → middleware chain → `controllers/*Controller.js` → `services/*Service.js` → `models/*Model.js` → SQLite.

- **`routes/index.js`** mounts all sub-routers under `/api`. Route files chain middleware inline: `verifyToken` → `requireAdmin` → `writeLimiter` → `validate(schema)` → `upload` (multer) → controller. Order matters within a route file too (e.g. `/:id/preview` must be declared before `/:id`). A `/api/health` endpoint is mounted before the setup gate and returns DB health status.
- **`middleware/`**: `authMiddleware.js` (JWT verify + role checks), `validate.js` (Zod — puts parsed result on `req.validated`), `rateLimiters.js` (global/auth/read/write limiters; all become no-ops in `LOAD_TEST_MODE=1`; the auth limiter counts only FAILED logins and keys on `email|ip` — PLAN.MD §16.5 F4, contract-tested by `scripts/testAuthLimiter.js`), `errorHandler.js` (central: maps AppError/ZodError/JWT/multer errors to HTTP codes — must stay last), `requestLogger.js` (pino-http), activity log audit trail via `activityLogService.logChange()` in business services.
- **`services/`** hold business logic and wrap multi-step writes in `withTransaction(db, fn)` (`server/db/transactions.js` — `BEGIN IMMEDIATE`/COMMIT/ROLLBACK). Never hand-roll BEGIN/COMMIT in new code.
- **`models/`** are pure data access. Everything gets the DB via `await getDb()` from `server/database.js`.

### Database boot & resilience (`server/db/`)

`getDb()` (in `server/database.js`) is the single entry point: `connectionManager.connect()` (PRAGMAs: WAL, busy_timeout, foreign_keys; startup integrity check) → `runMigrations()` (Umzug, tracked in `_migrations` table) → `createTimedDb()` proxy (per-query timeout, default 5s). Isolated instances (test harnesses) can set `APP_LOCK_FILE` to use their own PID lock instead of the shared `logs/.app.lock`. Migrations live in `server/db/migrations/` as `<timestamp>-<name>.js` exporting `up(db)`/`down(db)`.

**Single-writer constraint**: SQLite WAL allows one writer only. The server takes a PID lock file (`logs/.app.lock`) so two instances can't open the same DB; PM2 must run in fork mode with `instances: 1` (see `ecosystem.config.cjs`). Graceful shutdown (SIGINT/SIGTERM) drains HTTP → releases lock → checkpoints WAL → exits.

### Auth & roles

- JWT in `Authorization: Bearer` header. Frontend stores it in localStorage (`studioToken`/`studioUser`) and attaches via the central API client.
- Roles: `'IT Admin'`, `'Read-Only'`, `'Staff'`. Backend guards: `verifyToken` → `requireAdmin` → `requireRoot`.
- **Root admin is identified by hardcoded email** `admin@studio.com` (`authService.js` sets `isRoot` in the JWT) — seeded password `admin`. `npm run reset:db` and `scripts/seedTestUsers.js` seed the same **6 accounts**: root `admin`/`admin`; `admin1`/`admin2`/`staff1`/`staff2` all `12345678`; Read-Only `readonly1@studio.com`/`readonly1234` (`testAllApi` logs in as that Read-Only user, so a reseed that omits it fails the sweep). Login rate limit defaults to 5 per 15 min; `.env` raises it to 30 for dev.

### Frontend (`src/`)

- `App.jsx` does **all role-based routing** — pages are conditionally registered per role (Staff → my-assets/my-tickets; Read-Only adds scan/kits/consumables/types/activity; IT Admin adds everything). No route guard library.
- `src/utils/apiClient.js` is the **only sanctioned way to call the API** — auto JWT header, 401 → clear token + redirect `/login`, 429 → backoff retry (never retried for login), consistent `{ ok, status, data, error }` shape. Components should not use raw `fetch()`.
- `useApi()` hook (`src/hooks/useApi.js`) wraps apiClient with loading/error state for components.
- Contexts: `AuthContext` (user/token/`requires_password_change`), `ThemeContext` (dark/light). Tailwind v4 + framer-motion animations + glassmorphism components in `src/components/glass/`.
- Scrollable panes use the shared `ScrollArea` primitive (`src/components/glass/ScrollArea.jsx`): wrapper (layout, edge shadows, conditional `tabIndex`) + viewport (`h-full overflow-y-auto glass-scrollarea`) split. The scrollbar LOOK is a global layer in `index.css` — slim 6px thumb in both axes for WebKit, `scrollbar-width/color` for Firefox, colors derived from each theme's tokens; the old opt-in `.custom-scrollbar` class is retired, so never reintroduce per-container scrollbar CSS. New scroll panes: wrap in `ScrollArea`, layout classes → `className`, padding/content → `contentClassName`.
- `src/utils/dynamicFields.js` maps asset types (Camera, Workstation, Laptop, Monitor, Tablet, Audio Gear) to their type-specific form fields.
- **Colors are semantic tokens (doctor check #18 enforces)**: `src/` never
  names a Tailwind palette class (`bg-amber-500` is a [fail]) — it uses
  `-[color:var(--token)]` arbitrary values backed by the `:root` tokens in
  `src/index.css`. Tiers: `-hi`=300, base=400, `-strong`=500, `-deep`=600,
  `-darker`=700, `-darkest`=800/900. Families: `--status-danger` (red),
  `--status-success` (emerald; green merged), `--status-warning` (amber;
  orange merged), `--status-info` (blue — also the link color), `--ui-*`
  hue-preserving decorative tones, `--ui-neutral` (gray; slate/zinc merged).
  Gate: `scripts/lib/semanticColorGate.js` (in `npm run doctor -- --fast`)
  also bans template-built classes (`bg-${x}-500` — Tailwind never sees
  them) and undefined token refs; `src/components/TicketExport.jsx` is the
  print/PDF allowlist. Per-item dynamic colors use complete semantic class
  strings in a meta map instead (see TYPE_META / PRIORITY_META in
  CalendarPage — template-built or var()-indirected classes dodge the light
  override layer); the one genuinely dynamic value (Toggle's accent in
  LayoutAndMotionSection) uses a static arbitrary class + an inline custom
  property. The light-brightness override
  layer in `index.css` keys off the escaped semantic selectors — keep the
  two in sync.
- Uploaded asset images go to `uploads/`, served statically at `/uploads/*` (multer, 5MB cap).

### Environment

`.env` at root (loaded via `server/config/env.js` — the typed config object; always read config through `env`, not `process.env` directly — this is load-bearing for the "0 disables" knobs: `DB_WAL_CHECKPOINT_INTERVAL_MS` / `DISK_WAL_CAP_MB` are strictly parsed in env.js, where a valid `0` is honored as disable and unset/blank falls back to the default; a raw `process.env` re-read elsewhere will silently disagree). Frontend API base URL comes from `VITE_API_BASE_URL` (defaults to `http://localhost:3000`). Meaningful knobs: `DB_QUERY_TIMEOUT_MS`, `DB_TRANSACTION_TIMEOUT_MS`, `DB_WAL_CHECKPOINT_INTERVAL_MS`, `AUTH_RATE_LIMIT_MAX`, `LOAD_TEST_MODE`/`LOAD_TEST_DB_PATH`. See `.env.example` (which ships `RESET_DB_ALLOW_LIVE` commented out — opt-in only).
Secrets are local-only: the root `.env` (gitignored) delivers `JWT_SECRET`
and tuning — no external secrets manager is involved. `npm start` /
`npm run dev` run their commands directly, and `server/config/env.js`
(dotenv) never overwrites an existing variable. Production must receive
`JWT_SECRET` through the host's `.env` — see `docs/production-checklist.md` §2.

## Layering rules

Dependency arrows only point DOWN this tree — never from production into
dev tooling, and never upward within a layer:

```
src/            (React frontend — imports nothing from server/ or scripts/)
server/         (production API)
  index.js → routes → controllers → services → models   (strict order)
  utils/  ← anyone inside server/, but utils never import models/services/controllers
  db/     ← services/models/scripts (connection, archiveDb, transactions)
scripts/        (dev tooling, QA suites — may import server/ DOWN, one level)
tests/          (shared HTTP helpers only — no server/ or scripts/ imports)
```

The rules the codebase actually enforces (kept true by the 2026-09-27
layering sweep, which promoted two modules out of scripts/ for exactly
these reasons):

1. **Production never imports `scripts/` or `src/`.** Anything production
   needs lives in `server/utils/`. When a scripts/ module is (or becomes)
   a production dependency, PROMOTE it — as happened to `appLock.js` and
   `liveApiGuard.js` (both now `server/utils/`); scripts import them DOWN.
2. **Scripts import from `server/` at limited depth**: `server/utils/*`
   (appLock, liveApiGuard), `server/db/*` (connection, archiveDb,
   transactions, queryTimeout), `server/database.js` (boot for seeder
   scripts), and — white-box, benchmarks/measurement only —
   `server/services/*` (`scripts/.runtime/bench-archive.mjs`). Never
   `server/routes/` or `server/controllers/`.
3. **`server/index.js` is an entrypoint, not a library** — scripts that
   "use the server" spawn it as a process with `PORT/DB_PATH/APP_LOCK_FILE`
   env, they never import it (its module body acquires locks and starts
   listeners).
4. **In-server arrows are one-way**: routes → controllers → services →
   models. Models never import services; services never import controllers
   or routes; `utils/` never imports upward.
5. **Browser-context imports inside `page.evaluate(...)` are not Node
   dependencies** — a QA suite importing `/src/utils/apiClient.js` inside
   an evaluate block exercises the real frontend through Vite and is
   intentional (see testDiskStatusBanner.js).
6. **New shared cross-boundary helpers go to `server/utils/` first** —
   scripts reaching for a new server/ module should ask whether the
   module belongs there (it usually does); the reverse (server importing
   scripts/) is always wrong.

If oxlint or a sweep suggests an import that would point an arrow upward,
promote/move the module instead of adding an exemption. This is enforced:
doctor check #12 (`Layering: import direction`) scans all three trees and
fails when server/ imports from scripts/ or src/, when src/ imports from
server/ or scripts/, or when scripts/ imports from src/ (relative or
Vite-absolute `/src/…` outside `page.evaluate`, whose browser-context
imports are exempt) — so `npm run doctor` and the `test:all` gate catch
upward arrows automatically. The scanner is a small lexer (strings,
templates, comments, regex literals, evaluate groups), not a raw regex:
fixture-building code and comments contain import-looking text that must
not count.

Circular imports are enforced too (check #13, `Server import cycles`): a
static cycle inside server/ is a module-init-order hazard and FAILS the
doctor; the accepted way to break a genuinely two-way dependency is a lazy
dynamic import (`await import(...)` inside a function — as
`connection.js → diskSpaceService` does), and cycles whose back-edges are
lazy-only get a `[warn]` listing instead of a fail.

Broken relative specifiers are enforced by check #14 (`Import resolution`):
every relative import in server/, scripts/ and src/ — static or lazy — must
resolve to a real module file (explicit extensions: the exact file;
extensionless: `<spec>.js`/`.jsx` or `<spec>/index.js`/`.jsx`; a bare
directory without an index FAILS). Bare npm/node specifiers are out of
scope. Severity follows the blast radius: a server/ miss is `[fail]`
(production boot); scripts//src/ misses are `[warn]` (the broken QA script
or Vite build fails loudly at its own runtime — it must not gate the
whole sweep). `node --check` passes a typo'd specifier, so this is the
only static line of defense before boot (or the lazy import's call time)
surfaces it as a crash.

## Gotchas

- **Windows host** — ESM imports of absolute paths go through `pathToFileURL` (see `umzug-instance.js`); PM2 file logs are set to `/dev/null` (Pino owns rotation via pino-roll) and may behave oddly if changed.
- **Backup tamper-evidence is three-store** — every conversation backup carries the in-zip `SHA256SUMS` (accidental-corruption proof), a byte-exact sidecar `<zip>.SHA256SUMS` next to the ZIP, and the manifest's sha-256 in `conversation_backup_logs.manifest_hash_hex`. Deleting or regenerating the sidecar/hash is a detected regression (the restore drill asserts both from the ZIP, and one half without the other fails). `npm run verify:backup <zip>` checks all three stores from the shell — no dev server, no QA stack — and exits 1 (DO NOT TRUST) on any divergence; pre-feature backups verify via the embedded manifest with the degradation shown. The Settings backup-history UI surfaces the logged hash as a chip (legacy rows show a "pre-feature backup" badge). The dev server must be restarted after changing backup code — the drill's ZIP fallback silently exercises the OLD code path otherwise.
- The active dev DB is the root-level `database.sqlite` (relative `DB_PATH` resolves from the CWD you start the server in). Never create stray database files in `server/` or `scripts/`.
- `vite.config.js` ignores `*.sqlite*` and `uploads/**` from the watcher to stop hard reloads — keep it that way.
- **Release notes are generated, not hand-written** — `npm run release:notes` rewrites the header + Streams sections of RELEASE-NOTES.md from the commit subjects since the newest `rc*` tag (first-match-wins classifier; QA/toolchain patterns run first so suite/PLAN/release commits stay in Dev toolchain & QA even when their subjects mention a feature). Only the tail under the `hand-edited` marker is human-owned; everything else gets clobbered by design. `--check` mode is the pre-tag staleness gate.
- **Pre-push hook is per-clone, not versioned** — `.git/hooks` never clones, so run `npm run hooks:install` once in every fresh checkout (the clone DR drill initially missed this). The gate (`scripts/lib/prePushGate.js`) runs three checks per push: retired-keys (hard), `doctor --fast` (new code-shape profile of doctor — layering/cycles/resolution/guard-coverage/prefs-sync/falsy-JSX only, warns pass, [fail] blocks; environment probes deliberately excluded), and notes staleness (hard-blocks `rc*` TAG pushes only, warn-only for branches). Tag-ref detection from pre-push stdin must NOT be line-end anchored (stdin lines are `ref oid ref oid`).
- Route middleware order is load-bearing: CORS before rate limiter (so 429s carry CORS headers), error handler last, `/uploads` static before request logging.
- **Dev-mode logging is stdout-only — capture it or lose it** — `server/utils/logger.js` pretty-prints to stdout and only opens the `logs/*.log` streams in production mode; a harness that spawns a dev server with swallowed stdio makes the stack silently unobservable (the 2026-10-03 experiment lost hundreds of server warnings that way). Every harness spawn site (`testAll.spawnDetached`, `testDiskGuard.restoreMain`, walAB `restore-dev-api`) tees stdout+stderr to `logs/devstack.log` with a `===== <timestamp> <source> =====` marker — any new harness that starts a server must do the same.
