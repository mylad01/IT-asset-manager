#!/usr/bin/env node
/**
 * scripts/testDiskGuard.js — disk-full hardening contract.
 *
 * Behaviours: boot preflight refuses a full-disk boot, critical-free-space
 * short-circuits protected writes with 503 while reads/auth stay open,
 * health degrades to 503, recovery once thresholds are normal, WAL cap
 * truncates an over-cap WAL.
 *
 * Spawns its own API server instance on :3110 with an isolated DB. Because
 * the PID lock file is shared (logs/.app.lock), the main :3000 instance must
 * NOT be running while this suite executes — the script stops it and
 * restores it afterwards (opt out with KEEP_MAIN_SERVER=1).
 *
 * Usage: node scripts/testDiskGuard.js
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';

const PORT = 3110;
const BASE = `http://localhost:${PORT}`;
const RUNTIME = path.resolve('scripts/.runtime/diskguard');
const LOCK_FILE = path.resolve('logs/.app.lock');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`PASS - ${msg}`); passed++; }
  else { console.log(`FAIL - ${msg}`); failed++; }
}

async function runTest(name, fn) {
  try { await fn(); }
  catch (err) { console.log(`FAIL - ${name}`); console.log(`       ${err.message}`); failed++; }
}

async function api(method, url, body, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}/api${url}`, {
    method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data, headers: res.headers };
}

function spawnServer(diskEnv) {
  fs.mkdirSync(RUNTIME, { recursive: true });
  const child = spawn(process.execPath, [path.resolve('server/index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: path.join(RUNTIME, 'diskguard.sqlite'),
      LOG_DIR: path.join(RUNTIME, 'logs'),
      BACKUP_PATH: path.join(RUNTIME, 'backups'),
      // Own lock file: this suite's instance is fully isolated (own port + DB),
      // so it must not collide with the dev server's logs/.app.lock.
      APP_LOCK_FILE: path.join(RUNTIME, 'diskguard.lock'),
      ...diskEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  child.stdout.on('data', d => lines.push(String(d)));
  child.stderr.on('data', d => lines.push(String(d)));
  child.output = () => lines.join('');
  child.exitCodeSeen = undefined;
  child.stopped = new Promise((resolveP) => {
    child.once('exit', (code) => { child.exitCodeSeen = code; resolveP(code); });
  });
  return child;
}

async function waitSettled(child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCodeSeen !== undefined) return 'exit';
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.status === 200 || r.status === 503) return 'up';
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return 'timeout';
}

async function stopServer(child) {
  if (child.exitCodeSeen !== undefined) return child.exitCodeSeen;
  const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 6000);
  try { child.kill('SIGINT'); } catch {}
  const code = await child.stopped;
  clearTimeout(killTimer);
  return code;
}

function seedAdmin(dbPath) {
  const db = new Database(dbPath);
  const hash = bcrypt.hashSync('admin', 10);
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE,
    password_hash TEXT, role TEXT DEFAULT 'Staff', dept_id INTEGER,
    requires_password_change INTEGER DEFAULT 1)`);
  db.prepare(
    `INSERT OR IGNORE INTO users (name, email, password_hash, role, requires_password_change) VALUES (?, ?, ?, ?, 0)`
  ).run('root', 'admin@studio.com', hash, 'IT Admin');
  db.close();
}

// ── Precondition: :3000 must not hold the shared lock ──
let mainServerPid = null;
let mainRestored = false;
// Set when the suite start SAW a live server but its pid went stale before
// stopMain could signal it: the stack was up when we began, so restoreMain
// still owes the operator a running :3000 (2026-10-03: without this flag a
// stale lock skipped the restore and left the dev stack silently down).
let restoreOwed = false;
try {
  const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
  if (Number.isInteger(pid)) {
    // Image-validated liveness: signal-0 alone mistakes a Windows-recycled
    // PID for the running server (the svchost.exe lesson). Only a live
    // node.exe counts as "our main server"; anything else (recycled image
    // or dead PID) means there is no server to stop or restore.
    const { getProcessImage } = await import('../server/utils/appLock.js');
    const probe = await getProcessImage(pid);
    if (probe.exists && (probe.image === 'node.exe' || probe.image === 'node')) {
      mainServerPid = pid;
    }
  }
} catch { /* no lock or stale */ }

async function stopMain() {
  if (!mainServerPid) return;
  // Image-validate before signaling: a recycled PID in a stale lock must
  // never be killed (see server/utils/appLock.js for the full story).
  const { isLockLive, killNodePid } = await import('../server/utils/appLock.js');
  const verdict = await isLockLive(LOCK_FILE);
  if (!verdict.live) {
    console.log(`(lock pid ${mainServerPid} is stale — ${verdict.reason}; not signaling it, continuing without a main server)`);
    mainServerPid = null;
    restoreOwed = true; // a live server existed at suite start — restore anyway
    return;
  }
  console.log(`(stopping main :3000 server pid ${mainServerPid} for the suite)`);
  await killNodePid(mainServerPid, 'SIGINT');
  for (let i = 0; i < 30; i++) {
    const re = await isLockLive(LOCK_FILE);
    if (!re.live) return;
    await new Promise(r => setTimeout(r, 250));
  }
  await killNodePid(mainServerPid, 'SIGKILL');
}

function restoreMain() {
  if ((!mainServerPid && !restoreOwed) || mainRestored || process.env.KEEP_MAIN_SERVER) return;
  mainRestored = true;
  console.log('(restoring main :3000 server)');
  // Tee stdout/stderr: dev-mode logging is stdout-only (logger.js pretty-
  // prints and writes logs/*.log only in production), so 'ignore' would
  // leave the restored stack silent — the 2026-10-03 experiment lost all
  // server warnings that way. Same tee as testAll.spawnDetached.
  fs.mkdirSync(path.resolve('logs'), { recursive: true });
  const logFd = fs.openSync(path.resolve('logs', 'devstack.log'), 'a');
  fs.writeSync(logFd, `\n===== ${new Date().toISOString()} testDiskGuard.restoreMain =====\n`);
  const child = spawn(process.execPath, ['server/index.js'], {
    detached: true, stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);              // child holds its own duplicated handle
  child.unref();
}

async function withLiveServer(envOver, fn) {
  await stopMain();
  const dbPath = path.join(RUNTIME, 'diskguard.sqlite');
  await seedAdmin(dbPath);
  const child = spawnServer({
    DISK_MIN_FREE_BYTES: '0',
    DISK_CHECK_INTERVAL_MS: '300',
    ...envOver,
  });
  const state = await waitSettled(child);
  if (state !== 'up') {
    const out = child.output();
    console.log(`(boot tail) ${out.slice(-500).replace(/\n/g, ' | ')}`);
    throw new Error(`live server not ready (state=${state}, exit=${child.exitCodeSeen})`);
  }
  try {
    await fn();
  } finally {
    await stopServer(child);
  }
}

// ═══ 1. Boot preflight refuses full-disk boot ═══
await runTest('preflight: refuses boot below DISK_MIN_FREE_BYTES', async () => {
  await stopMain();
  // A 10 TB floor is larger than any realistic free space — the preflight
  // must log the failure and exit(1) on its own.
  const child = spawnServer({ DISK_MIN_FREE_BYTES: String(10 * 1024 ** 4) });
  await Promise.race([child.stopped, new Promise(r => setTimeout(r, 15_000))]);
  const out = child.output();
  if (child.exitCodeSeen === undefined) await stopServer(child); // did not self-exit — clean up
  assert(
    /preflight FAILED|refusing to start/i.test(out),
    `boot refused with preflight failure (exit=${child.exitCodeSeen})`
  );
});

// ═══ 2. Critical threshold 503s protected writes, reads stay open ═══
await runTest('guard: critical → protected writes 503, reads/auth/health behave', async () => {
  // Cannot shrink a real disk, so invert: set the critical watermark ABOVE
  // the machine's actual free space (500 GB) to simulate critical.
  await withLiveServer({ DISK_CRITICAL_FREE_GB: '500', DISK_WARN_FREE_GB: '600' }, async () => {
    const login = await api('POST', '/auth/login', { email: 'admin@studio.com', password: 'admin' });
    assert(login.status === 200, `login works during incident (${login.status})`);
    const token = login.data?.token;
    assert(!!token, 'token issued');

    const blocked = await api('POST', '/assets', { name: 'x', asset_type_id: 1, department_id: 1, status: 'active' }, token);
    assert(blocked.status === 503, `protected write 503 (got ${blocked.status})`);
    assert(blocked.data?.code === 'DISK_CRITICAL', `error code DISK_CRITICAL (${JSON.stringify(blocked.data)})`);
    assert((blocked.headers.get('retry-after') || '') === '60', 'Retry-After: 60 present');

    const read = await api('GET', '/assets', null, token);
    assert(read.status === 200, `read stays open (got ${read.status})`);

    const health = await api('GET', '/health');
    assert(health.status === 503, `health degrades to 503 (got ${health.status})`);
    assert(health.data?.disk?.status === 'critical', `health reports disk critical (${JSON.stringify(health.data?.disk)})`);
  });
});

// ═══ 3. Recovery once thresholds are normal ═══
await runTest('guard: recovery once free space is above thresholds', async () => {
  await withLiveServer({}, async () => {
    const token = (await api('POST', '/auth/login', { email: 'admin@studio.com', password: 'admin' })).data?.token;
    assert(!!token, 'login after recovery');
    const post = await api('POST', '/assets', { name: 'probe' }, token);
    assert(post.status !== 503, `protected write no longer 503 (got ${post.status})`);
    const health = await api('GET', '/health');
    assert(health.status === 200, `health back to 200 (got ${health.status})`);
    assert(health.data?.disk && health.data.disk.status !== 'critical', 'health disk status not critical');
    assert(health.data.wal_bytes === null || typeof health.data.wal_bytes === 'number', 'wal_bytes surfaced');
  });
});

// ═══ 4. WAL cap truncates an over-cap WAL ═══
await runTest('WAL cap: over-cap WAL triggers TRUNCATE checkpoint', async () => {
  await withLiveServer({ DISK_WAL_CAP_MB: '1', DB_WAL_CHECKPOINT_INTERVAL_MS: '300' }, async () => {
    const dbPath = path.join(RUNTIME, 'diskguard.sqlite');
    const w = new Database(dbPath);
    w.exec('PRAGMA journal_mode=WAL');
    w.exec('CREATE TABLE IF NOT EXISTS filler (b BLOB)');
    w.exec('INSERT INTO filler VALUES (randomblob(400000))');
    for (let i = 0; i < 6; i++) w.exec('INSERT INTO filler SELECT b FROM filler');
    const before = fs.statSync(`${dbPath}-wal`).size;

    let after = before, waited = 0;
    while (waited < 10_000) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
      try { after = fs.statSync(`${dbPath}-wal`).size; } catch { after = 0; }
      if (after < before) break;
    }
    assert(after < before, `WAL truncated by cap check (${before} → ${after} bytes)`);
    w.close();
  });
});

restoreMain();
console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
