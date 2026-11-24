#!/usr/bin/env node
/**
 * scripts/cleanDelivery.js — one-command "house cleaning day" for a project
 * that is about to be handed over.
 *
 * What it does, in order:
 *   1. Stops the dev stack (API :3000 + Vite :5174). Windows refuses to
 *      delete an open SQLite file or an open log, and resetDb refuses to run
 *      while a dev API is serving the DB — so the stack has to go first.
 *   2. Wipes local runtime state. The databases are left to resetDb (it owns
 *      the lock-grace retry + SQL fallback); everything else is removed here:
 *      uploads/*, logs/*, root-level *.log, backups/, dist/, delivery/
 *      (stale archives from the last run), pre-janitor *.bak snapshots, and
 *      the stray %TEMP%sb3 directory a bad TEMP expansion once created.
 *   3. Re-seeds: spawns `node scripts/resetDb.js` (schema + departments +
 *      asset types + root admin + 5 test users + 25 assets).
 *   4. Zips the project into delivery/it-asset-manager.zip, excluding
 *      node_modules/, .freebuff/, logs/, backups/, delivery/, *.zip and —
 *      unless --keep-env is passed — .env (it holds JWT_SECRET and local
 *      config; .env.example ships as the template).
 *   5. With --strip-env, removes .env (and any .env.* variant except
 *      .env.example) from the PROJECT itself, so a hand-rolled copy of the
 *      folder cannot ship it either. Runs last: every earlier step reads
 *      .env for PORT/DB_PATH, and the zip is byte-identical either way
 *      because .env is already excluded from it.
 *
 * Flags:
 *   --dry-run    print the wipe plan and the zip exclusion list, change nothing
 *   --no-stop    fail (instead of stopping the stack) if :3000/:5174 are live
 *   --keep-env   include .env in the delivery zip
 *   --strip-env  delete .env (and .env.* except .env.example) from the project
 *   -h, --help   usage
 *
 * Run: npm run clean:delivery
 *
 * Layering: scripts/ → server/utils/* (appLock) only. resetDb is SPAWNED as
 * a sibling script, never imported, so this file never opens the database —
 * which is also why it survives a locked/WAL-dirty DB.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';
import AdmZip from 'adm-zip';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(ROOT, '.env') }); // DB_PATH / PORT resolution (dotenv never overwrites)

const API_PORT = parseInt(process.env.PORT, 10) || 3000;
const VITE_PORT = 5174; // vite.config.js `port`
const ZIP_PATH = join(ROOT, 'delivery', 'it-asset-manager.zip');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const NO_STOP = argv.includes('--no-stop');
const KEEP_ENV = argv.includes('--keep-env');
const STRIP_ENV = argv.includes('--strip-env');
const WANTS_HELP = argv.includes('-h') || argv.includes('--help');

const UPLOAD_SKELETON = [
  'uploads',
  'uploads/conversations',
  'uploads/archive/conversations',
  'uploads/branding',
];

/**
 * Directories that must exist in the finished tree. uploads/* is rebuilt as
 * a skeleton because multer's asset destination is a CALLBACK (see
 * server/config/multer.js), so it will not create the directory itself;
 * logs/ is wiped like any other runtime dir and rebuilt so the tree is
 * immediately startable — `server/index.js` heals it at boot too, but the
 * documented harness tee (`>> logs/devstack.log`) needs it BEFORE the first
 * boot, and a missing logs/ silently breaks every spawn that assumes it.
 */
const KEEP_DIRS = ['logs', ...UPLOAD_SKELETON];

/** Dirs never shipped: dependencies, client runtime, and all runtime state. */
const ZIP_SKIP_DIRS = new Set(['node_modules', '.freebuff', 'delivery', 'logs', 'backups', '.git', '.pm2']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const banner = (s) => console.log(`\n─── ${s} ${'─'.repeat(Math.max(4, 62 - s.length))}`);
const info = (s) => console.log(`  • ${s}`);
const ok = (s) => console.log(`  ✅ ${s}`);
const warn = (s) => console.log(`  ⚠  ${s}`);
const die = (msg) => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

function usage() {
  console.log(`
Clean Delivery — wipe runtime state, reseed, and zip a deliverable project.

  npm run clean:delivery              full run
  npm run clean:delivery -- --dry-run show the plan, touch nothing
  npm run clean:delivery -- --no-stop refuse to run if the dev stack is up
  npm run clean:delivery -- --keep-env ship .env too (default: excluded)
  npm run clean:delivery -- --strip-env delete .env from the project too

Output: delivery/it-asset-manager.zip
Reseed: npm run reset:db (root admin admin@studio.com / admin)
`);
}

if (WANTS_HELP) {
  usage();
  process.exit(0);
}
if (process.env.NODE_ENV === 'production') {
  die('Refusing to run a delivery wipe with NODE_ENV=production. Set NODE_ENV=development or omit it.');
}
const unknown = argv.filter((a) => !['--dry-run', '--no-stop', '--keep-env', '--strip-env'].includes(a));
if (unknown.length) {
  usage();
  die(`Unknown flag(s): ${unknown.join(' ')}`);
}
if (KEEP_ENV && STRIP_ENV) {
  die('--keep-env and --strip-env contradict each other: choose whether .env ships in the zip or disappears from the project.');
}

// ── 1. Stop the dev stack ──────────────────────────────────────────────────
async function stopDevStack() {
  banner('Step 1 · Stop the dev stack');
  const { findListenerOwners, stopNodePid } = await import('../server/utils/appLock.js');
  const ports = [
    [API_PORT, 'dev API'],
    [VITE_PORT, 'Vite'],
  ];
  const listeners = [];
  for (const [port, label] of ports) {
    let pids = [];
    try {
      pids = await findListenerOwners(port);
    } catch (err) {
      warn(`port probe for :${port} failed (${err?.code || err?.message || 'error'}) — assuming free`);
    }
    for (const pid of pids) if (!listeners.some((l) => l.pid === pid)) listeners.push({ pid, port, label });
  }

  if (!listeners.length) {
    ok(`nothing listening on :${API_PORT} or :${VITE_PORT}`);
    return;
  }
  if (NO_STOP) {
    die(`--no-stop was passed but the dev stack is live (${listeners.map((l) => `${l.label} pid ${l.pid}`).join(', ')}). Stop it first: npm run kill`);
  }

  for (const { pid, label } of listeners) {
    info(`stopping ${label} (pid ${pid})`);
    if (DRY) continue;
    // stopNodePid = SIGINT → poll → SIGKILL, node-image-validated at every step.
    await stopNodePid(pid);
  }
  if (DRY) return;

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const left = [];
    for (const [port] of ports) {
      try {
        left.push(...(await findListenerOwners(port)));
      } catch { /* probe flake — keep polling */ }
    }
    if (!left.length) break;
    await sleep(300);
  }
  ok('dev stack stopped, ports free');
}

// ── 2. Wipe runtime state ──────────────────────────────────────────────────
function planWipe() {
  const plan = { dirs: [], files: [], uploads: false };

  for (const name of readdirSync(ROOT)) {
    const full = join(ROOT, name);
    if (name.endsWith('.log')) plan.files.push(full); // load-*-run.log and friends
    // 'delivery' too: stale archives and scratch extractions from a previous
    // run must not survive into (or get re-shipped by) the next one. Step 4
    // recreates the directory before writing the new zip.
    if (['logs', 'backups', 'dist', 'delivery', '%TEMP%sb3'].includes(name) && statSync(full).isDirectory()) {
      plan.dirs.push(full);
    }
  }

  const runtime = join(ROOT, 'scripts', '.runtime');
  if (existsSync(runtime)) {
    for (const name of readdirSync(runtime)) {
      if (name.endsWith('.bak')) plan.files.push(join(runtime, name)); // pre-janitor DB snapshots
    }
  }

  // uploads/* is emptied but the directory itself is rebuilt as a skeleton —
  // multer's destination is a callback (see server/config/multer.js), so the
  // directory must exist for asset uploads to work on the receiving side.
  const uploads = join(ROOT, 'uploads');
  if (existsSync(uploads)) plan.uploads = true;

  return plan;
}

/** Windows lock-flavoured deletes (EPERM/EBUSY) get a short grace window. */
function removeWithGrace(target, { recursive = true } = {}) {
  const isLock = (err) => ['EPERM', 'EBUSY', 'EACCES', 'EDEADLK'].includes(err?.code);
  const deadline = Date.now() + 8_000;
  for (;;) {
    try {
      rmSync(target, { recursive, force: true });
      return true;
    } catch (err) {
      if (!isLock(err) || Date.now() >= deadline) {
        warn(`could not remove ${relative(ROOT, target) || target} (${err?.code || err?.message})`);
        return false;
      }
    }
  }
}

async function wipe(plan) {
  banner('Step 2 · Wipe runtime state');
  const labels = [
    ...plan.dirs.map((d) => `${relative(ROOT, d)}/`),
    ...plan.files.map((f) => relative(ROOT, f)),
  ];
  if (plan.uploads) labels.push('uploads/* (contents)');

  if (!labels.length) {
    ok('nothing to wipe — already clean');
    return;
  }
  for (const label of labels) info(`remove ${label}`);
  if (DRY) return;

  for (const dir of plan.dirs) removeWithGrace(dir);
  for (const file of plan.files) removeWithGrace(file, { recursive: false });

  if (plan.uploads) {
    const uploads = join(ROOT, 'uploads');
    for (const name of readdirSync(uploads)) removeWithGrace(join(uploads, name));
  }
  for (const rel of KEEP_DIRS) mkdirSync(join(ROOT, rel), { recursive: true });

  ok(`wiped ${plan.dirs.length} dir(s), ${plan.files.length} file(s), uploads/*`);
}

// ── 3. Reseed ──────────────────────────────────────────────────────────────
function reseed() {
  banner('Step 3 · Reseed (schema + departments + asset types + users + assets)');
  if (DRY) {
    info('would spawn: node scripts/resetDb.js');
    return;
  }
  // Spawned, never imported: resetDb owns the DB lock-grace retry, the SQL
  // fallback and the live-API guard. Its exit status is the result — a
  // filtered/ignored failure here would ship a broken database.
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'resetDb.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) die(`resetDb could not be spawned: ${result.error.message}`);
  if (result.status !== 0) die(`resetDb exited with status ${result.status} — no zip was written.`);
  ok('database reseeded');
}

// ── 4. Zip ─────────────────────────────────────────────────────────────────
function zipNameIsExcluded(name) {
  if (name.endsWith('.zip')) return true; // never ship a previous archive
  if (name.endsWith('.log')) return true; // run logs are runtime state
  if (name === '.env.example') return false; // committed template — ALWAYS ships
  if (KEEP_ENV) return false;
  return name === '.env' || name.startsWith('.env.');
}

function collectFiles(dir, prefix, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (ZIP_SKIP_DIRS.has(entry.name)) continue;
      collectFiles(join(dir, entry.name), rel, out);
      continue;
    }
    if (zipNameIsExcluded(entry.name)) continue;
    out.push({ abs: join(dir, entry.name), rel });
  }
}

function buildZip() {
  banner('Step 4 · Zip the deliverable');
  if (DRY) {
    info(`would write ${relative(ROOT, ZIP_PATH)}`);
    info(`exclude dirs: ${[...ZIP_SKIP_DIRS].join(', ')}`);
    info(`exclude files: *.zip, *.log, ${KEEP_ENV ? '(.env KEPT)' : '.env / .env.* (keeps .env.example)'}`);
    return null;
  }

  const files = [];
  collectFiles(ROOT, '', files);
  // logs/*.log are stripped by name even though logs/ is already dir-skipped.
  const entries = files.filter((f) => !f.rel.startsWith('logs/'));
  if (!entries.length) die('nothing collected — refusing to write an empty archive.');

  mkdirSync(dirname(ZIP_PATH), { recursive: true });
  if (existsSync(ZIP_PATH)) rmSync(ZIP_PATH, { force: true });

  const zip = new AdmZip();
  for (const { abs, rel } of entries) zip.addLocalFile(abs, rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', rel.split('/').pop());
  // KEEP_DIRS must survive the trip as directory entries when nothing else
  // implies them — multer's asset destination is a callback (not a string),
  // so it does NOT create uploads/ on its own, and logs/ must exist before
  // the first boot for the documented harness tee.
  const covered = new Set(entries.map((f) => f.rel));
  for (const dir of KEEP_DIRS) {
    const implied = entries.some((f) => f.rel.startsWith(`${dir}/`));
    if (!implied && !covered.has(`${dir}/`)) zip.addFile(`${dir}/`, Buffer.alloc(0));
  }
  // adm-zip 0.6.0 ships writeZip(callback)/writeZipPromise — no writeZipSync.
  // toBuffer() + writeFileSync keeps the build synchronous (the caller then
  // verifies the archive on disk), so a failure can't report success early.
  writeFileSync(ZIP_PATH, zip.toBuffer());

  const mb = (statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1);
  ok(`${relative(ROOT, ZIP_PATH)} — ${entries.length} file(s), ${mb} MB`);

  verifyZip(entries.length);
  return ZIP_PATH;
}

/** Read the archive back and assert the delivery contract. */
function verifyZip(expectedFiles) {
  const zip = new AdmZip(ZIP_PATH);
  const names = zip.getEntries().map((e) => e.entryName);
  const has = (n) => names.includes(n);
  const startsWith = (p) => names.some((n) => n.startsWith(p));

  const failures = [];
  // Every collected file must land in the archive (plus skeleton dir entries).
  if (names.length < expectedFiles) {
    failures.push(`expected >= ${expectedFiles} entries, archive holds ${names.length}`);
  }
  if (startsWith('node_modules/')) failures.push('node_modules/ leaked into the archive');
  // `.env` and its variants are out — but `.env.example` is the committed
  // template (.gitignore: `!.env.example`) and must ship, or the recipient
  // has nothing to copy from.
  const leakedEnv = names.filter((n) => n === '.env' || (n.startsWith('.env.') && n !== '.env.example'));
  if (!KEEP_ENV && leakedEnv.length) failures.push(`.env leaked into the archive: ${leakedEnv.join(', ')}`);
  if (!has('.env.example')) failures.push('.env.example (recipient template) missing');
  if (!has('package.json')) failures.push('package.json missing');
  if (!has('server/index.js')) failures.push('server/index.js missing');
  if (!has('src/App.jsx') && !startsWith('src/')) failures.push('src/ missing');
  if (!has('database.sqlite')) failures.push('database.sqlite (reseeded) missing');
  if (!has('uploads/dummy-seed.png')) failures.push('uploads/ placeholder seed image missing');
  for (const dir of KEEP_DIRS) {
    const implied = names.some((n) => n === `${dir}/` || n.startsWith(`${dir}/`));
    if (!implied) failures.push(`required directory missing from archive: ${dir}/`);
  }

  if (failures.length) die(`zip verification FAILED:\n    - ${failures.join('\n    - ')}`);
  ok(`verified: ${names.length} entries, ${KEEP_ENV ? '.env included' : '.env excluded'}, node_modules excluded`);
}

// ── 5. Strip .env ───────────────────────────────────────────────────────────
/**
 * Deletes `.env` and every `.env.*` sibling EXCEPT `.env.example`, which is
 * the committed template (.gitignore: `!.env.example`) and the recipient's
 * only copy of the knobs. A failed delete is fatal — reporting "stripped"
 * while a JWT_SECRET-bearing file survives would be a false claim.
 */
function stripEnv() {
  banner('Step 5 · Strip .env');
  if (!STRIP_ENV) {
    info('.env kept local (pass --strip-env to remove it from the project)');
    return;
  }
  const victims = readdirSync(ROOT).filter(
    (n) => n === '.env' || (n.startsWith('.env.') && n !== '.env.example')
  );
  if (!victims.length) {
    ok('nothing to strip — .env already gone');
    return;
  }
  for (const n of victims) info(`remove ${n}`);
  if (DRY) return;
  for (const n of victims) {
    if (!removeWithGrace(join(ROOT, n), { recursive: false })) {
      die(`could not delete ${n} — the project still contains local secrets. Restore nothing and retry after closing whatever holds it.`);
    }
  }
  ok(`stripped ${victims.length} file(s) — restore with: cp .env.example .env`);
}

// ── run ────────────────────────────────────────────────────────────────────
console.log('\n🧹  Clean Delivery — house cleaning day');
info(`root: ${ROOT}`);
if (DRY) warn('--dry-run: nothing will be changed');
if (KEEP_ENV) warn('--keep-env: .env WILL be shipped (contains local config)');
if (STRIP_ENV) warn('--strip-env: .env WILL be deleted from the project after the zip is built');

const plan = planWipe();
await stopDevStack();
await wipe(plan);
reseed();
const zip = buildZip();
stripEnv();

banner('Done');
if (DRY) {
  info('dry run only — re-run without --dry-run to execute');
} else {
  info(`archive: ${relative(ROOT, zip)}`);
  info('excluded: node_modules/, logs/, backups/, .freebuff/, *.log, *.zip' + (KEEP_ENV ? '' : ', .env (keeps .env.example)'));
  info('start the delivered copy: npm install && cp .env.example .env && npm start && npm run dev');
  info('root admin: admin@studio.com / admin');
  if (STRIP_ENV) {
    warn('.env was deleted from this project — dev defaults now apply (AUTH_RATE_LIMIT_MAX drops 30 → 5).');
    info('restore local tuning: cp .env.example .env');
  }
}
console.log('');
