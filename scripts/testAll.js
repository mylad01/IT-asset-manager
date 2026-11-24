#!/usr/bin/env node
/**
 * scripts/testAll.js — one-command QA sweep: every PLAN.MD suite in order.
 *
 *   npm run test:all
 *
 * Runs the 18 permanent suites from PLAN.MD §1/§8/§10/§11/§12 in their
 * documented order (DB layer → isolated-server suites → live-API contracts →
 * security → full-API sweep → PM2 lifecycle → UI regressions), streams each
 * suite's own output live, and ends with a summary table.
 *
 * Stack management:
 *   - Requires API :3000 + Vite :5174. Starts whatever is missing (detached,
 *     same spawn shape as the documented dev commands) and waits for health.
 *   - Before every suite the runner re-checks the stack and heals it. This
 *     matters because testDiskGuard spawns :3000 back detached but does not
 *     wait for boot — without the re-check the next contract suites race the
 *     boot and fail. testProcessManagement needs :3000 FREE (it drives the
 *     PM2 lifecycle on that port), so the runner stops the dev API first and
 *     lets later suites' checks bring it back. A janitor step kills orphaned
 *     :3110 listeners and clears testDiskGuard's scratch runtime around that
 *     suite — a suite killed mid-run otherwise leaves a stray writer behind.
 *   - API is restarted before testAllApi: the auth limiter (30/15min per
 *     .env) is in-process, and the contract suites + testSecurity burn ~23
 *     logins in the epoch since testDiskGuard's restart; testAllApi's ~8
 *     more would race the cap. A fresh server = a fresh limiter store.
 *   - At the end, any part of the stack left down by a suite is restored.
 *
 * Not included (by design, per PLAN.MD runbooks): the k6 load phases (need
 * the :3100 LOAD_TEST_MODE server via `npm run test:server` and are perf
 * runs, not pass/fail contracts) and the one-off firstrun/emptystate session
 * probes (not permanent scripts). The WAL A/B micro-benchmark (bench:walab)
 * IS available behind an opt-in flag: it stops the dev stack for a quiet
 * host, so it runs LAST, manages the stack itself, and gets its verdict row
 * appended to the summary table.
 *
 * Every run appends to `logs/qa-run/suite-history.jsonl` — one JSON line per
 * suite result plus one `run` summary line — so flaky suites (PASS/FAIL
 * flip-flopping over time) become visible:
 *
 *   node -e "const l=require('fs').readFileSync('logs/qa-run/suite-history.jsonl','utf8')
 *     .trim().split('\n').map(JSON.parse)
 *     .filter(e=>e.type==='suite'&&e.name==='testLifecyclePanel')
 *     .slice(-20) — recent results for one suite"
 *
 * The console summary also prints a flake warning for any suite whose last
 * 10 recorded results contain both PASSes and FAILs. Set
 * TEST_ALL_NO_HISTORY=1 to skip appending (e.g. for throwaway experiments).
 *
 * Env:
 *   TEST_ALL_ONLY=a,b,c     substring filter — run only matching suites
 *   TEST_ALL_SKIP=a,b       substring filter — skip matching suites
 *   TEST_ALL_SUITE_TIMEOUT_MS  per-suite kill timeout (default 300000)
 *   TEST_ALL_WALAB=1        append the WAL A/B benchmark (smoke preset)
 *   TEST_ALL_WALAB=cadence  …with a named preset (drift|cadence|jsize|smoke)
 *   TEST_ALL_WALAB_RUNS=2   read-heavy runs per regime (default 2)
 *   TEST_ALL_NO_HISTORY=1   skip suite-history.jsonl append
 *   TEST_ALL_SKIP_DOCTOR=1  skip the pre-sweep doctor gate (not recommended)
 *
 * Before anything starts, the runner gates on `npm run doctor`: if any
 * [fail] condition exists (incomplete npm install, missing toolchain
 * scripts, unusable dev DB), the sweep aborts before starting servers —
 * a sweep that begins broken only wastes time and leaves the stack in a
 * half-state. The gate OFFERS to fix the two unambiguous conditions after
 * asking for consent (missing .env → copy from template; missing dev DB →
 * reset:db, only when :3000 is free), then re-checks; everything else
 * stays manual. TEST_ALL_SKIP_DOCTOR=1 bypasses the gate for deliberate
 * experiments; [warn] conditions are printed but never block. A 45s
 * prompt timeout counts as NO, so CI/non-interactive runs never hang.
 */
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLockLive, killNodePid, stopNodePid, findListenerOwner } from '../server/utils/appLock.js';
import { runDoctorGate } from './doctor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const API_HEALTH = 'http://localhost:3000/api/health';
const UI_ROOT = 'http://localhost:5174/';
const SUITE_TIMEOUT = Number(process.env.TEST_ALL_SUITE_TIMEOUT_MS) || 300_000;

/** PLAN.MD order: §1 verdict table, §8 promotions, §10 UI suites. */
const SUITES = [
  { name: 'testDatabase', script: 'scripts/testDatabase.js', target: 'DB layer (direct, no server)' },
  { name: 'testDoctorFixRegistry', script: 'scripts/testDoctorFixRegistry.js', target: 'doctor fix registry (preconditions)' },
  { name: 'testPreferencesRegistry', script: 'scripts/testPreferencesRegistry.js', target: 'registry ⇄ schema sync + storage contracts' },
  { name: 'testThemeContrast', script: 'scripts/testThemeContrast.js', target: 'WCAG contrast floors for every theme preset (static, no server)' },
  { name: 'testRetiredKeysGate', script: 'scripts/testRetiredKeysGate.js', target: 'retired-keys gate (sandboxed prebuild contract)' },
  { name: 'testLiveApiGuard', script: 'scripts/testLiveApiGuard.js', target: 'own decoys · handle-aware live-API guard' },
  { name: 'testLogging', script: 'scripts/testLogging.js', target: 'own server :3987 (temp DB/lock)' },
  { name: 'testAuthLimiter', script: 'scripts/testAuthLimiter.js', target: 'own :3989 · failed-only email+IP limiter' },
  { name: 'testDiskGuard', script: 'scripts/testDiskGuard.js', target: 'own :3110 · restarts :3000' },
  { name: 'testLifecycleWatchdog', script: 'scripts/testLifecycleWatchdog.js', target: 'own :3115 · lock/port watchdogs' },
  { name: 'testConversations', script: 'scripts/testConversations.js', target: 'API :3000' },
  { name: 'testConversationTypeContract', script: 'scripts/testConversationTypeContract.js', target: 'in-memory DB · schema ⇄ validator contract' },
  { name: 'testAttachments', script: 'scripts/testAttachments.js', target: 'API :3000' },
  { name: 'testLeaveRequests', script: 'scripts/testLeaveRequests.js', target: 'API :3000 (leave-requests contract)', restartApiBefore: true },
  { name: 'testLeaveContract', script: 'scripts/testLeaveContract.js', target: 'in-memory · leave schema⇄validator contract (no server)' },
  { name: 'testLeaveUploads', script: 'scripts/testLeaveUploads.js', target: 'isolated · leave upload policy + private-guard (no server)' },
  { name: 'testLeaveDates', script: 'scripts/testLeaveDates.js', target: 'shared date math · shared/leaveDates.js units (no server)' },
  { name: 'testLeaveFrontendUpload', script: 'scripts/testLeaveFrontendUpload.js', target: 'client magic-byte guard ⇄ server policy contract (no server)' },
  { name: 'testConversationBackup', script: 'scripts/testConversationBackup.js', target: 'API :3000' },
  { name: 'testBackupRestoreDrill', script: 'scripts/testBackupRestoreDrill.js', target: 'own :3120 · restore ZIP → boot → verify' },
  { name: 'testMentions', script: 'scripts/testMentions.js', target: 'API :3000' },
  { name: 'testArchive', script: 'scripts/testArchive.js', target: 'API :3000' },
  { name: 'testSecurity', script: 'scripts/testSecurity.js', target: 'API :3000 (brute-force window)' },
  { name: 'testAllApi', script: 'scripts/testAllApi.mjs', target: 'API :3000 (all endpoints × roles)', restartApiBefore: true },
  { name: 'testAbortCleanup', script: 'scripts/testAbortCleanup.mjs', target: 'own :3993 · abort-safety for testAllApi seeds' },
  { name: 'testProcessManagement', script: 'scripts/testProcessManagement.js', target: 'PM2 lifecycle on :3000' },
  { name: 'testLifecyclePanel', script: 'scripts/testLifecyclePanel.js', target: 'UI :5174 (destructive run)' },
  { name: 'testDiskStatusBanner', script: 'scripts/testDiskStatusBanner.js', target: 'UI :5174 (route-intercepted)' },
  { name: 'testTicketBadge', script: 'scripts/testTicketBadge.js', target: 'UI :5174 + API :3000 · seeds & purges ticket chat' },
  { name: 'testLeaveUiSmoke', script: 'scripts/testLeaveUiSmoke.js', target: 'UI :5174 + API :3000 · leave pages, badge, deep links', restartApiBefore: true },
  { name: 'testUiJourney', script: 'scripts/testUiJourney.js', target: 'UI :5174 (read-only sweep)' },
];

const UI_SUITES = new Set(['testLifecyclePanel', 'testDiskStatusBanner', 'testUiJourney', 'testTicketBadge', 'testLeaveUiSmoke']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(url, accept, timeoutMs = 4000) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    return accept(res.status);
  } catch {
    return false;
  }
}

const apiUp = () => probe(API_HEALTH, (s) => s === 200 || s === 503); // 503 = up, degraded disk
const uiUp = () => probe(UI_ROOT, (s) => s === 200);

async function waitFor(label, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(500);
  }
  return false;
}

/** Spawn detached so the stack outlives this runner (same shape as the
 *  documented dev-start commands). Returns false when it never came up. */
function spawnDetached(args) {
  // DB-identity keys are deliberately dropped: a sweep invoked with a caller's
  // DB_PATH / LOAD_TEST_DB_PATH in the environment would otherwise spawn its
  // dev API on that DB — observed live when a doctor-gate test left
  // DB_PATH=scripts/.gatetest/seed.sqlite exported and ensureStack brought up
  // :3000 on the scratch DB. The API must always resolve its DB the same way
  // a plain `npm start` would. (Scenario overrides for isolated suites pass
  // their env explicitly to their own spawns — this only guards the shared stack.)
  const { DB_PATH: _dropDbPath, LOAD_TEST_DB_PATH: _dropLoadTestDbPath, ...restEnv } = process.env;
  // Rate-limit headroom for the stack this sweep spawns.
  // server/config/env.js falls back to READ_RATE_LIMIT_MAX=60/min and
  // GLOBAL_RATE_LIMIT_MAX=300/min, and a checkout that ships WITHOUT a .env
  // (clean:delivery strips it for delivery) lands straight on those. A UI
  // sweep's health polling then trips429s, which the suites surface as
  // console errors and fail their "zero console errors" assertions — observed
  // live: 5×429 in testDiskStatusBanner. These are the documented dev/.env
  // tunings (CLAUDE.md: read300, global1000). Order of precedence:
  // an exported process.env wins, then a local .env, then this QA floor.
  // AUTH_RATE_LIMIT_MAX is deliberately NOT touched — testSecurity asserts
  // 429 behaviour on this very stack, so its window must stay operator-owned.
  const fileLimits = (() => {
    const out = {};
    try {
      const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
      for (const k of ['GLOBAL_RATE_LIMIT_MAX', 'READ_RATE_LIMIT_MAX']) {
        const m = txt.match(new RegExp(`^\\s*${k}\\s*=\\s*([^#\\s]+)`, 'm'));
        if (m) out[k] = m[1].trim();
      }
    } catch { /* no .env — the QA floor below applies */ }
    return out;
  })();
  for (const [k, v] of Object.entries({
    GLOBAL_RATE_LIMIT_MAX: '1000',
    READ_RATE_LIMIT_MAX: '300',
    ...fileLimits,
  })) if (restEnv[k] === undefined) restEnv[k] = v;
  // Dev-mode logging is stdout-ONLY (server/utils/logger.js pretty-prints to
  // stdout and writes logs/*.log only in production), so stdio 'ignore'
  // swallowed every line the restored stack printed — observed live
  // 2026-10-03: the restored dev API logged NOTHING while hundreds of
  // "Health probe answering 503" warnings went to a discarded stdout and
  // post-sweep log monitoring was blind. Tee both streams into
  // logs/devstack.log so a sweep-restored stack stays observable.
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const logFd = fs.openSync(path.join(ROOT, 'logs', 'devstack.log'), 'a');
  fs.writeSync(logFd, `\n===== ${new Date().toISOString()} spawnDetached: node ${args.join(' ')} =====\n`);
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: restEnv,
  });
  fs.closeSync(logFd);              // the child holds its own duplicated handle
  child.unref();
  return child;
}

/** Stop the dev API on :3000. Targets the :3000 LISTENER (the process that
 *  actually serves the port), node-validated before any signal — the lock
 *  owner can be a different (ghost) process when a previous kill removed
 *  the lock but left its server alive, and killing the lock owner alone
 *  would leave :3000 serving with an un-reset limiter. Lock PIDs are also
 *  node-validated before any signal (a stale lock whose PID was recycled
 *  must never be killed — observed live: a lock resolving to svchost.exe). */
async function stopApi() {
  const lockPath = path.join(ROOT, 'logs', '.app.lock');

  // 1. The listener is what matters: find and stop it (node-validated,
  //    graceful → escalate, all through the kill-node-only guard).
  const listenerPid = await findListenerOwner(3000);
  if (listenerPid != null) {
    const kill = await killNodePid(listenerPid, 'SIGINT');
    if (kill.verified) {
      console.log(`  stopping dev API :3000 (listener pid ${listenerPid})…`);
      const gone = await waitFor(':3000 down', async () => !(await apiUp()), 10_000);
      if (!gone) await stopNodePid(listenerPid, { escalateAfterMs: 3000 });
    } else {
      console.log(`  :3000 is held by a non-node process (pid ${listenerPid}) — leaving it alone`);
    }
  }

  // 2. The lock owner (when different) is a ghost server with the DB open —
  // stop it too so the next boot is genuinely clean.
  const verdict = await isLockLive(lockPath);
  if (verdict.live && verdict.pid !== listenerPid) {
    console.log(`  stopping ghost lock owner (node pid ${verdict.pid})…`);
    await killNodePid(verdict.pid, 'SIGINT');
    await sleep(500);
  }
  try { fs.unlinkSync(lockPath); } catch { /* server removed it, or gone */ }
  await waitFor('api down', async () => !(await apiUp()), 10_000);
}

/** Kill any orphaned :3110 listener (testDiskGuard's private port) and drop
 *  its scratch runtime — a suite killed mid-run otherwise leaves a server
 *  child behind that wedges the shared PID lock and can balloon its DB. */
async function janitor(label) {
  const out = await new Promise((resolve) => {
    execFile('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf-8' },
      (err, stdout) => resolve(err ? '' : String(stdout)));
  });
  const pids = [...new Set(out.split('\n')
    .filter((l) => /:3110\s+.*LISTENING/i.test(l))
    .map((l) => parseInt(l.trim().split(/\s+/).pop(), 10))
    .filter(Number.isInteger))];
  for (const pid of pids) {
    console.log(`  janitor${label}: stopping orphaned :3110 listener (pid ${pid})`);
    // Node-only guard: a recycled PID on :3110 must never be hard-killed.
    await stopNodePid(pid, { escalateAfterMs: 3000 });
  }
  if (pids.length) await waitFor(':3110 free', async () => {
    const again = await new Promise((resolve) => {
      execFile('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf-8' },
        (err, stdout) => resolve(err ? '' : String(stdout)));
    });
    return !again.split('\n').some((l) => /:3110\s+.*LISTENING/i.test(l));
  }, 10_000);
  fs.rmSync(path.join(ROOT, 'scripts', '.runtime', 'diskguard'), { recursive: true, force: true });
  if (pids.length) console.log(`  janitor${label}: :3110 clear, scratch runtime removed`);
}

async function ensurePart(label, isUp, start, timeoutMs) {
  if (await isUp()) return { started: false };
  console.log(`  ${label} is down — starting it (detached)…`);
  start();
  if (!(await waitFor(`${label} boot`, isUp, timeoutMs))) return { started: true, failed: true };
  return { started: true };
}

async function ensureStack() {
  const api = await ensurePart('API :3000', apiUp,
    () => spawnDetached(['server/index.js']), 40_000);
  const ui = await ensurePart('Vite :5174', uiUp,
    () => spawnDetached(['node_modules/vite/bin/vite.js', '--port', '5174', '--strictPort']), 40_000);
  if (api.failed || ui.failed) {
    throw new Error(`stack failed to boot: ${api.failed ? 'API :3000' : ''}${api.failed && ui.failed ? ' + ' : ''}${ui.failed ? 'Vite :5174' : ''}`);
  }
  return { apiStarted: api.started, uiStarted: ui.started };
}

/** One suite: stream its output, kill it if it hangs, return the result row. */
async function runSuite(suite) {
  console.log(`\n${'═'.repeat(72)}\n▶ ${suite.name} — ${suite.target}\n${'═'.repeat(72)}`);
  const startedAt = Date.now();
  const child = spawn(process.execPath, [suite.script, ...(suite.args || [])], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }, suite.timeoutMs || SUITE_TIMEOUT);
  const code = await new Promise((resolve) => child.once('exit', (c) => resolve(c)));
  clearTimeout(killTimer);
  const secs = (Date.now() - startedAt) / 1000;
  const status = timedOut ? 'TIMEOUT' : code === 0 ? 'PASS' : 'FAIL';
  console.log(`\n■ ${suite.name}: ${status} (exit ${timedOut ? 'killed' : code}) in ${secs.toFixed(1)}s`);
  const note = timedOut ? `killed after ${suite.timeoutMs || SUITE_TIMEOUT}ms timeout` : undefined;
  return { ...suite, status, secs, note };
}

const HISTORY_FILE = path.join(ROOT, 'logs', 'qa-run', 'suite-history.jsonl');

/** Read prior suite entries from the JSONL history (skips corrupt lines). */
function readHistory() {
  try {
    return fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .filter((e) => e.type === 'suite');
  } catch { return []; }
}

/** Append run + per-suite entries to the JSONL history (one line each). */
function appendHistory(results, meta) {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    const lines = [JSON.stringify({ type: 'run', at: meta.stamp, totalSecs: meta.totalSecs, passed: meta.passed, failed: meta.failed, suites: results.length })];
    for (const r of results) {
      lines.push(JSON.stringify({
        type: 'suite',
        at: meta.stamp,
        name: r.name,
        status: r.status,
        secs: Number(r.secs.toFixed(1)),
        ...(r.status !== 'PASS' && r.note ? { note: String(r.note).slice(0, 200) } : {}),
      }));
    }
    fs.appendFileSync(HISTORY_FILE, lines.join('\n') + '\n');
    return true;
  } catch (err) {
    console.log(`(history append failed: ${err.message} — continuing)`);
    return false;
  }
}

/** Suites whose recent results mix PASS and FAIL — the flaky list. */
function flakySuites(results, prior) {
  const flags = [];
  for (const r of results) {
    const past = prior.filter((e) => e.name === r.name).slice(-10).map((e) => e.status);
    const statuses = [...past, r.status];
    if (statuses.includes('PASS') && statuses.some((s) => s !== 'PASS')) {
      const fails = statuses.filter((s) => s !== 'PASS').length;
      flags.push(`${r.name} (${fails}/${statuses.length} non-PASS in last ${statuses.length})`);
    }
  }
  return flags;
}

function printSummary(results, startedAt, extraRow) {
  const nameW = Math.max('SUITE'.length, ...results.map((r) => r.name.length), extraRow ? extraRow.name.length : 0);
  const targetW = Math.max('TARGET'.length, ...results.map((r) => r.target.length), extraRow ? extraRow.target.length : 0);
  const statusW = Math.max('RESULT'.length, 'TIMEOUT'.length);
  const rule = `├─${'─'.repeat(nameW + 2)}┼─${'─'.repeat(targetW + 2)}┼─${'─'.repeat(statusW + 2)}┼─${'─'.repeat(9)}┤`;
  const top = `┌─${'─'.repeat(nameW + 2)}┬─${'─'.repeat(targetW + 2)}┬─${'─'.repeat(statusW + 2)}┬─${'─'.repeat(9)}┐`;
  const bot = `└─${'─'.repeat(nameW + 2)}┴─${'─'.repeat(targetW + 2)}┴─${'─'.repeat(statusW + 2)}┴─${'─'.repeat(9)}┘`;
  const row = (a, b, c, d) =>
    `│ ${a.padEnd(nameW)} │ ${b.padEnd(targetW)} │ ${c.padEnd(statusW)} │ ${d.padStart(8)} │`;

  console.log(`\n${top}\n${row('SUITE', 'TARGET', 'RESULT', 'TIME')}\n${rule}`);
  for (const r of results) console.log(row(r.name, r.target, r.status, `${r.secs.toFixed(1)}s`));
  if (extraRow) {
    console.log(rule);
    console.log(row(extraRow.name, extraRow.target, extraRow.status, '—'));
  }
  console.log(bot);

  const failedList = results.filter((r) => r.status !== 'PASS');
  const totalSecs = (Date.now() - startedAt) / 1000;
  console.log(`\n${results.length - failedList.length}/${results.length} suites passed in ${totalSecs.toFixed(1)}s` +
    (failedList.length ? ` — failed: ${failedList.map((r) => r.name).join(', ')}` : ''));
}

async function main() {
  const startedAt = Date.now();
  const only = (process.env.TEST_ALL_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
  const skip = (process.env.TEST_ALL_SKIP || '').split(',').map((s) => s.trim()).filter(Boolean);

  // Opt-in WAL A/B benchmark: appended LAST (it stops the dev stack for a
  // quiet host and restores it afterwards). TEST_ALL_WALAB=1 → smoke preset;
  // any other non-empty value names the preset; TEST_ALL_WALAB_RUNS sets the
  // read-heavy runs per regime (default 2, matching the smoke budget).
  const walab = process.env.TEST_ALL_WALAB;
  if (walab) {
    const preset = walab === '1' ? 'smoke' : walab;
    const runs = Math.max(1, parseInt(process.env.TEST_ALL_WALAB_RUNS, 10) || 2);
    SUITES.push({
      name: 'bench:walab',
      script: 'scripts/loadTests/walAB.js',
      args: ['--preset', preset, '--runs', String(runs)],
      target: `WAL A/B (${preset} ×${runs})`,
      walab: true,
      preset,
      runs,
      timeoutMs: 900_000, // full presets need more than the 300s default
    });
  }

  const selected = SUITES.filter((s) =>
    (!only.length || only.some((f) => s.name.includes(f)))
    && (!skip.length || !skip.some((f) => s.name.includes(f))));

  console.log(`QA sweep — ${new Date().toISOString()} — node ${process.version}`);
  if (only.length) console.log(`TEST_ALL_ONLY: ${only.join(', ')}`);
  if (skip.length) console.log(`TEST_ALL_SKIP: ${skip.join(', ')}`);
  if (walab) console.log(`TEST_ALL_WALAB: preset "${walab === '1' ? 'smoke' : walab}" (runs last; report → logs/qa-run/walab-*.html)`);

  const missing = selected.filter((s) => !fs.existsSync(path.join(ROOT, s.script)));
  if (missing.length) {
    console.error(`ABORT — missing suite scripts: ${missing.map((s) => s.script).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Doctor gate: refuse to start a sweep the machine cannot complete (see
  // header). Runs BEFORE any stack management so a broken checkout never
  // gets servers spawned on its behalf.
  if (process.env.TEST_ALL_SKIP_DOCTOR === '1') {
    console.log('doctor gate: SKIPPED (TEST_ALL_SKIP_DOCTOR=1)');
  } else {
    const { rows, fixed } = await runDoctorGate({ title: 'doctor gate — pre-sweep setup check' });
    if (fixed.length) fixed.forEach((n) => console.log(`doctor gate: fixed → ${n}`));
    const fails = rows.filter((r) => r.status === 'fail');
    console.log('');
    if (fails.length) {
      console.error(`ABORT — doctor reported ${fails.length} [fail] condition${fails.length > 1 ? 's' : ''}: ${fails.map((f) => f.title).join(', ')}`);
      console.error('Run `npm run doctor` for the full report and remediation steps, or set TEST_ALL_SKIP_DOCTOR=1 to override.');
      process.exitCode = 1;
      return;
    }
    const warns = rows.filter((r) => r.status === 'warn').length;
    console.log(`doctor gate: 0 failures${warns ? `, ${warns} warning${warns > 1 ? 's' : ''}` : ''} — proceeding`);
  }

  const { apiStarted, uiStarted } = await ensureStack();
  if (apiStarted) console.log('  API :3000 started');
  if (uiStarted) console.log('  Vite :5174 started');

  const results = [];
  for (const suite of selected) {
    // Stack healing between suites (see header): PM2 suite needs :3000 free,
    // everything else needs it up; UI suites also need Vite.
    try {
      if (suite.name === 'testProcessManagement') {
        await stopApi();
        // Cold PM2 state: a leftover daemon from a previous run breaks the
        // start-from-zero lifecycle this suite verifies.
        await new Promise((resolve) => {
          execFile('npx', ['pm2', 'kill'], { cwd: ROOT, encoding: 'utf-8', timeout: 30_000 },
            () => resolve());
        });
      } else if (suite.walab) {
        // walAB manages the whole stack itself (stops dev services for a
        // quiet host, restores them in its finally block) — healing here
        // would only boot servers it is about to kill.
      } else if (suite.name === 'testDiskGuard') {
        // Normalize :3000 (stopApi also removes a lockless listener — the
        // polluted state that makes the suite's own stopMain a silent no-op),
        // pre-clean orphan :3110/scratch from any earlier crashed run, then
        // hand the suite the locked dev server it expects to stop & restore.
        await stopApi();
        await janitor(' (pre-diskguard)');
        const api = await ensurePart('API :3000', apiUp, () => spawnDetached(['server/index.js']), 40_000);
        if (api.failed) throw new Error('API :3000 failed to boot');
      } else {
        if (suite.restartApiBefore) await stopApi(); // fresh auth-limiter epoch
        const api = await ensurePart('API :3000', apiUp, () => spawnDetached(['server/index.js']), 40_000);
        if (api.failed) throw new Error('API :3000 failed to boot');
        if (UI_SUITES.has(suite.name)) {
          const ui = await ensurePart('Vite :5174', uiUp,
            () => spawnDetached(['node_modules/vite/bin/vite.js', '--port', '5174', '--strictPort']), 40_000);
          if (ui.failed) throw new Error('Vite :5174 failed to boot');
        }
      }
    } catch (err) {
      console.log(`\n■ ${suite.name}: FAIL (stack not ready — ${err.message})`);
      results.push({ ...suite, status: 'FAIL', secs: 0, note: `stack not ready — ${err.message}` });
      continue;
    }
    const result = await runSuite(suite);
    results.push(result);
    if (suite.name === 'testDiskGuard') await janitor(' (post-diskguard)');
    if (suite.walab) {
      // Enrich the verdict row with the benchmark's own conclusion.
      try {
        const report = JSON.parse(fs.readFileSync(
          path.join(ROOT, 'logs', 'qa-run', `walab-${suite.preset}.json`), 'utf-8'));
        const med = (rows) => rows.map((r) => r.p95).filter(Number.isFinite).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
        const best = report.regimes
          .map((r) => ({ name: r.name, p95: med(r.rows) }))
          .sort((a, b) => (a.p95 ?? 1e9) - (b.p95 ?? 1e9))[0];
        if (best) {
          result.target += ` — best: ${best.name} (p95 ${best.p95}ms)`;
          result.note = `best regime ${best.name}, p95 ${best.p95}ms`;
        }
      } catch { /* report missing (run aborted early) — row stays as-is */ }
    }
  }

  // Leave the stack healthy: restore anything a suite left down. A short
  // grace first — walAB spawns its own Vite right before exiting, and it
  // needs a few seconds to bind before a check would see it.
  await sleep(2_000);
  if (!(await apiUp())) {
    console.log('\npost-run: API :3000 down — restoring…');
    spawnDetached(['server/index.js']);
    if (await waitFor('API restore', apiUp, 40_000)) console.log('post-run: API :3000 restored (200)');
    else console.log('post-run: API :3000 FAILED to come back — check server logs');
  }
  if (!(await uiUp())) {
    console.log('post-run: Vite :5174 down — restoring…');
    spawnDetached(['node_modules/vite/bin/vite.js', '--port', '5174', '--strictPort']);
    if (await waitFor('Vite restore', uiUp, 40_000)) console.log('post-run: Vite :5174 restored (200)');
    else console.log('post-run: Vite :5174 FAILED to come back — run `npm run dev` manually');
  }

  // Ledger janitor: the API/UI suites legitimately write QA noise into the
  // dev DB's asset ledger (transfer cycles, maintenance notes, journey
  // seeds — the history modal otherwise fills with test chatter). Remove
  // what THIS sweep wrote — signatures time-boxed to startedAt, so any
  // human's real note can never match — plus orphaned logs (asset row
  // gone, any age). Backup-first inside the janitor; a failure here must
  // never fail the sweep. TEST_ALL_NO_LEDGER_JANITOR=1 disables.
  if (process.env.TEST_ALL_NO_LEDGER_JANITOR !== '1') {
    try {
      const { cleanLedger } = await import('./lib/ledgerJanitor.js');
      await cleanLedger({ sinceIso: new Date(startedAt).toISOString().replace('T', ' ').slice(0, 19), apply: true });
    } catch (err) {
      console.log(`(ledger janitor skipped: ${err.message} — continuing)`);
    }
  }

  // Doctor check #16 (retired storage identifiers) surfaces as the table's
  // last row — visible even when the pre-sweep gate passed, since a suite
  // could reintroduce the pattern mid-run. Cheap re-scan; it NEVER alters
  // the exit code (the gate and the prebuild hook own enforcement).
  let extraRow = null;
  if (process.env.TEST_ALL_SKIP_DOCTOR !== '1') {
    try {
      const { checkRetiredKeys } = await import('./lib/retiredKeysCheck.js');
      let status = 'ok';
      checkRetiredKeys((s) => { status = s; });
      extraRow = {
        name: 'doctor#16 retired-keys',
        target: 'storage key literals stay single-source',
        status: status === 'ok' ? 'PASS' : status.toUpperCase(),
      };
    } catch (err) {
      console.log(`(doctor#16 summary row failed: ${err.message} — continuing)`);
    }
  }

  printSummary(results, startedAt, extraRow);

  // Failure history: append this run, then surface suites whose recent
  // results flip between PASS and FAIL (the flaky list).
  if (process.env.TEST_ALL_NO_HISTORY !== '1') {
    const prior = readHistory();
    const stamp = new Date().toISOString();
    const failed = results.filter((r) => r.status !== 'PASS').length;
    if (appendHistory(results, { stamp, totalSecs: (Date.now() - startedAt) / 1000, passed: results.length - failed, failed })) {
      console.log(`history: ${results.length + 1} entries appended to ${path.relative(ROOT, HISTORY_FILE)}`);
    }
    const flakes = flakySuites(results, prior);
    if (flakes.length) {
      console.log('\n⚠ flaky suites (PASS/FAIL mix in recent history):');
      for (const f of flakes) console.log(`  - ${f}`);
    }
  }

  process.exitCode = results.some((r) => r.status !== 'PASS') ? 1 : 0;
}

main().catch((err) => {
  console.error('test:all failed:', err.message);
  process.exitCode = 1;
});
