#!/usr/bin/env node
/**
 * scripts/testLifecycleWatchdog.js — regression suite for the lock-file and
 * listener watchdogs in server/index.js (the single-instance invariant).
 *
 * Covers the guards added 2026-09-26:
 *   1. Boot stamps a validated 3-line lock (pid + metadata + cwd)
 *   2. A vanished lock is re-stamped while running (ghost-server prevention)
 *   3. A stale (dead-PID) lock is healed while running
 *   4. The lock block in /api/health reflects ticks + re-stamps + verdicts
 *   5. A second instance REFUSES to boot while the lock is live (exit 1)
 *   6. A port-theft (IPv6 dual-stack bind over the IPv4 wildcard, the one
 *      reproducible theft on Windows) makes the watched server EXIT 1 with
 *      the loud log, and the event survives into the next instance's health
 *
 * Fully isolated: own port :3115, own DB, own APP_LOCK_FILE, own runtime dir
 * — never touches the dev server, its lock, or the dev DB. Port and runtime
 * are janitored before and after. Run: node scripts/testLifecycleWatchdog.js
 *
 * Note on scenarios 1b/6: on current Windows, libuv sets SO_EXCLUSIVEADDRUSE,
 * so a second node bind is blocked and IPv6 dual-stack is the only live
 * reproducible theft; on hosts where theft cannot be reproduced, the theft
 * scenario degrades to a documented SKIP, not a failure.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findListenerOwners, stopNodePid } from '../server/utils/appLock.js';

const PORT = 3115;
const BASE = `http://localhost:${PORT}`;
const RUNTIME = path.resolve('scripts/.runtime/watchdog');
const LOCK_FILE = path.join(RUNTIME, 'watchdog.lock');
const WDOG_MS = 2000;                                   // Fast tick for the suite

let passed = 0, failed = 0;
function assert(cond, msg, detail = '') {
  if (cond) { console.log(`PASS - ${msg}`); passed++; }
  else { console.log(`FAIL - ${msg}${detail ? ` — ${detail}` : ''}`); failed++; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, stepMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(stepMs);
  }
  return null;
}

function logText(name) {
  try { return fs.readFileSync(path.join(RUNTIME, `${name}.log`), 'utf-8'); } catch { return ''; }
}

const children = new Set();

/** Spawn an isolated app server; resolves once /api/health answers. */
function bootServer(name) {
  fs.mkdirSync(RUNTIME, { recursive: true });
  const log = fs.openSync(path.join(RUNTIME, `${name}.log`), 'a');
  const child = spawn(process.execPath, [path.resolve('server/index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: path.join(RUNTIME, 'watchdog.sqlite'),
      LOG_DIR: path.join(RUNTIME, 'logs'),
      BACKUP_PATH: path.join(RUNTIME, 'backups'),
      APP_LOCK_FILE: LOCK_FILE,
      APP_LOCK_WATCHDOG_MS: String(WDOG_MS),
    },
    stdio: ['ignore', log, log],
    cwd: path.resolve('.'),
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return waitFor(async () => {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return child; } catch { /* booting */ }
    return null;
  }, 25_000).then((up) => { if (!up) throw new Error(`${name} never became healthy — see ${RUNTIME}/${name}.log`); return child; });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await waitFor(() => child.exitCode !== null, 8000);
}

/** Janitor: no stray listener, no leftover runtime. */
async function janitor() {
  for (const pid of await findListenerOwners(PORT)) await stopNodePid(pid);
  fs.rmSync(RUNTIME, { recursive: true, force: true });
  fs.mkdirSync(RUNTIME, { recursive: true });
}

const health = async () => {
  try { return await (await fetch(`${BASE}/api/health`)).json(); } catch { return null; }
};

async function main() {
  console.log('════════════════════════════════════════════════════');
  console.log('  WATCHDOG LIFECYCLE SUITE (lock re-stamp + port theft)');
  console.log('════════════════════════════════════════════════════');
  await janitor();

  // ── 1. Boot + lock format + health block ────────────────────────────
  const a = await bootServer('boot');
  const lock = fs.readFileSync(LOCK_FILE, 'utf-8');
  const lines = lock.split(/\r?\n/);
  assert(parseInt(lines[0], 10) === a.pid, 'boot stamps lock with own PID on line 1', `pid ${a.pid} vs lock line 1 "${lines[0]}"`);
  assert(/pid=\d+ ppid=\d+ node=\S+/.test(lines[1] || ''), 'lock line 2 carries metadata tokens');
  assert(lines.some((l) => l.startsWith('cwd=')), 'lock line 3 carries cwd');

  const h1 = await health();
  assert(h1?.lock?.holder_pid === a.pid, '/api/health lock.holder_pid matches server pid');
  assert(h1?.lock?.enabled === true && h1?.lock?.period_ms === WDOG_MS, '/api/health reports watchdog enabled with suite period');
  assert(Array.isArray(h1?.lock?.recent_events), 'health exposes lock.recent_events array');

  // ── 2. Second instance refuses while the lock is live ──────────────
  {
    const log = fs.openSync(path.join(RUNTIME, 'second.log'), 'a');
    const second = spawn(process.execPath, [path.resolve('server/index.js')], {
      env: {
        ...process.env, PORT: String(PORT), DB_PATH: path.join(RUNTIME, 'watchdog.sqlite'),
        LOG_DIR: path.join(RUNTIME, 'logs'), APP_LOCK_FILE: LOCK_FILE, APP_LOCK_WATCHDOG_MS: String(WDOG_MS),
      },
      stdio: ['ignore', log, log], cwd: path.resolve('.'),
    });
    children.add(second);
    const exit = await waitFor(() => second.exitCode, 20_000);
    assert(exit === 1, 'second instance refuses to boot (exit 1) while lock is live', `exit ${exit}`);
  }

  // ── 3. Vanished lock re-stamped within one tick ─────────────────────
  const ticksBefore = (await health())?.lock?.ticks ?? 0;
  fs.rmSync(LOCK_FILE, { force: true });
  const restamped = await waitFor(() => {
    try { return parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').split(/\r?\n/)[0], 10) === a.pid; } catch { return false; }
  }, WDOG_MS + 3000);
  assert(!!restamped, 'vanished lock re-stamped within one watchdog tick');

  // ── 4. Stale (dead-PID) lock healed within one tick ────────────────
  fs.writeFileSync(LOCK_FILE, `999999999\npid=999999999 exe=ghost.exe\n`);
  const healed = await waitFor(() => {
    try { return parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').split(/\r?\n/)[0], 10) === a.pid; } catch { return false; }
  }, WDOG_MS + 3000);
  assert(!!healed, 'dead-PID stale lock healed within one watchdog tick');

  // ── 5. Health reflects ticks + restamps ─────────────────────────────
  const h2 = await health();
  assert((h2?.lock?.ticks ?? 0) > ticksBefore, 'health tick counter advances', `before ${ticksBefore}, after ${h2?.lock?.ticks}`);
  assert((h2?.lock?.re_stamps ?? 0) >= 2, 'health counts both re-stamps', `re_stamps ${h2?.lock?.re_stamps}`);
  // The heal tick records the PRE-heal verdict (what the check saw: stale) —
  // correct evidence semantics; the NEXT healthy tick's verdict is the
  // image-validated one, so wait for it rather than racing the tick.
  const healthyVerdict = await waitFor(async () => {
    const h = await health();
    return h?.lock?.last_verdict?.reason === 'node-holds-lock' && h?.lock?.last_verdict?.image === 'node.exe' ? h.lock.last_verdict : null;
  }, WDOG_MS * 2 + 2000);
  assert(!!healthyVerdict, 'last verdict becomes image-validated node-holds-lock', JSON.stringify((await health())?.lock?.last_verdict));
  const evNames = (h2?.lock?.recent_events ?? []).map((e) => e.event);
  assert(evNames.includes('lock-restamp'), 'restamp events present in health recent_events', JSON.stringify(evNames));

  // ── 6. Port theft → exit 1 + durable event + next instance sees it ──
  // Kill A WITHOUT lock cleanup (simulating the crash that leaves ghosts),
  // then verify the durable event chain with a fresh boot afterwards.
  const theftLog = logText('boot');
  a.kill();                                               // Crash-like: no graceful shutdown, exit handlers best-effort
  await waitFor(() => a.exitCode !== null, 8000);
  {
    // Live theft attempt against a NEW server on the same port+lock state.
    const b = await bootServer('victim');
    // IPv6 dual-stack bind over the IPv4 wildcard — the reproducible theft.
    const tlog = fs.openSync(path.join(RUNTIME, 'thief.log'), 'a');
    const thief = spawn(process.execPath, ['-e', `require('http').createServer((q,s)=>s.end('stolen')).listen(${PORT},'::',()=>console.log('thief bound'));setInterval(()=>{},1e6);`], { stdio: ['ignore', tlog, tlog] });
    children.add(thief);
    await sleep(2000);
    const listeners = await findListenerOwners(PORT);
    const theftVisible = listeners.includes(thief.pid);
    if (!theftVisible) {
      assert(true, 'port-theft scenario (SKIPPED — dual-stack bind not reproducible on this host)', `listeners ${JSON.stringify(listeners)}`);
    } else {
      assert(true, 'port theft reproduced (second listener bound)');
      const exit = await waitFor(() => b.exitCode, WDOG_MS * 2 + 5000);
      const loud = theftLog.length >= 0 && logText('victim').includes('exiting loudly');
      assert(exit === 1 && loud, 'stolen port → server exits 1 with loud log', `exit ${exit}, loud ${loud}`);
    }
    // Free the port COMPLETELY before booting 'next': with the thief still
    // holding [::]:port, fetch('localhost') can hit the THIEF (::1 first)
    // and 'next' would exit at its first tick — both would fake an empty
    // events payload.
    try { thief.kill(); } catch { /* gone */ }
    await sleep(500);
    for (const pid of await findListenerOwners(PORT)) await stopNodePid(pid);
    await sleep(500);
    {
      // Durable event must survive: next boot's health reports the theft.
      const c = await bootServer('next');
      const h3 = await health();
      const evs = (h3?.lock?.recent_events ?? []).map((e) => e.event);
      assert(evs.includes('port-theft'), 'port-theft event survives into next instance health', JSON.stringify(evs));
      await stopServer(c);
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────
  for (const c of [...children]) { try { c.kill(); } catch { /* gone */ } }
  await sleep(1000);
  for (const pid of await findListenerOwners(PORT)) await stopNodePid(pid);
  await sleep(500);
  fs.rmSync(RUNTIME, { recursive: true, force: true });

  console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('suite crashed:', err.message);
  for (const c of [...children]) { try { c.kill(); } catch { /* gone */ } }
  for (const pid of await findListenerOwners(PORT)) await stopNodePid(pid);
  process.exit(1);
});
