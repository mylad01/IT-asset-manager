#!/usr/bin/env node
/**
 * scripts/doctor.js — `npm run doctor` setup verification.
 *
 * One command a new developer runs after `npm install` to learn whether this
 * machine can actually run the QA toolchain in README.md ("Verification & QA").
 * It is a report, not a gate: every check prints [ok] / [warn] / [fail] with a
 * concrete next step, and the exit code is 1 only for [fail] items (things
 * that break even `npm start` or `npm run test:all` on a clean checkout).
 * Warnings cover optional tooling (k6, a system browser) and environmental
 * context (ports in use, free RAM) that the suites tolerate but document.
 *
 * Checks:
 *   1. Node.js version           (>= 20 recommended for Vite 8 / Express 5)
 *   2. node_modules sentinels    (did `npm install` actually finish?)
 *   3. QA toolchain files        (every script the npm scripts reference)
 *   4. k6 availability           (needed by load:* and bench:walab)
 *   5. System Chrome/Edge        (needed by test:ui via puppeteer-core)
 *   6. .env limits sanity        (rate limiter headroom, JWT_SECRET policy)
 *   7. Port occupancy :3000/:5174/:3100  (informational, via appLock parser)
 *   8. Free RAM                  (context for the load-test preflight bar)
 *   9. Dev database              (reachable read-only, admin@studio.com seeded)
 *  10. Live /api/health          (only when :3000 is already up — HEAD + payload sniff)
 *  11. DB-script guard coverage  (every DB-writing script imports the shared
 *      guard — server/utils/liveApiGuard.js)
 *  12. Layering: import direction  (server/ never imports scripts/ or src/;
 *      src/ never imports server/ or scripts/; scripts/ never imports src/ —
 *      page.evaluate browser-context imports exempt; CLAUDE.md "Layering rules")
 *  13. Server import cycles  (circular imports within server/: static cycles
 *      ⇒ [fail] — module-init order hazard; lazy-dynamic-only cycles ⇒ [warn]) * 14. Import resolution  (every relative import in server/, scripts/ and
 *      src/ — static or dynamic — resolves to a real module file; a miss in
 *      server/ ⇒ [fail] before npm start ever sees it, in the tooling or
 *      frontend trees ⇒ [warn]) *  15. UI prefs registry ⇄ schema sync  (PLAN.MD §13 P4: every user-scope
 *      registry key exists in the server zod mirror with matching type,
 *      enum values, int bounds and default; theme presets agree — the
 *      check-#11 guard-coverage idea applied to the prefs contract)
 *  16. Storage keys single-source  (scripts/lib/retiredKeysCheck.js — every
 *      client storage-key literal lives in its ONE owner module; also runs
 *      as the prebuild hook and inside the prefs sync test)
 *  17. First-boot seed expectations  (PLAN.MD §15 rc3 item 2: the auto-seed
 *      migration never seeds assets, `npm run seed:bulk` exists, README
 *      states the expected first-boot state; the dev DB's asset count is
 *      reported — 0 assets is the normal first-boot state, warned so the
 *      UI suites' inventory precondition stays visible)
 *  18. Semantic color tokens  (scripts/lib/semanticColorGate.js — src/ colors
 *      ONLY through the semantic status and ui tokens defined in index.css
 *      :root: no literal palette classes, no template-built ones, no
 *      undefined token references; the standing gate on the 2026-10-07
 *      palette sweep, print/PDF surface (TicketExport.jsx) allowlisted —
 *      runs in --fast too)
 *
 * Importable: `runDoctorChecks()` runs every check and returns the result
 * rows without exiting — testAll.js uses it as its pre-sweep doctor gate.
 * Executed directly (node scripts/doctor.js / npm run doctor) it prints the
 * full report and exits 1 on any [fail]. With `--fix` it additionally
 * creates .env from .env.example when .env is ABSENT (never overwrites) —
 * seeding QA-friendly rate limits (30/1000/300 with explanatory comments,
 * the template's own dev/testing recommendations) — re-checks, and prints
 * copy-paste commands for everything that must stay manual (installs, DB
 * reset/reseed, process kills).
 *
 * Secrets are never printed — only presence/absence of values.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { findListenerOwner } from '../server/utils/appLock.js';
import { checkPrefsSync } from './lib/prefsSyncCheck.js';
import { checkRetiredKeys } from './lib/retiredKeysCheck.js';
import { checkSemanticColors } from './lib/semanticColorGate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = [];

/** Read a key from the repo's .env (process env wins; cached). Inline
 *  comments and surrounding quotes are stripped. Null when unset. */
let ENV_CACHE = null;
function envGet(key) {
  if (ENV_CACHE === null) {
    const p = path.join(ROOT, '.env');
    ENV_CACHE = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  }
  if (process.env[key] !== undefined) return process.env[key];
  const m = ENV_CACHE.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'));
  if (!m) return null;
  return m[1].trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
}

/** Record one check result. Returns the status so callers can tally. */
function report(status, title, detail) {
  const badge = status === 'ok' ? '[ok]  ' : status === 'warn' ? '[warn]' : '[fail]';
  OUT.push({ status, title, detail });
  console.log(`${badge}  ${title}`);
  if (detail) console.log(`        ${detail.replace(/\n/g, '\n        ')}`);
  return status;
}

/** Promisified execFile that never throws. */
function run(cmd, args, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf-8', timeout: timeoutMs, windowsHide: true, cwd: ROOT },
      (err, stdout) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout ?? '').trim() }));
  });
}

// --- 1. Node version -------------------------------------------------------
function checkNode() {
  const [major] = process.versions.node.split('.').map(Number);
  const v = `Node ${process.versions.node} (${process.platform}-${process.arch})`;
  if (major >= 20) return report('ok', 'Node.js version', v);
  if (major >= 18) return report('warn', 'Node.js version', `${v} — works, but 20+ is recommended (Vite 8 / Express 5 target)`);
  return report('fail', 'Node.js version', `${v} — too old; install Node 20 LTS or newer from https://nodejs.org`);
}

// --- 2. node_modules sentinels ----------------------------------------------
function checkNodeModules() {
  const sentinels = ['vite', 'puppeteer-core', 'better-sqlite3', 'oxlint', 'express'];
  const missing = sentinels.filter((p) => !fs.existsSync(path.join(ROOT, 'node_modules', p)));
  if (!missing.length) return report('ok', 'node_modules', `key packages present (${sentinels.join(', ')})`);
  return report('fail', 'node_modules', `missing: ${missing.join(', ')} — run \`npm install\` and retry`);
}

// --- 2b. sqlite3 native driver (ignore-scripts self-heal) -------------------
// The project .npmrc sets ignore-scripts=true so a plain `npm install`
// succeeds without a C++ toolchain. better-sqlite3/bcrypt load from bundled
// prebuilds with no install step; sqlite3 — the PRIMARY DB driver
// (server/db/connection.js, archiveDb.js) — normally fetches its binary in
// an install script, which the policy skips. The self-heal is the repo's
// own `postinstall`/`prestart`/`predev` npm scripts
// (scripts/lib/sqlite3DriverCheck.js — explicit npm scripts are never
// policy-blocked; root package lifecycle hooks ARE, so a bare install
// alone cannot run it). This check turns a missed heal into a loud [fail]
// with the one-line fix instead of a mystery bindings error at boot.
async function checkSqliteDriver() {
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'sqlite3'))) {
    return report('fail', 'sqlite3 driver', 'node_modules/sqlite3 missing — run `npm install` first.');
  }
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(path.join(ROOT, 'package.json'));
    req('sqlite3');
    return report('ok', 'sqlite3 driver', 'native binary loads (self-heal not needed)');
  } catch {
    return report('fail', 'sqlite3 driver', 'native binary missing (normal under the ignore-scripts install policy when the self-heal has not run yet) — run `npm run postinstall` (fetches the prebuilt binary via prebuild-install; no toolchain needed), or just `npm start` / `npm run dev` (their pre-hooks heal automatically).');
  }
}

// --- 3. QA toolchain files ----------------------------------------------------
function checkToolchainFiles() {
  const files = [
    'scripts/testAll.js',
    'scripts/testUiJourney.js',
    'scripts/loadTests/preflight.js',
    'scripts/loadTests/walAB.js',
    'scripts/loadTests/scenarios/read-heavy.js',
    'scripts/loadTests/scenarios/write-heavy.js',
    'scripts/loadTests/scenarios/auth-bruteforce.js',
    'server/utils/appLock.js',
    'scripts/releaseNotes.js',
    'scripts/lib/prePushGate.js',
    'scripts/lib/ledgerJanitor.js',
  ];
  const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (!missing.length) return report('ok', 'QA toolchain files', `${files.length} scripts referenced by npm run test:all / test:ui / load:* / bench:walab / release:notes all present`);
  return report('fail', 'QA toolchain files', `missing: ${missing.join(', ')} — the checkout is incomplete or on the wrong branch`);
}

// --- 4. k6 -----------------------------------------------------------------
async function checkK6() {
  const { code, stdout, stderr } = await run('k6', ['version']);
  if (code === 0) return report('ok', 'k6 load-test CLI', (stdout || stderr).split('\n')[0] || 'available');
  return report('warn', 'k6 load-test CLI', 'not found — `npm run load:read|write|auth` and `npm run bench:walab` will fail. Install from https://grafana.com/docs/k6/latest/set-up/install-v2/');
}

// --- 5. System browser for puppeteer-core -----------------------------------
function checkBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) {
    const via = found === process.env.CHROME_PATH ? 'CHROME_PATH' : 'standard install location';
    return report('ok', 'Browser for test:ui (puppeteer-core)', `${path.basename(found)} found via ${via}`);
  }
  return report('warn', 'Browser for test:ui (puppeteer-core)', 'no Chrome or Edge found — install Chrome, or set CHROME_PATH to a Chromium-family executable. `npm run test:ui` (and that suite inside test:all) will fail without it.');
}

// --- 6. .env limits ----------------------------------------------------------
function checkEnv() {
  const envPath = path.join(ROOT, '.env');
  const hasEnvFile = fs.existsSync(envPath);

  const auth = envGet('AUTH_RATE_LIMIT_MAX');
  const global_ = envGet('GLOBAL_RATE_LIMIT_MAX');
  const read = envGet('READ_RATE_LIMIT_MAX');
  const jwt = envGet('JWT_SECRET');
  const nodeEnv = envGet('NODE_ENV');
  const issues = [];
  const notes = [];

  // No .env file and nothing in the process environment either — there is
  // nothing to evaluate, so explain which of the two reasons applies.
  if (!hasEnvFile && auth === null && global_ === null && read === null && !jwt) {
    return report('warn', '.env file', 'not present — the server runs on built-in defaults. Copy .env.example to .env if you need custom limits or secrets.');
  }

  // Rate limiter headroom: the QA suites log in repeatedly; a tight window
  // turns test:all into a 429 cascade (the suites retry, slowly).
  if (auth !== null && Number(auth) < 20) issues.push(`AUTH_RATE_LIMIT_MAX=${auth} is tight — only failed logins count now (email+IP keys), but the suites still burst wrong-password checks; 20+ avoids 429 waits`);
  if (global_ !== null && Number(global_) < 300) issues.push(`GLOBAL_RATE_LIMIT_MAX=${global_} is below the 300 default — API suites may trip it`);
  if (read !== null && Number(read) < 60) issues.push(`READ_RATE_LIMIT_MAX=${read} is below the 60 default — UI journey reads may throttle`);

  // JWT policy mirrors server/config/env.js.
  if (!jwt) {
    if (nodeEnv === 'production') issues.push('JWT_SECRET is unset and NODE_ENV=production — the server will refuse to boot');
    else notes.push('JWT_SECRET unset — dev fallback in use (fine locally, never in production)');
  }

  const summary = `AUTH_RATE_LIMIT_MAX=${auth ?? '(default 5)'} · GLOBAL_RATE_LIMIT_MAX=${global_ ?? '(default 300)'} · READ_RATE_LIMIT_MAX=${read ?? '(default 60)'}${notes.length ? ` — ${notes.join('; ')}` : ''}`;
  if (issues.length) return report('warn', '.env limits', `${issues.join(' · ')}`);
  return report('ok', '.env limits', summary);
}

// --- 7. Ports -----------------------------------------------------------------
async function checkPorts() {
  const results = [];
  let worst = 'ok';
  let pid3000 = null;
  for (const port of [3000, 5174, 3100]) {
    const pid = await findListenerOwner(port);
    if (port === 3000) pid3000 = pid;                // Consumed by the /api/health probe
    if (pid === null) {
      results.push(`:${port} free`);
      continue;
    }
    const role = port === 3000 ? 'dev API' : port === 5174 ? 'Vite dev server' : 'load-test server';
    const nodeish = await isNode(pid);
    if (port === 3100) {
      results.push(`:${port} in use (pid ${pid}${nodeish ? '' : ', non-node'}) — a load-test server is still up; preflight wants it fresh, stop it with \`npm run kill\` or scripts/kill-server.js`);
      worst = 'warn';
    } else {
      results.push(`:${port} in use (pid ${pid}${nodeish ? '' : ', non-node'}) — ${role} already running`);
    }
  }
  const status = report(worst, 'Ports 3000 / 5174 / 3100', results.join(' · '));
  return { status, pid3000 };
}

async function isNode(pid) {
  if (process.platform === 'win32') {
    const { stdout } = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    return /node\.exe/i.test(stdout);
  }
  const { stdout } = await run('ps', ['-p', String(pid), '-o', 'comm=']);
  return /node/i.test(stdout);
}

// --- 8. Free RAM ----------------------------------------------------------------
function checkRam() {
  const freeGb = os.freemem() / 1024 ** 3;
  const line = `${freeGb.toFixed(2)} GB free of ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`;
  if (freeGb >= 2) return report('ok', 'Free RAM (load-test context)', `${line} — above the preflight's 2 GB bar (PREFLIGHT_MIN_FREE_RAM_MB)`);
  return report('warn', 'Free RAM (load-test context)', `${line} — below the preflight's 2 GB bar; k6 scenarios will refuse to start until memory frees up (close Chrome tabs, or override with PREFLIGHT_MIN_FREE_RAM_MB)`);
}

// --- 9. Dev database (read-only; admin@studio.com seeded?) ------------------------
// Mirrors the DB_PATH resolution of server/config/env.js (LOAD_TEST_DB_PATH
// override then DB_PATH then ./database.sqlite) without importing the
// module — importing would execute dotenv/config side effects. The query is
// SELECT-only on a separately opened connection; it never writes, so it is
// safe next to a running dev server (WAL allows one extra reader).
function resolveDevDbPath(root = ROOT) {
  if (envGet('LOAD_TEST_DB_PATH')) return path.resolve(root, envGet('LOAD_TEST_DB_PATH'));
  if (envGet('DB_PATH')) return path.resolve(root, envGet('DB_PATH'));
  return path.join(root, 'database.sqlite');
}

async function checkDevDatabase() {
  const dbPath = resolveDevDbPath();
  if (!fs.existsSync(dbPath)) {
    return report('warn', 'Dev database', `${path.relative(ROOT, dbPath)} not found yet — it is created on first \`npm start\` (or \`npm run reset:db\`). UI/API suites need it seeded.`);
  }
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
      if (!hasUsers) return report('fail', 'Dev database', `${path.relative(ROOT, dbPath)} exists but has no users table — run \`npm run reset:db\` to (re)create the schema.`);
      const admin = db.prepare("SELECT id, role FROM users WHERE email = 'admin@studio.com'").get();
      if (!admin) return report('fail', 'Dev database', `admin@studio.com not seeded in ${path.relative(ROOT, dbPath)} — run \`npm run reseed:admin\` (all QA suites log in with it).`);
      const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      return report('ok', 'Dev database', `${path.relative(ROOT, dbPath)} reachable (read-only), admin@studio.com seeded (role: ${admin.role}), ${users} user(s)`);
    } finally {
      db.close();
    }
  } catch (err) {
    return report('fail', 'Dev database', `could not open ${path.relative(ROOT, dbPath)} read-only: ${err.message} — another process may hold an exclusive lock, or the file is corrupt (\`npm run reset:db\` recreates it).`);
  }
}

// --- 10. Live /api/health (only when :3000 is already listening) --------------------
// The ports check reports WHICH process owns :3000; this probe verifies a
// node-owned :3000 actually ANSWERS like the dev API. A stale/non-node
// listener is deliberately not probed (its health payload would mislead).
async function checkLiveHealth(pid3000) {
  if (pid3000 == null) {
    return report('ok', 'Live /api/health (:3000)', 'skipped — :3000 not listening; test:all starts the API itself');
  }
  const nodeish = await isNode(pid3000);
  if (!nodeish) {
    return report('warn', 'Live /api/health (:3000)', `:3000 is held by pid ${pid3000} (non-node) — not probed; if this is not intentional, free the port with \`npm run kill\`.`);
  }
  try {
    const res = await fetch('http://localhost:3000/api/health', { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    if (res.status === 200) return report('ok', 'Live /api/health (:3000)', 'HEAD /api/health → 200 — dev API is answering');
    if (res.status === 503) {
      // 503 is a known transient during boot/WAL checkpointing; try to say why.
      try {
        const body = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
        const q = body?.db_queue;
        const avg = q?.avgMs ?? q?.avg;
        const max = q?.maxMs ?? q?.max;
        const qTxt = avg != null ? ` — db_queue avg ${Number(avg).toFixed(1)}ms, max ${max != null ? Number(max).toFixed(1) : '?'}ms` : '';
        return report('warn', 'Live /api/health (:3000)', `HEAD → 503 (${body?.error || body?.status || 'degraded'})${qTxt}. Known transient while the server boots or checkpoints; re-run doctor if it persists.`);
      } catch {
        return report('warn', 'Live /api/health (:3000)', 'HEAD → 503 — server is degraded (503s are expected during boot/restart); re-run doctor if it persists');
      }
    }
    return report('warn', 'Live /api/health (:3000)', `HEAD → ${res.status} — unexpected status from the dev API`);
  } catch (err) {
    const why = err?.name === 'AbortError' ? 'timeout' : (err?.cause?.code || err.message);
    return report('fail', 'Live /api/health (:3000)', `pid ${pid3000} listens on :3000 but the health endpoint is unreachable (${why}) — the process may be wedged; try \`npm run kill\` then \`npm start\`.`);
  }
}

// --- 11. DB-script guard coverage -------------------------------------------------
// Every DB-writing script's first act must be the shared live-API guard
// (server/utils/liveApiGuard.js): refuse while the dev API serves :3000 or a
// ghost node process holds the dev DB without a listener. A new script that
// skips the guard silently reintroduces the resetDb-wedges-the-server race
// the guard exists to prevent — so the doctor enforces the import
// mechanically. Candidate detection is heuristic (there is no reliable way
// to know a script writes the DB without running it):
//   strong — imports the server's own connection layer
//            (server/db/connection.js / server/database.js) or is named
//            seed*/reseed*/reset*/migrate* ⇒ [fail]
//   weak   — imports better-sqlite3 directly (could be a read-only report)
//            ⇒ [warn] asking for the guard or an exception-list entry
// Test suites (test*) are excluded: they manage their own sandbox DBs.

/** Scripts the heuristic over-matches: they look like DB writers but never
 *  touch the dev DB (read-only reports, backup tools…). Keep this list
 *  SHORT and commented — it exists so the heuristic can stay aggressive,
 *  never to smuggle a real writer past the guard. */
const GUARD_COVERAGE_EXCEPTIONS = [
  // scripts/verifyBackup.js — `npm run verify:backup <zip>`: read-only
  // tamper-evidence check (embedded manifest / sidecar / history-DB hash).
  // Opens the dev DB with better-sqlite3 READ-ONLY, exactly like the
  // doctor's own check #9 — it never writes.
  'scripts/verifyBackup.js',
];

export function collectUnguardedDbScripts(root = ROOT) {
  const dir = path.join(root, 'scripts');
  if (!fs.existsSync(dir)) return { strong: [], weak: [] };
  const strong = [];
  const weak = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f.startsWith('test')) continue;   // suites: sandboxed DBs by design
    const full = path.join(dir, f);
    if (!fs.statSync(full).isFile()) continue;
    if (GUARD_COVERAGE_EXCEPTIONS.includes(`scripts/${f}`)) continue;
    const src = fs.readFileSync(full, 'utf-8');
    if (/liveApiGuard/.test(src)) continue;                     // already guarded
    const nameHit = /^(seed|reseed|reset|migrate)/.test(f);
    const connHit = /server\/(db\/)?(connection|database)\.js/.test(src);
    if (nameHit || connHit) strong.push(`scripts/${f}`);
    else if (/better-sqlite3/.test(src)) weak.push(`scripts/${f}`);
  }
  return { strong, weak };
}

function checkGuardCoverage() {
  const { strong, weak } = collectUnguardedDbScripts();
  const note = (list) => list.map((f) => `\`${f}\``).join(', ');
  if (strong.length) {
    return report('fail', 'DB-script guard coverage',
      `${note(strong)} write the dev DB WITHOUT the shared live-API guard — copy the guard block from the top of scripts/resetDb.js (top-level await refuseIfDevApiLive('<name>') + exit 1). Without it, resets and bulk writes race the server's WAL handle (or a ghost holder's).`);
  }
  if (weak.length) {
    return report('warn', 'DB-script guard coverage',
      `${note(weak)} import better-sqlite3 directly — if any of them WRITE the dev DB, add the liveApiGuard block from scripts/resetDb.js (import server/utils/liveApiGuard.js); read-only tools belong in GUARD_COVERAGE_EXCEPTIONS in scripts/doctor.js.`);
  }
  return report('ok', 'DB-script guard coverage', 'every DB-writing script in scripts/ imports the shared live-API guard (liveApiGuard.js)');
}

// --- 12. Layering: import direction (all three boundaries) -------------------------
// server/ is PRODUCTION code; scripts/ is dev tooling; src/ is the frontend.
// If anything in server/ imports from scripts/ (or src/), a QA-layer refactor
// can break the server — the exact failure the appLock/liveApiGuard promotions
// fixed (their importers used to point UP from server into scripts). Enforced
// mechanically here so the rules in CLAUDE.md ("Layering rules") cannot
// silently rot. Three boundary rules, one scan:
//   server  → scripts/ or src/   ⇒ [fail]  (production must be self-contained)
//   src     → server/ or scripts/ ⇒ [fail]  (frontend talks HTTP, never imports
//                                          the backend — CORS + the API base URL
//                                          exist for exactly this reason)
//   scripts → src/ (relative or Vite-absolute) ⇒ [fail]  (Node tooling must not
//                                          reach into frontend sources; tests
//                                          import DOWN from server/ instead)
// Specifier rules per tree:
//   - server/, src/: only RELATIVE escapes (`../scripts/…` etc.) can violate —
//     bare specifiers are npm packages.
//   - scripts/: RELATIVE `../src/…` violates. The Vite-absolute `/src/…` form
//     is legitimate ONLY inside `page.evaluate(...)` — that code executes in
//     the BROWSER against Vite (testDiskStatusBanner.js imports
//     /src/utils/apiClient.js exactly so); everywhere else it is a Node-context
//     frontend import and a violation.
// A regex over raw source is NOT sufficient: import-looking text appears in
// string literals (QA suites build sandbox fixtures via fs.writeFileSync), in
// comments, and inside page.evaluate(…) — whose arrow-function argument is
// real JS SYNTAX in the file even though it executes in the browser. The
// scanner is therefore a minimal lexer: it tracks //, /* */, '…', "…", `…`
// (with ${…} nesting) and regex literals; suppresses balanced
// page.evaluate(…) argument groups; and matches import keywords only in CODE
// position. Known limitation (documented, not silent): imports whose
// specifier is built by string CONCATENATION are invisible to any literal
// scanner — the same blind spot eslint's no-restricted-imports has.
const LAYERING_SCAN_EXEMPT = [];

/** Specifier rules per source tree. `spec` is the raw import specifier. */
const LAYERING_RULES = [
  {
    tree: 'server',
    violates: (spec) => /^(?:\.\.\/)+(?:scripts|src)\//.test(spec),
    why: 'production imports UP',
    fix: 'Promote the module to server/utils/ and import DOWN from scripts.',
  },
  {
    tree: 'src',
    violates: (spec) => /^(?:\.\.\/)+(?:server|scripts)\//.test(spec),
    why: 'frontend imports the backend/tooling',
    fix: 'The frontend talks HTTP through the apiClient — never import server/ or scripts/. Shared logic belongs in src/utils/.',
  },
  {
    tree: 'scripts',
    // Relative escapes into src/ AND the Vite-absolute '/src/…' form outside
    // page.evaluate (bare specifiers are npm packages; `../server/…` imports
    // are the ALLOWED direction).
    violates: (spec) => /^(?:\.\.\/)+(?:src)\//.test(spec) || spec.startsWith('/src/'),
    why: 'Node tooling reaches into frontend sources',
    fix: 'Scripts import DOWN from server/ (utils/db) or test over HTTP — never import src/.',
  },
];

/**
 * Lex one source file into a code view safe for import matching.
 * Returns { code, strings } — `code` is the source with comments removed,
 * page.evaluate(…) groups removed, and every string/template literal's
 * CONTENT replaced by `\x00<idx>\x00`; `strings[idx]` holds that content.
 * An import specifier therefore survives into `code` ONLY when the
 * from/import( syntax around its placeholder is real code — fixture text,
 * comments and evaluate bodies never produce a matchable import.
 */
export function lexForImports(src) {
  const strings = [];
  let out = '';
  let i = 0;
  const n = src.length;
  let prevSig = '';                                  // last significant char (regex-literal heuristic)
  const isId = (c) => /[A-Za-z0-9_$]/.test(c);
  const readString = (quote) => {
    let j = i + 1;
    let content = '';
    while (j < n) {
      if (src[j] === '\\') { content += src.slice(j, j + 2); j += 2; continue; }
      if (src[j] === quote) break;
      content += src[j];
      j += 1;
    }
    return { content, end: j + 1 };                  // end past the closing quote
  };
  const readTemplate = () => {
    // Opaque scan: template text (incl. ${…} interpolations) never yields an
    // import specifier in this repo — sandbox fixtures are built from
    // template literals, which is exactly the content we must NOT scan.
    let j = i + 1;
    let content = '';
    let brace = 0;
    while (j < n) {
      if (src[j] === '\\') { content += src.slice(j, j + 2); j += 2; continue; }
      if (brace === 0 && src[j] === '`') break;
      if (src[j] === '$' && src[j + 1] === '{') { brace += 1; content += '${'; j += 2; continue; }
      if (brace > 0 && src[j] === '}') { brace -= 1; content += '}'; j += 1; continue; }
      content += src[j];
      j += 1;
    }
    return { content, end: j + 1 };
  };
  const readStringAt = (pos) => { const s = i; i = pos; const r = readString(); i = s; return r; };
  const readTemplateAt = (pos) => { const s = i; i = pos; const r = readTemplate(); i = s; return r; };
  const skipEvaluate = () => {
    // page.evaluate matched in code position; skip its balanced CALL group —
    // from the opening paren to its matching close, string-aware so quotes
    // and braces inside the argument cannot lie about depth. Works for every
    // argument shape (arrow function, template literal, quoted string): the
    // paren pair is the call's own delimiters, not the argument's.
    let j = i + 'page.evaluate'.length;
    while (j < n && /\s/.test(src[j])) j += 1;
    if (src[j] !== '(') return j;                    // not a call (e.g. bare identifier) — leave as-is
    let depth = 0;
    while (j < n) {
      const c = src[j];
      if (c === "'" || c === '"') { j = readStringAt(j).end; continue; }
      if (c === '`') { j = readTemplateAt(j).end; continue; }
      if (c === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j += 1; continue; }
      if (c === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j); j = e === -1 ? n : e + 2; continue; }
      if (c === '(') depth += 1;
      if (c === ')') { depth -= 1; if (depth === 0) return j + 1; }
      j += 1;
    }
    return n;
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i); i = e === -1 ? n : e + 2; out += ' '; continue; }
    if (c === "'" || c === '"') {
      const r = readString(c);
      strings.push(r.content);
      out += `\x00${strings.length - 1}\x00`;
      prevSig = c;                                   // a value — regex heuristic stays correct
      i = r.end;
      continue;
    }
    if (c === '`') {
      const r = readTemplate();
      strings.push(r.content);
      out += `\x00${strings.length - 1}\x00`;
      prevSig = c;
      i = r.end;
      continue;
    }
    if (c === '/' && !/\s/.test(src[i + 1] || ' ') && '(,=:[!&|?{};+-*%<>~^'.includes(prevSig)) {
      i = readRegexAt(i);                            // regex literal — contents skipped wholesale
      out += ' ';
      continue;
    }
    if (src.startsWith('page.evaluate', i) && !isId(src[i - 1] || ' ') && !isId(src[i + 'page.evaluate'.length] || ' ')) {
      i = skipEvaluate();
      out += ' ';
      prevSig = ')';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prevSig = c;
    i += 1;
  }
  return { code: out, strings };
  function readRegexAt(pos) {
    let j = pos + 1;
    let inClass = false;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (inClass) { if (src[j] === ']') inClass = false; }
      else if (src[j] === '[') inClass = true;
      else if (src[j] === '/') break;
      j += 1;
    }
    return j + 1;                                   // past closing / (flags consumed by the main loop)
  }
}

export function collectUpwardImports(root = ROOT) {
  const violations = [];
  let scanned = 0;
  const scanTree = (treeName, dirName) => {
    const dir = path.join(root, dirName);
    if (!fs.existsSync(dir)) return;
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(js|mjs|cjs|jsx)$/.test(entry.name)) continue;
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (LAYERING_SCAN_EXEMPT.includes(rel)) continue;
        scanned += 1;
        const { code, strings } = lexForImports(fs.readFileSync(full, 'utf-8'));
        // \x00 sentinels are built by lexForImports (never present in source);
        // spelled with String.fromCharCode so no control chars appear literally.
        // No quote group: the lexer's placeholder REPLACES the entire literal
        // including its quotes, so the sentinel abuts the from/import( keyword
        // directly.
        const NUL = String.fromCharCode(0);
        const re = new RegExp(`(?:from\\s*|import\\s*\\(\\s*)${NUL}(\\d+)${NUL}`, 'g');
        let m;
        while ((m = re.exec(code)) !== null) {
          const spec = strings[Number(m[1])];   // group 1 = placeholder index (quotes are part of the placeholder)
          const rule = LAYERING_RULES.find((r) => r.tree === treeName);
          if (rule.violates(spec)) violations.push({ file: rel, spec, rule: treeName, why: rule.why, fix: rule.fix });
        }
      }
    };
    walk(dir);
  };

  scanTree('server', 'server');
  scanTree('src', 'src');
  scanTree('scripts', 'scripts');
  return { violations, scanned };
}

function checkLayering() {
  const { violations, scanned } = collectUpwardImports();
  if (violations.length) {
    const detail = violations.map((v) => `\`${v.file}\` → ${v.spec}`).join(', ');
    const fixes = [...new Set(violations.map((v) => v.fix))].join(' ');
    return report('fail', 'Layering: import direction',
      `${detail} — ${fixes} (CLAUDE.md "Layering rules")`);
  }
  return report('ok', 'Layering: import direction', `${scanned} files scanned across server/ src/ scripts/ — all arrows point down`);
}

// --- 13. Server import cycles -------------------------------------------------
// Circular imports inside server/ are a module-INIT-ORDER hazard: with ESM
// static imports, a cycle means some module evaluates before its dependency's
// bindings are live — `const x = require(...)`-style TDZ crashes, or silently
// undefined bindings that only explode at request time. The convention in
// this codebase for genuinely two-way needs is the LAZY dynamic import
// (`await import(...)` inside a function — e.g. connection.js →
// diskSpaceService, database.js consumers): deferring evaluation to call time
// breaks the init hazard. The check therefore distinguishes:
//   - cycles whose edges are ALL (or partly) STATIC ⇒ [fail] — real hazard
//   - cycles whose back-edges are LAZY-DYNAMIC ONLY ⇒ [warn] — accepted
//     convention, but listed so the graph stays visible
// Node builtins (node:*) and bare npm specifiers cannot create in-server
// cycles and are ignored; migrations/ is skipped (each migration is a leaf
// loaded by umzug at runtime; including it would only add noise).
const CYCLE_SCAN_EXEMPT = [];

/**
 * Build the module graph of server/ from static imports and dynamic
 * import() calls. Returns { nodes, edges, scanned } where edges is a list
 * of { from, to, lazy } (lazy = back-edge via dynamic import inside a
 * function body — approximated here as 'any dynamic import()', which is
 * the load-bearing signal for the static/lazy distinction).
 */
export function collectServerImportGraph(root = ROOT) {
  const serverDir = path.join(root, 'server');
  const nodes = [];
  const edges = [];
  let scanned = 0;
  if (!fs.existsSync(serverDir)) return { nodes, edges, scanned };
  const byRel = new Map();                             // abs path → repo-relative posix
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'migrations') continue;     // leaf modules, umzug-loaded (see block comment)
        collect(full);
        continue;
      }
      if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      byRel.set(path.resolve(full), rel);
    }
  };
  collect(serverDir);
  for (const [abs, rel] of byRel) {
    if (CYCLE_SCAN_EXEMPT.includes(rel)) continue;
    scanned += 1;
    nodes.push(rel);
    const { code, strings } = lexForImports(fs.readFileSync(abs, 'utf-8'));
    const NUL = String.fromCharCode(0);
    const re = new RegExp(`(?:from\\s*|import\\s*\\(\\s*)${NUL}(\\d+)${NUL}`, 'g');
    let m;
    while ((m = re.exec(code)) !== null) {
      const spec = strings[Number(m[1])];
      if (!spec.startsWith('.')) continue;             // node:/npm — cannot cycle within server/
      // The placeholder's position (not m.index, which is the keyword start)
      // is what the lazy check looks behind from: dynamic imports read
      // `… import( <NUL>idx<NUL> )`, static read `… from <NUL>idx<NUL>`.
      const sentinelIdx = m.index + m[0].indexOf(NUL);
      const lazy = /import\s*\(\s*$/.test(code.slice(Math.max(0, sentinelIdx - 12), sentinelIdx));
      const resolvedAbs = path.resolve(path.dirname(abs), spec);
      const target = byRel.get(resolvedAbs);
      if (!target || target === rel) continue;         // external or self — self-imports are not a cycle hazard here
      edges.push({ from: rel, to: target, lazy });
    }
  }
  return { nodes, edges, scanned };
}

/**
 * Detect cycles in a directed graph (Tarjan-free variant: iterative DFS +
 * explicit stack; every back-edge found yields the current stack slice).
 * Returns canonical cycles: rotated so the smallest node name is first,
 * deduplicated, no single-node self-loops (none exist in a valid import
 * graph), each labelled with its kind: 'static' when ANY edge in the cycle
 * is static, else 'lazy'.
 */
export function detectImportCycles(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e);
  }
  const state = new Map();                             // 1 = on stack, 2 = done
  const stack = [];                                    // node path
  const edgeStack = [];                                // edgeStack[k] = edge that entered stack[k] (null for the DFS root)
  const cyclesByKey = new Map();                       // canonical key → cycle record
  const emit = (cycleNodes, cycleEdges) => {
    const rot = [...cycleNodes];
    const minIdx = rot.indexOf([...rot].sort()[0]);
    const canonical = [...rot.slice(minIdx), ...rot.slice(0, minIdx)];
    const key = canonical.join('→');
    const kind = cycleEdges.some((e) => !e.lazy) ? 'static' : 'lazy';
    const existing = cyclesByKey.get(key);
    if (existing) {
      // Same node set reachable via several paths: a static path ANYWHERE in
      // it is an init hazard — upgrade lazy classifications to static.
      if (existing.kind === 'lazy' && kind === 'static') existing.kind = 'static';
      return;
    }
    cyclesByKey.set(key, { nodes: canonical, kind, edgeCount: cycleEdges.length });
  };
  const visit = (start) => {
    // Explicit-stack DFS; edgeStack parallels the node stack so a back-edge
    // can reconstruct the FULL cycle (path edges + closing edge) — classifying
    // from the closing edge alone would misread a static path with lazy
    // back-edges (observed: G4).
    const callStack = [{ node: start, edges: (adj.get(start) || []).slice(), idx: 0 }];
    state.set(start, 1);
    stack.push(start);
    edgeStack.push(null);
    while (callStack.length) {
      const frame = callStack[callStack.length - 1];
      if (frame.idx >= frame.edges.length) {
        state.set(frame.node, 2);
        stack.pop();
        edgeStack.pop();
        callStack.pop();
        continue;
      }
      const edge = frame.edges[frame.idx++];
      const st = state.get(edge.to) || 0;
      if (st === 1) {
        // Back-edge: cycle = stack slice from edge.to to top, with the path
        // edges that entered each of those nodes + this closing edge.
        const from = stack.indexOf(edge.to);
        if (from !== -1) {
          const cycleNodes = [...stack.slice(from), edge.to];
          const cycleEdges = [...edgeStack.slice(from + 1), edge];
          emit(cycleNodes, cycleEdges);
        }
        continue;
      }
      if (st === 2) continue;                          // fully explored subtree
      state.set(edge.to, 1);
      stack.push(edge.to);
      edgeStack.push(edge);
      callStack.push({ node: edge.to, edges: (adj.get(edge.to) || []).slice(), idx: 0 });
    }
  };
  for (const node of adj.keys()) if (!state.get(node)) visit(node);
  return [...cyclesByKey.values()].sort((a, b) => a.nodes.length - b.nodes.length || a.nodes[0].localeCompare(b.nodes[0]));
}

function checkImportCycles() {
  const { nodes, edges, scanned } = collectServerImportGraph();
  const cycles = detectImportCycles(edges);
  const staticCycles = cycles.filter((c) => c.kind === 'static');
  const lazyCycles = cycles.filter((c) => c.kind === 'lazy');
  const fmt = (c) => c.nodes.join(' → ');
  if (staticCycles.length) {
    return report('fail', 'Server import cycles',
      `${staticCycles.length} static cycle(s) in server/ (${scanned} modules): ${staticCycles.map(fmt).join(' | ')} — circular STATIC imports evaluate modules before their dependencies' bindings are live. Break the cycle with a lazy dynamic import (await import(...) inside a function), as connection.js → diskSpaceService already does, or extract the shared piece.`);
  }
  if (lazyCycles.length) {
    return report('warn', 'Server import cycles',
      `${lazyCycles.length} lazy-dynamic-only cycle(s) — accepted convention (back-edges are runtime import() calls), listed for graph visibility: ${lazyCycles.map(fmt).join(' | ')}`);
  }
  return report('ok', 'Server import cycles', `${nodes.length} modules, ${edges.length} edges scanned — no circular imports`);
}

// --- 14. Import resolution (server/ + scripts/ + src/) --------------------------
// Check #13 reads the same import graph but only asks WHAT it connects;
// this check asks whether every edge lands on a real file. A typo in one
// relative specifier ('./backpuService.js') survives `node --check` — the
// file parses fine — and only explodes when the module is loaded: at server
// boot, at a QA script's runtime, or at the next Vite build. Catching it
// statically turns a runtime failure into a one-line doctor report.
// Scope: RELATIVE specifiers only (./x.js, ../db/connection.js). Bare
// specifiers ('express', 'adm-zip', 'fs') are npm/builtin resolution — a
// different failure mode, already visible the moment anything runs. All
// import syntaxes are extracted by the shared lexer, so strings/comments/
// evaluate bodies cannot produce phantom specifiers; the lazy distinction
// from #13 is irrelevant here and every edge resolves the same way.
// Resolution mirrors how each tree is actually loaded:
//   1. explicit extension: ./x.js | ./C.jsx | ./data.json → the exact file
//      (any extension is verifiable the same way — the file must exist)
//   2. extensionless specifier (src/'s Vite convention: './SearchableSelect'
//      → SearchableSelect.jsx): try <spec>.js, <spec>.jsx, then
//      <spec>/index.js, <spec>/index.jsx. A bare directory WITHOUT an index
//      must fail — silently treating it as resolved is exactly the bug this
//      check exists to catch. Side-effect imports (import './x.css') carry
//      no from/import( and are invisible to the lexer by design.
// Severity follows the blast radius: server/ ⇒ [fail] (production boot);
// scripts/ + src/ ⇒ [warn] (a broken QA script or Vite build is loud at its
// own runtime — it must not gate the whole sweep).
const RESOLUTION_SCAN_EXEMPT = [];

/** Trees the check covers, with the module extensions each contains.
 *  server/ + scripts/ are pure Node ESM (.js/.mjs/.cjs); src/ additionally
 *  holds .jsx. Order is the report order (production first). */
const RESOLUTION_TREES = [
  ['server', '\\.(js|mjs|cjs)$'],
  ['scripts', '\\.(js|mjs|cjs)$'],
  ['src', '\\.(js|mjs|cjs|jsx)$'],
];

/** One relative specifier's target must exist: an explicit-extension spec
 *  names the exact file (whatever the extension — .json/.css from-imports
 *  are verified the same way); an extensionless one probes the Node/Vite
 *  forms (.js, .jsx, dir index). A bare directory WITHOUT an index must
 *  fail — silently treating it as resolved is the bug this check catches. */
function fileExistsAsModule(abs) {
  const stat = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (/\.[a-z0-9]+$/i.test(abs)) return stat(abs);
  return stat(`${abs}.js`) || stat(`${abs}.jsx`)
    || stat(path.join(abs, 'index.js')) || stat(path.join(abs, 'index.jsx'));
}

/**
 * Collect relative imports in the scanned trees whose target does not exist
 * as a module file. Returns { missing, scanned, edges, byTree } where
 * missing is a list of { tree, file, spec, resolved } (repo-relative posix
 * paths), and edges/byTree count every resolved-OK relative import (sanity
 * metrics for the [ok] row and the regression suite).
 */
export function collectUnresolvedImports(root = ROOT) {
  const missing = [];
  let scanned = 0;
  let edges = 0;
  const byTree = {};
  for (const [tree, extRe] of RESOLUTION_TREES) {
    const treeDir = path.join(root, tree);
    byTree[tree] = { scanned: 0, edges: 0 };
    if (!fs.existsSync(treeDir)) continue;
    const files = [];
    const collect = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { collect(full); continue; }
        if (new RegExp(extRe).test(entry.name)) files.push(full);
      }
    };
    collect(treeDir);
    for (const abs of files) {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (RESOLUTION_SCAN_EXEMPT.includes(rel)) continue;
      scanned += 1;
      byTree[tree].scanned += 1;
      const { code, strings } = lexForImports(fs.readFileSync(abs, 'utf-8'));
      const NUL = String.fromCharCode(0);
      const re = new RegExp(`(?:from\\s*|import\\s*\\(\\s*)${NUL}(\\d+)${NUL}`, 'g');
      let m;
      while ((m = re.exec(code)) !== null) {
        const spec = strings[Number(m[1])];
        if (!spec.startsWith('.')) continue;             // node:/builtin/npm — not a file we can verify
        const resolvedAbs = path.resolve(path.dirname(abs), spec);
        if (fileExistsAsModule(resolvedAbs)) { edges += 1; byTree[tree].edges += 1; continue; }
        missing.push({ tree, file: rel, spec, resolved: path.relative(root, resolvedAbs).split(path.sep).join('/') });
      }
    }
  }
  return { missing, scanned, edges, byTree };
}

/** Verdict for one root's trees, printed via report(): server/ misses ⇒
 *  'fail' (production boot), scripts//src/ misses ⇒ 'warn' (the broken QA
 *  script or Vite build is loud at its own runtime), else 'ok'. Takes a
 *  root so the regression suite can exercise the severity split on
 *  sandboxes; exported for the same reason. */
export function checkImportResolution(root = ROOT) {
  const { missing, scanned, edges, byTree } = collectUnresolvedImports(root);
  const detail = (rows) => rows.slice(0, 10).map((x) => `\`${x.file}\` → ${x.spec} (${x.resolved} not found)`).join(', ');
  const more = (rows) => (rows.length > 10 ? ` — and ${rows.length - 10} more` : '');
  const counts = RESOLUTION_TREES.map(([t]) => `${t} ${byTree[t]?.scanned ?? 0}/${byTree[t]?.edges ?? 0}`).join(', ');
  const serverMisses = missing.filter((x) => x.tree === 'server');
  const toolMisses = missing.filter((x) => x.tree !== 'server');
  if (serverMisses.length) {
    return report('fail', 'Import resolution',
      `${serverMisses.length} relative import${serverMisses.length > 1 ? 's' : ''} in server/ point at no real file: ${detail(serverMisses)}${more(serverMisses)}. These parse fine but break at boot (or at the lazy import's call time) — fix the specifier, or create the missing module.\n(check #14; this check only reads files.)`);
  }
  if (toolMisses.length) {
    return report('warn', 'Import resolution',
      `${toolMisses.length} relative import${toolMisses.length > 1 ? 's' : ''} in ${[...new Set(toolMisses.map((x) => `${x.tree}/`))].join(' + ')} point at no real file: ${detail(toolMisses)}${more(toolMisses)}. The server boots, but the QA script / Vite build that loads the module fails at its own runtime — fix the specifier, or create the missing module.\n(check #14; this check only reads files.)`);
  }
  return report('ok', 'Import resolution', `${scanned} modules, ${edges} relative imports across ${counts} (scanned/resolved) — every target resolves to a real file`);
}

// --- 17. First-boot seed expectations (PLAN.MD §15 rc3 item 2) ------------------
/** The documented first-boot contract, verified where it is implemented:
 *  an empty-asset-table database is the NORMAL first-boot state.
 *    - the auto-seed migration (server/db/migrations/*auto-seed*.js) must
 *      never insert into `assets` — it seeds the dev root login (production
 *      boots the first-run setup wizard instead), the reference departments
 *      and the asset types;
 *    - `npm run seed:bulk` must still exist as the explicit asset step;
 *    - README.md must state the expectation (its absence is a [warn]: this
 *      row states the expectation either way, so the doctor never goes
 *      silent on it);
 *    - the dev DB's actual asset count is reported — 0 ⇒ [warn] with the
 *      `seed:bulk` nudge (the UI suites expect inventory).
 * A broken contract ⇒ [fail] with remediation: that is the state the rc3
 * milestone item 2 acceptance ("doctor or README states the expected
 * first-boot state") exists to keep true.
 *
 * Checks #15/#16 live in imported libs (prefsSyncCheck / retiredKeysCheck),
 * which is why this local definition carries the next number while sitting
 * after #14 in the file. `root` / `dbPath` / `report` are overridable so the
 * regression suite can point the check at a sandbox without touching the
 * real dev DB (testLiveApiGuard section J). */
export async function checkFirstBootSeed({ root = ROOT, dbPath, report: reportFn = report } = {}) {
  const EXPECTATION = 'expected first boot: the seeded dev login (production boots the first-run setup wizard instead), the reference departments and asset types, and 0 assets — inventory is only ever added explicitly (the app or `npm run seed:bulk`)';
  const problems = [];

  // (1) the documented explicit asset-seed step must exist.
  let pkgReadable = false;
  let hasSeedBulk = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    pkgReadable = true;
    hasSeedBulk = Boolean(pkg?.scripts?.['seed:bulk']);
  } catch (err) {
    problems.push(`package.json could not be read (${String(err.message).split('\n')[0]}) — cannot confirm \`npm run seed:bulk\``);
  }
  if (pkgReadable && !hasSeedBulk) {
    problems.push('`npm run seed:bulk` is missing from package.json — the documented step that adds assets after first boot is gone (restore the script, or change README\'s first-boot section to match)');
  }

  // (2) auto-seed exists and never seeds assets (a doc-vs-code drift class
  // only this check can see: nothing else reads the migration's intent).
  const migDir = path.join(root, 'server', 'db', 'migrations');
  const autoSeed = fs.existsSync(migDir)
    ? fs.readdirSync(migDir).filter((f) => f.includes('auto-seed')).sort()
    : [];
  if (!autoSeed.length) {
    problems.push('the auto-seed migration (server/db/migrations/*auto-seed*.js) is missing — a fresh DB would boot with no admin login, departments or asset types');
  } else if (/\binsert\s+(?:or\s+ignore\s+)?into\s+`?assets`?\b/i.test(fs.readFileSync(path.join(migDir, autoSeed[0]), 'utf-8'))) {
    problems.push(`${autoSeed[0]} inserts into \`assets\` — first boot would no longer be the documented empty-inventory state (keep assets out of auto-seed; \`npm run seed:bulk\` or manual entry owns inventory)`);
  }

  // (3) README states the expectation (warn on drift — see header comment).
  const readmePath = path.join(root, 'README.md');
  const docOk = fs.existsSync(readmePath)
    && /^#{2,3}\s+Expected first-boot state\b/m.test(fs.readFileSync(readmePath, 'utf-8'));

  // (4) the actual dev DB — read-only, same open style as check #9.
  const db = dbPath ?? resolveDevDbPath(root);
  const rel = path.relative(root, db) || db;
  let assets = null;
  let state = `${rel} not created yet (appears on first \`npm start\` or \`npm run reset:db\`)`;
  if (fs.existsSync(db)) {
    try {
      const { default: Database } = await import('better-sqlite3');
      const conn = new Database(db, { readonly: true, fileMustExist: true });
      try {
        const hasAssets = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assets'").get();
        assets = hasAssets ? conn.prepare('SELECT COUNT(*) AS n FROM assets').get().n : null;
      } finally {
        conn.close();
      }
      state = assets == null
        ? `${rel} (no assets table yet)`
        : `${rel}: ${assets} asset${assets === 1 ? '' : 's'}`;
    } catch (err) {
      state = `${rel} (asset count unavailable: ${String(err.message).split('\n')[0]})`;
    }
  }

  const notes = [...problems];
  if (!docOk) {
    notes.push('README.md has no "Expected first-boot state" section — restore it; the expectation must stay documented in both places');
  }
  if (assets === 0) {
    notes.push('0 assets is the first-boot state — expected right after a fresh DB; run `npm run seed:bulk` before the UI suites, which expect inventory');
  }

  const status = problems.length ? 'fail' : notes.length ? 'warn' : 'ok';
  const title = 'First-boot seed expectations';
  const detail = [EXPECTATION, `now: ${state}`, ...notes].join(' · ');
  reportFn(status, title, detail);
  return { status, title, detail };
}

// --- main -------------------------------------------------------------------------
/** --fix auto-repair: create .env from .env.example — but ONLY when .env is
 *  absent. An existing .env is user configuration and is never touched.
 *  [TEMPLATE] marker lines in the example are stripped from the copy.
 *  Returns a human note when a repair was made, else null. */
// QA-friendly rate limits seeded into a newly created .env — the template's
// own dev/testing recommendations. The defaults are QA-hostile: one sweep
// burns ~30 logins and turns a 5-attempt auth limiter into 429 cascades
// (the doctor's '.env limits' check flags exactly this).
const QA_RATE_LIMITS = [
  ['AUTH_RATE_LIMIT_MAX', '30'],
  ['GLOBAL_RATE_LIMIT_MAX', '1000'],
  ['READ_RATE_LIMIT_MAX', '300'],
];

function autoFixEnv(ctx = {}) {
  const root = ctx.ROOT || ROOT;
  const envPath = path.join(root, '.env');
  const examplePath = path.join(root, '.env.example');
  if (fs.existsSync(envPath)) return null;             // Never overwrite existing config
  if (!fs.existsSync(examplePath)) return null;        // Nothing to copy from
  let body = fs.readFileSync(examplePath, 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '[TEMPLATE]')
    .join('\n');

  // Seed QA-friendly rate limits: replace the template's values IN PLACE
  // (never duplicate keys) with a comment on each line saying why, so
  // nobody later "restores" the 5-attempt trap without knowing what it
  // does to the suites. Keys missing from a future template are appended.
  const seeded = [];
  for (const [key, value] of QA_RATE_LIMITS) {
    const re = new RegExp(`^${key}=([^\\n]*?)(\\r?)$`, 'm');   // (\r?) preserves CRLF endings
    if (re.test(body)) {
      body = body.replace(re, `${key}=${value}$2      # seeded by doctor: QA-friendly (template default trips the QA suites)`);
    } else {
      body += `\n${key}=${value}      # seeded by doctor: QA-friendly (key absent from template)`;
    }
    seeded.push(key);
  }

  fs.writeFileSync(envPath, body, 'utf-8');
  return `created .env from .env.example (${body.split('\n').length} lines, [TEMPLATE] markers stripped) with QA-friendly rate limits (${seeded.join(', ')}) — existing files are never overwritten`;
}

/** --fix manual steps: extract copy-paste commands from the checks' own
 *  remediation text (single source of truth — no second map to drift), for
 *  every non-ok row. Only commands are surfaced (npm/winget/node …); a row
 *  without an extractable command still lists its title so nothing is lost. */
function printManualFixes(rows) {
  const bad = rows.filter((r) => r.status !== 'ok');
  if (!bad.length) return;
  console.log('--fix manual steps (NOT performed automatically — installs, DB resets/reseeds and process kills stay manual):');
  const seen = new Set();
  for (const row of bad) {
    const cmds = [...new Set((row.detail || '').match(/`([^`]+)`/g)
      ?.map((c) => c.slice(1, -1).trim())
      .filter((c) => /^(npm |winget |node |brew |choco )/.test(c)) || [])];
    if (!cmds.length) {
      console.log(`  ${row.title} — see the [${row.status}] report above for the fix`);
      continue;
    }
    for (const c of cmds) {
      const key = `${row.title}|${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  ${row.title} → ${c}`);
    }
  }
}

// --- 18. Numeric-falsy JSX renders (check #18) ------------------------------
/**
 * `{cond && <X/>}` renders the LEFT side whenever it is a number: SQLite has
 * no boolean type, so `is_*` flags / ids / counts leave the API as numbers
 * and `{is_internal && <Note/>}` paints a literal "0" beside the content —
 * the 2026-10-05 stray-zero bug (ChatMessage's every bubble + ChatHeader's
 * title row shipped it). Booleans, strings, null and undefined render
 * nothing; only 0 / NaN print. Ternaries (`cond ? … : null`) and comparisons
 * (`n > 0 &&`) are always safe.
 *
 * Heuristic scope: JSX containers whose left operand's LAST segment looks
 * like a database column SQLite returns numeric — `is_*` flags,
 * `*_count / *_id / *_total / *_size / *_bytes`, `from_archive`, `quantity`.
 * snake_case is this repo's SQL convention; JS-side state booleans are
 * camelCase (`isOpen`, `hasMore`) and are deliberately out of scope so a
 * [fail] here never cries wolf. Line-oriented like the rest of doctor: the
 * `&&` must sit on the same line as the identifier.
 */
export function checkFalsyJsx({ root = ROOT, report: reportFn = report } = {}) {
  const TITLE = 'Numeric-falsy JSX';
  // Print through the injected reporter, but RETURN the row itself (like
  // checkFirstBootSeed): the suite's quiet reporter is a no-op, so returning
  // report()'s value would hand callers undefined.
  const emit = (status, detail) => { reportFn(status, TITLE, detail); return { status, title: TITLE, detail }; };
  const SRC = path.join(root, 'src');
  const NUMERIC_SEG = /^(?:is_[a-z][a-z0-9_]*|.*_(?:count|id|total|size|bytes|qty)|from_archive|quantity)$/;
  const JSX_GUARD = /\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*&&/g;
  const hits = [];
  let scanned = 0;

  const scanFile = (p) => {
    scanned++;
    const rel = path.relative(root, p).replace(/\\/g, '/');
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      JSX_GUARD.lastIndex = 0;
      let m;
      while ((m = JSX_GUARD.exec(line))) {
        const seg = m[1].split('.').pop();
        if (NUMERIC_SEG.test(seg)) hits.push(`${rel}:${i + 1} {\`${m[1]} && …\``);
      }
    });
  };
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(jsx|js)$/.test(entry.name)) scanFile(p);
    }
  };

  if (!fs.existsSync(SRC)) {
    return emit('warn',
      `src/ not found (${path.relative(root, SRC) || SRC}) — nothing to scan.\n(check #18; this check only reads files.)`);
  }
  walk(SRC);

  if (hits.length) {
    const shown = hits.slice(0, 8).join(', ');
    const more = hits.length > 8 ? ` — and ${hits.length - 8} more` : '';
    return emit('fail',
      `${hits.length} JSX guard(s) on a numeric database column: ${shown}${more}. SQLite returns 0/1 (ids, counts) as NUMBERS, so \`{is_internal && …}\` renders a literal "0" beside the content — use a ternary (\`cond ? … : null\`) or a comparison (\`n > 0 &&\`).\n(check #18; this check only reads files.)`);
  }
  return emit('ok',
    `${scanned} src files scanned — no \`{numeric && …}\` guards (ternaries and comparisons are safe)`);
}

/** Run every check and return the result rows. Never exits the process —
 *  the CLI wrapper below owns that, and testAll.js consumes the verdict
 *  directly. Each row is already printed as it runs (via report()).
 *
 *  fast=true runs ONLY the code-shape checks (layering, import cycles,
 *  import resolution, guard coverage, prefs sync, numeric-falsy JSX) — the
 *  deterministic
 *  scans a bad COMMIT can break. Environment probes (k6/browser/ports/
 *  live health/RAM/node_modules) are excluded: they are slow and describe
 *  the machine, not the push. This is the profile the pre-push gate runs. */
export async function runDoctorChecks({ title = 'npm run doctor — QA toolchain setup check', fast = false } = {}) {
  OUT.length = 0;                                      // Fresh rows per invocation
  console.log(`${title}${fast ? ' (fast profile — code-shape checks only)' : ''}\n`);

  if (fast) {
    checkGuardCoverage();
    checkLayering();
    checkImportCycles();
    checkImportResolution();
    checkFalsyJsx();
    await checkPrefsSync(report);
    checkSemanticColors(report);
    return { rows: OUT, pid3000: null };
  }

  checkNode();
  checkNodeModules();
  await checkSqliteDriver();
  checkToolchainFiles();
  await checkK6();
  checkBrowser();
  checkEnv();
  const ports = await checkPorts();
  await checkDevDatabase();
  await checkFirstBootSeed();
  await checkLiveHealth(ports.pid3000);
  checkRam();
  checkGuardCoverage();
  checkLayering();
  checkImportCycles();
  checkImportResolution();
  checkFalsyJsx();
  await checkPrefsSync(report);
  await checkRetiredKeys(report);
  checkSemanticColors(report);
  return { rows: OUT, pid3000: ports.pid3000 };
}

/** Ask a y/N question; anything but an explicit yes is NO. A 45s timeout
 *  answers NO so a non-interactive sweep can never hang on the prompt. */
async function confirm(prompt, timeoutMs = 45_000) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await Promise.race([
      rl.question(prompt).catch(() => ''),              // stdin closed/EOF → no
      new Promise((res) => setTimeout(() => res('n'), timeoutMs)),
    ]);
    return /^y(es)?$/i.test(String(answer).trim());
  } finally {
    rl.close();
  }
}

/** Create the dev database by running the repo's own reset script in a
 *  child process (it owns migrations + seeds; production refuses itself).
 *  Safe here ONLY because the registry gates it on the DB file being ABSENT
 *  and :3000 being free — there is nothing to destroy and no live writer.
 *  ctx.env lets tests redirect DB_PATH/LOG_DIR/… into a sandbox. */
function runResetDb(ctx = {}) {
  return new Promise((resolve) => {
    console.log('  running: node scripts/resetDb.js …');
    execFile(process.execPath, [path.join(ROOT, 'scripts', 'resetDb.js')],
      { cwd: ROOT, encoding: 'utf-8', timeout: 120_000, windowsHide: true, env: { ...process.env, ...(ctx.env ?? {}) } },
      (err, stdout) => {
        if (stdout) process.stdout.write(`${stdout.split(/\r?\n/).filter(Boolean).slice(-6).join('\n')}\n`);
        resolve(err
          ? `reset:db FAILED (${String(err.message || '').split('\n')[0]}) — fix manually with \`npm run reset:db\``
          : 'dev database created via reset:db (schema + migrations + seeds)');
      });
  });
}

/**
 * FIX_REGISTRY — one entry per consent-based auto-fix. Adding a new safe
 * fix = one entry here; the gate, --fix mode and the regression suite all
 * pick it up automatically. Contract:
 *
 *   id          unique stable key (appears in logs; suite asserts uniqueness)
 *   title       the check title this fix remediates (must match report rows)
 *   prompt      the y/N question shown before anything runs
 *   applies(rows, ctx) → boolean — the fix's PRECONDITION. Deliberately
 *               narrow: only conditions where acting cannot destroy data.
 *   blockedBy(ctx) → string|null — a reason to WITHIN the precondition
 *               withhold the offer right now (e.g. :3000 live for reset:db);
 *               the reason is printed so withholding is never silent.
 *   apply(ctx)  → Promise<string|null> — perform the fix; a human-readable
 *               note on success, null for a no-op. ctx = { ROOT, pid3000, env }.
 *   afterApply(ctx) → void — cache invalidation hooks (e.g. drop ENV_CACHE).
 *
 * Everything NOT listed here (installs, corrupt-DB rebuilds, reseeds of an
 * existing DB, process kills) stays manual by design.
 */
export const FIX_REGISTRY = [
  {
    id: 'env-from-template',
    title: '.env file',
    prompt: 'Create .env from .env.example now, with QA-friendly rate limits seeded (only because .env does not exist)? [y/N] ',
    applies: (rows, ctx) => rows.some((r) => r.title === '.env file' && r.status === 'warn')
      && !fs.existsSync(path.join(ctx.ROOT, '.env'))
      && fs.existsSync(path.join(ctx.ROOT, '.env.example')),
    blockedBy: () => null,
    apply: (ctx) => Promise.resolve(autoFixEnv(ctx)),
    afterApply: () => { ENV_CACHE = null; },       // Re-read .env on the re-check
  },
  {
    id: 'dev-db-reset',
    title: 'Dev database',
    prompt: 'Dev database file does not exist — run `npm run reset:db` now to create it (schema + seeds; nothing to wipe)? [y/N] ',
    applies: (rows) => rows.some((r) => r.title === 'Dev database' && r.status === 'warn' && /not found yet/.test(r.detail || '')),
    blockedBy: (ctx) => (ctx.pid3000 != null
      ? `:3000 is live (pid ${ctx.pid3000}) — NOT offering reset:db; seeding must not race a running server. Stop it first, then run \`npm run reset:db\`.`
      : null),
    apply: (ctx) => runResetDb(ctx),
    afterApply: null,
  },
];

/** All registry entries whose precondition holds and that are not blocked.
 *  Blocking reasons are printed — an offer withheld without explanation
 *  would look like a broken fix. Exported for the regression suite. */
export function collectApplicableFixes(rows, ctx) {
  const fixes = [];
  for (const f of FIX_REGISTRY) {
    if (!f.applies(rows, ctx)) continue;
    const blocked = f.blockedBy?.(ctx) ?? null;
    if (blocked) {
      console.log(`  (${f.title}: ${blocked})`);
      continue;
    }
    fixes.push(f);
  }
  return fixes;
}

/** Shared consent flow for the gate and --fix mode: ask → apply → note →
 *  afterApply. Returns the fix notes (empty when nothing ran). */
async function runConsentFixes(rows, ctx, { label }) {
  const fixed = [];
  for (const f of collectApplicableFixes(rows, ctx)) {
    if (!(await confirm(`(${label}) ${f.prompt}`))) continue;
    const note = await f.apply(ctx);
    if (note) {
      fixed.push(note);
      f.afterApply?.(ctx);
    }
  }
  return fixed;
}

/** The test:all gate flow: visible checks → consent-based fixes for the
 *  narrow safe set (via FIX_REGISTRY) → visible re-check → verdict rows.
 *  Never exits. */
export async function runDoctorGate({ title }) {
  const first = await runDoctorChecks({ title });
  let { rows } = first;
  const ctx = { ROOT, pid3000: first.pid3000, env: {} };
  const fixed = rows.some((r) => r.status !== 'ok')
    ? await runConsentFixes(rows, ctx, { label: 'doctor gate' })
    : [];
  if (fixed.length) rows = (await runDoctorChecks({ title: `${title} — re-check after fixes` })).rows;
  return { rows, fixed };
}

async function main() {
  const argv = process.argv.slice(2);
  const fixMode = argv.includes('--fix');
  const fastMode = argv.includes('--fast');
  if (fixMode) {
    console.log('(--fix) offers to repair what is safe (missing .env from template — with QA-friendly rate limits seeded — and missing dev DB via reset:db) after confirmation. Everything else stays manual — suggested commands are printed at the end.\n');
  }

  const first = await runDoctorChecks({ fast: fastMode });
  let rows = first.rows;
  if (fastMode) {
    // Fast profile (pre-push gate): code-shape checks only. Warns are
    // informational by definition; only [fail] blocks the push.
    const fails = rows.filter((r) => r.status === 'fail').length;
    const warns = rows.filter((r) => r.status === 'warn').length;
    if (fails > 0) {
      console.error(`doctor --fast: ${fails} problem${fails > 1 ? 's' : ''} — commit-shape checks failed (see above).`);
      setTimeout(() => process.exit(1), 250);
      return;
    }
    console.log(`doctor --fast: all code-shape checks passed${warns ? ` (${warns} warning${warns > 1 ? 's' : ''})` : ''}.`);
    setTimeout(() => process.exit(0), 250);
    return;
  }
  const ctx = { ROOT, pid3000: first.pid3000, env: {} };
  const fixedNotes = fixMode
    ? await runConsentFixes(rows, ctx, { label: '--fix' })
    : [];
  if (fixMode && fixedNotes.length) rows = (await runDoctorChecks({ title: 'npm run doctor — re-check after fix' })).rows;

  const fails = rows.filter((s) => s.status === 'fail').length;
  const warns = rows.filter((s) => s.status === 'warn').length;
  console.log('');
  if (fails > 0) {
    console.log(`Setup has ${fails} problem${fails > 1 ? 's' : ''}${warns ? ` and ${warns} warning${warns > 1 ? 's' : ''}` : ''} — fix the [fail] items above, then re-run \`npm run doctor\`.`);
    if (fixMode) {
      fixedNotes.forEach((n) => console.log(`(--fix) ✓ ${n}`));
      printManualFixes(rows);
    }
    // Delayed exit (bug #4 medicine, same as testSecurity.js): a bare
    // process.exit(1) here races undici's keep-alive socket teardown from
    // the live-health fetch (check #10) and dies with the libuv
    // uv_async_t assertion (exit 127) AFTER the report — the failure exit
    // code is then lost, which breaks the test:all doctor gate. Give the
    // handle a quarter second to close, then exit with the real code.
    // NOT .unref()'d: the event loop has nothing else pending by this
    // point, so an unref'd timer never fires and the process would exit 0
    // on a failing report (observed live) — the keep-alive handle we are
    // waiting out is what holds the loop open.
    setTimeout(() => process.exit(1), 250);
  }
  if (warns > 0) {
    console.log(`Setup looks workable with ${warns} warning${warns > 1 ? 's' : ''} — see [warn] items above; everything needed for \`npm start\` and \`npm run test:all\` is in place.`);
  } else {
    console.log('All checks passed — you are ready for `npm run test:all`, `npm run test:ui`, and the load trio. See README.md → Verification & QA.');
  }
  if (fixMode) {
    if (fixedNotes.length) fixedNotes.forEach((n) => console.log(`(--fix) ✓ ${n}`));
    else console.log('(--fix) nothing to repair — all checks passed.');
    if (warns > 0) printManualFixes(rows);
  }
}

// CLI entry: only when executed directly. Importing doctor.js (e.g. from
// testAll.js's doctor gate) must NOT run the checks — the same rule walAB.js
// follows, where an accidental import-time main() once started a benchmark.
const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => { console.error('doctor crashed:', e); process.exit(1); });
}
