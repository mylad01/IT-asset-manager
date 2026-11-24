#!/usr/bin/env node
/**
 * scripts/loadTests/walAB.js — automated WAL-regime A/B benchmark.
 *
 *   node scripts/loadTests/walAB.js                     # full default experiment
 *   node scripts/loadTests/walAB.js --runs 2            # fewer runs per regime
 *   node scripts/loadTests/walAB.js --preset smoke      # 60s smoke version
 *   node scripts/loadTests/walAB.js --preset cadence    # the 2026-09-24 cadence study
 *   node scripts/loadTests/walAB.js --warmup false      # skip write-heavy warm-up
 *
 * For each preset regime this script:
 *   1. spawns a fresh :3100 LOAD_TEST_MODE server with that regime's env
 *      (DB_PATH stays inside scripts/loadTests/.runtime, wiped first),
 *   2. optionally runs write-heavy once as a page-cache warm-up,
 *   3. runs read-heavy N times, capturing p95/p99/median + WAL + queue stats,
 *   4. kills the server and moves to the next regime,
 * and finally regenerates a self-contained dark-theme HTML report (SVG chart
 * + data table + findings) plus a JSON blob of the raw data under
 * logs/qa-run/walab-<preset>.html|json.
 *
 * Safety: targets :3100 only (rejects :3000), never touches the dev DB, and
 * restores any dev server it had to stop. Threshold gates come from the k6
 * scenarios themselves — a regime with failing thresholds is reported, not
 * silently dropped.
 *
 * Env: DB_WAL_CHECKPOINT_INTERVAL_MS, DISK_WAL_CAP_MB and friends come from
 * the preset definitions; PREFLIGHT_WAL_MAX_MB can be raised per-regime via
 * a regime's `preflightWalMaxMb`.
 */
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopNodePid } from '../../server/utils/appLock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'scripts', 'loadTests', '.runtime');
const DB_PATH = './scripts/loadTests/.runtime/database.loadtest.sqlite';
const LOCK = './scripts/loadTests/.runtime/.loadtest.lock';
const K6_READ = 'scripts/loadTests/scenarios/read-heavy.js';
const K6_WRITE = 'scripts/loadTests/scenarios/write-heavy.js';
const PREFLIGHT = 'scripts/loadTests/preflight.js';
const PORT = 3100;
const HEALTH = `http://127.0.0.1:${PORT}/api/health`;

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const hasFlag = (name) => args.includes(`--${name}`);

const PRESETS = {
  drift: [
    { name: 'A · cold WAL, 60s checkpoints', env: {}, warmup: true, note: 'read-only keeps WAL pinned ~0.3MB' },
    { name: 'B · warm 64MB WAL, checkpoints off', env: { DB_WAL_CHECKPOINT_INTERVAL_MS: '0', DISK_WAL_CAP_MB: '0' }, warmup: true, preflightWalMaxMb: '8', note: 'write-heavy warm-up grows WAL to 64MB' },
  ],
  cadence: [
    { name: "A' · defaults (60s PASSIVE + cap check)", env: {}, warmup: true, note: 'WAL truncated by cap logic' },
    { name: 'C1 · 10s PASSIVE, no cap check', env: { DB_WAL_CHECKPOINT_INTERVAL_MS: '10000', DISK_WAL_CAP_MB: '0' }, warmup: true, note: 'WAL parks at 64MB limit' },
    { name: 'C2 · 60s PASSIVE, no cap check', env: { DB_WAL_CHECKPOINT_INTERVAL_MS: '60000', DISK_WAL_CAP_MB: '0' }, warmup: true, note: 'isolates cap-check cost' },
  ],
  smoke: [
    { name: 'defaults', env: {}, warmup: true },
    { name: 'checkpoints off', env: { DB_WAL_CHECKPOINT_INTERVAL_MS: '0', DISK_WAL_CAP_MB: '0' }, warmup: true, preflightWalMaxMb: '8' },
  ],
  // journal_size_limit family: after a TRUNCATE/auto checkpoint, SQLite
  // truncates the -wal file to at most journal_size_limit bytes. Default is
  // 64MB; the 8MB variant asks whether a tighter ceiling changes read tails
  // or write throughput (smaller post-checkpoint WAL on disk, more bytes
  // rewritten per truncate).
  jsize: [
    { name: 'jsz 64MB · default limit', env: {}, warmup: true, note: 'journal_size_limit 67108864 (production default)' },
    { name: 'jsz 8MB · tight limit', env: { DB_JOURNAL_SIZE_LIMIT: '8388608' }, warmup: true, note: 'journal_size_limit 8388608 — WAL truncates to 8MB after checkpoints' },
  ],
};
const PRESET = PRESETS[argOf('preset', 'cadence')] || PRESETS.cadence;
const RUNS = Math.max(1, parseInt(argOf('runs', '3'), 10) || 3);
const WARMUP = hasFlag('warmup') ? argOf('warmup', 'true') !== 'false' : true;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const key = argOf('preset', 'cadence');
const OUT_HTML = path.join(ROOT, 'logs', 'qa-run', `walab-${key}.html`);
const OUT_JSON = path.join(ROOT, 'logs', 'qa-run', `walab-${key}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args_, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args_, { cwd: ROOT, encoding: 'utf-8', timeout: opts.timeout ?? 300_000, ...opts },
    (err, stdout) => resolve({ code: err?.code ?? 0, stdout: String(stdout) }));
});

async function healthOnce() {
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(3000) });
    if (res.ok) return await res.json();
  } catch { /* down */ }
  return null;
}

async function waitHealthy(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

/** Kill every process listening on :3100 (Windows-safe, no shell pipes).
 *  Goes through the kill-node-only guard: a recycled PID on :3100 must
 *  never be signaled (see server/utils/appLock.js). Returns how many were
 *  actually stopped. */
async function kill3100() {
  const { stdout } = await run('netstat', ['-ano', '-p', 'tcp'], { timeout: 20_000 });
  const pids = [...new Set(stdout.split('\n')
    .filter((l) => new RegExp(`:${PORT}\\s+.*LISTENING`, 'i').test(l))
    .map((l) => parseInt(l.trim().split(/\s+/).pop(), 10))
    .filter(Number.isInteger))];
  let stopped = 0;
  for (const pid of pids) {
    if (await stopNodePid(pid, { escalateAfterMs: 3000 })) stopped += 1;
    else console.log(`  skipped pid ${pid} on :${PORT} — not a node process`);
  }
  if (stopped) await sleep(1200);
  return stopped;
}

/** Extract p95/p99/median (ms) from k6's end-of-run THRESHOLDS + summary text. */
function parseK6(stdout) {
  const grab = (re) => { const m = re.exec(stdout); return m ? parseFloat(m[1]) : null; };
  return {
    p95: grab(/p\(95\)=([\d.]+)ms/),
    p99: grab(/p\(99\)=([\d.]+)ms/),
    med: grab(/med=([\d.]+)ms/),
    checksSucceeded: grab(/checks_succeeded\.\.\.: ([\d.]+)%/),
    failedThresholds: [...stdout.matchAll(/✗\s+'([^']+)'/g)].map((m) => m[1]),
  };
}

/** One regime: fresh server + warm-up + N measured read-heavy runs. */
async function benchRegime(regime, runs) {
  const rows = [];
  console.log(`\n═══ ${regime.name} ═══`);
  fs.rmSync(RUNTIME, { recursive: true, force: true });
  fs.mkdirSync(RUNTIME, { recursive: true });

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), LOAD_TEST_MODE: '1', DB_PATH, APP_LOCK_FILE: LOCK, ...regime.env },
  });
  child.unref();
  if (!await waitHealthy(HEALTH, 45_000)) throw new Error(`server failed to boot for regime "${regime.name}"`);

  const preflightEnv = { ...process.env };
  if (regime.preflightWalMaxMb) preflightEnv.PREFLIGHT_WAL_MAX_MB = regime.preflightWalMaxMb;
  const pf = await run(process.execPath, [PREFLIGHT], { env: preflightEnv, timeout: 180_000 });
  console.log(`  preflight: exit ${pf.code}${pf.code !== 0 ? `\n${pf.stdout.split('\n').filter((l) => l.includes('❌')).join('\n')}` : ''}`);

  if (WARMUP && regime.warmup) {
    const w = await run('k6', ['run', K6_WRITE]);
    const wStats = parseK6(w.stdout);
    console.log(`  warm-up write-heavy: exit ${w.code}${wStats.p95 ? ` p95 ${wStats.p95}ms` : ''}`);
  }

  for (let i = 1; i <= runs; i += 1) {
    const k6res = await run('k6', ['run', K6_READ], { timeout: 420_000 });
    const stats = parseK6(k6res.stdout);
    const h = await healthOnce();
    rows.push({
      run: i,
      ...stats,
      walBytes: typeof h?.wal_bytes === 'number' ? h.wal_bytes : null,
      queueAvgMs: h?.db_queue?.recent_avg_ms ?? null,
      exitCode: k6res.code,
    });
    console.log(`  read run ${i}: exit ${k6res.code} p95 ${stats.p95}ms p99 ${stats.p99}ms` +
      `${stats.failedThresholds.length ? ` FAILED: ${stats.failedThresholds.join(', ')}` : ''}`);
  }

  await kill3100();
  return rows;
}

function medians(rows) {
  const vals = (k) => rows.map((r) => r[k]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  const med = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);
  return { p95: med(vals('p95')), p99: med(vals('p99')), med: med(vals('med')) };
}

// ── Report generation ──────────────────────────────────────────────────────
function generateReport(regimes) {
  const allRows = regimes.flatMap((r) => r.rows.map((row) => ({ ...row, regime: r.name })));
  const y = (ms) => 340 - ms * 0.75;
  const colors = ['#58a6ff', '#d29922', '#3fb950', '#bc8cff', '#f85149'];
  const regimeX = (ri, i, total) => 110 + ri * 260 + i * 75 - (total > 3 ? (total - 3) * 20 : 0);

  const lines = [];
  const gridYs = [0, 100, 200, 300, 400];
  for (const v of gridYs) lines.push(`<line x1="60" y1="${y(v)}" x2="870" y2="${y(v)}" stroke="#21262d"/>`,
    `<text x="52" y="${y(v) + 4}" fill="#8b949e" font-size="11" text-anchor="end">${v}</text>`);

  regimes.forEach((r, ri) => {
    if (ri > 0) lines.push(`<line x1="${60 + ri * 260 - 20}" y1="40" x2="${60 + ri * 260 - 20}" y2="340" stroke="#30363d" stroke-dasharray="4 4"/>`);
    const pts = r.rows.map((row, i) => `${regimeX(ri, i, r.rows.length)},${y(row.p95)}`).join(' ');
    lines.push(`<polyline fill="none" stroke="${colors[ri % colors.length]}" stroke-width="2.5" points="${pts}"/>`);
    r.rows.forEach((row, i) => {
      const x = regimeX(ri, i, r.rows.length);
      lines.push(`<text x="${x - 14}" y="${y(row.p95) + 16}" font-size="10" fill="#c9d1d9">${row.p95 ?? '?'}</text>`);
    });
    const m = medians(r.rows);
    lines.push(`<text x="${60 + ri * 260}" y="366" fill="${colors[ri % colors.length]}" font-size="11" text-anchor="middle">${r.name} — median p95 ${m.p95 ?? '?'}ms</text>`);
  });

  const regimeRows = regimes.map((r) => {
    const m = medians(r.rows);
    const sample = r.rows[0] || {};
    return `<tr><td>${r.name}</td><td>${r.note || ''}</td>` +
      r.rows.map((row) => `<td>${row.p95 ?? '?'} / ${row.p99 ?? '?'}</td>`).join('') +
      `<td class="median">${m.p95 ?? '?'} / ${m.p99 ?? '?'}</td>` +
      `<td>${sample.walBytes != null ? `${Math.round(sample.walBytes / 1024)}KB` : '?'}</td>` +
      `<td>${r.warmupStats?.p95 ?? '—'}</td>` +
      `<td>${r.rows.every((row) => !row.failedThresholds?.length) ? 'PASS' : `<span class="warn">FAIL</span>`}</td></tr>`;
  }).join('\n');

  const header = regimes.map((r) => `<th>p95/p99 ×${r.rows.length}</th>`).join('');
  const fails = allRows.filter((r) => r.failedThresholds?.length);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>WAL regime A/B — ${key} — it-asset-manager</title>
<style>
:root { color-scheme: dark; }
body { font-family:'Segoe UI',system-ui,sans-serif; background:#0d1117; color:#e6edf3; margin:0; padding:32px; }
h1 { font-size:22px; margin:0 0 4px; } .sub { color:#8b949e; font-size:13px; margin-bottom:24px; }
h2 { font-size:15px; margin:30px 0 10px; color:#79c0ff; }
table { border-collapse:collapse; font-size:13px; }
th,td { border:1px solid #30363d; padding:6px 12px; text-align:right; } th:first-child, td:first-child { text-align:left; }
th { background:#161b22; color:#8b949e; } .median { color:#f0883e; font-weight:600; } .warn { color:#f0883e; }
.box { border:1px solid #30363d; border-radius:8px; padding:14px 18px; margin:10px 0; font-size:13px; background:#161b22; }
.box b { color:#79c0ff; } .quiet { color:#8b949e; font-size:12px; }
</style></head><body>
<h1>WAL regime A/B — preset: ${key}</h1>
<div class="sub">generated ${STAMP} · ${RUNS} read-heavy runs per regime${WARMUP ? ' · write-heavy warm-up before each trio' : ''} · fresh :3100 server per regime · k6 read-heavy 200 VU</div>
<h2>p95 across runs (ms)</h2>
<svg viewBox="0 0 900 400" width="900" height="400" role="img" aria-label="p95 across regimes">
${lines.join('\n')}
</svg>
<h2>Raw data</h2>
<table>
<tr><th>regime</th><th>notes</th>${header}<th>p95/p99 medians</th><th>WAL (run 1)</th><th>warm-up p95</th><th>thresholds</th></tr>
${regimeRows}
</table>
<h2>Auto-summary</h2>
<div class="box"><b>Best median read p95:</b> ${
    regimes.map((r) => ({ r, m: medians(r.rows) })).sort((a, b) => (a.m.p95 ?? 1e9) - (b.m.p95 ?? 1e9))[0].r.name
  } — full table above. ${fails.length ? `<span class="warn">${fails.length} run(s) failed k6 thresholds: ${fails.map((f) => `${f.regime} run ${f.run} (${f.failedThresholds.join(', ')})`).join('; ')}.</span>` : 'All runs passed their k6 thresholds.'}</div>
<div class="box"><b>Method:</b> each regime gets a freshly wiped runtime DB and a freshly spawned
:3100 LOAD_TEST_MODE server carrying that regime's env; the preflight gate runs before any load;
read-heavy runs are back-to-back. WAL and db_queue snapshots come from /api/health after each run.
Edit PRESETS in <code>scripts/loadTests/walAB.js</code> to add regimes.</div>
<p class="quiet">Raw data: logs/qa-run/walab-${key}.json · produced by scripts/loadTests/walAB.js</p>
</body></html>`;
  fs.writeFileSync(OUT_HTML, html);
  fs.writeFileSync(OUT_JSON, JSON.stringify({ preset: key, stamp: STAMP, runs: RUNS, warmup: WARMUP, regimes }, null, 2));
  console.log(`\nreport: ${path.relative(ROOT, OUT_HTML)}\nraw:    ${path.relative(ROOT, OUT_JSON)}`);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (/:3000/.test(process.env.BASE_URL || '')) {
    console.error('ABORT — BASE_URL points at :3000; this benchmark only ever targets :3100.');
    process.exitCode = 1;
    return;
  }
  console.log(`WAL A/B benchmark — preset "${key}", ${RUNS} runs/regime, warm-up ${WARMUP ? 'on' : 'off'}`);

  // Free :3100 and stop the dev stack so nothing shares CPU/disk during timing.
  const killed = await kill3100();
  if (killed) console.log(`killed ${killed} stale :3100 listener(s)`);
  const before = {};
  for (const port of [3000, 5174]) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
      before[port] = !!res?.ok;
    } catch { before[port] = false; }
  }
  const { stdout: ns1 } = await run('netstat', ['-ano', '-p', 'tcp'], { timeout: 20_000 });
  const devPids = [...new Set(ns1.split('\n').filter((l) => /:(3000|5174)\s+.*LISTENING/i.test(l))
    .map((l) => parseInt(l.trim().split(/\s+/).pop(), 10)).filter(Number.isInteger))];
  let stoppedDev = 0;
  for (const pid of devPids) {
    if (await stopNodePid(pid, { escalateAfterMs: 3000 })) stoppedDev += 1;
    else console.log(`  skipped pid ${pid} (:3000/:5174) — not a node process`);
  }
  if (stoppedDev) { console.log(`stopped dev stack (${stoppedDev} node listener(s)) for a quiet host`); await sleep(1200); }

  const regimes = [];
  try {
    for (const regime of PRESET) regimes.push({ name: regime.name, note: regime.note, env: regime.env, warmup: regime.warmup, rows: await benchRegime(regime, RUNS) });
    generateReport(regimes);
  } finally {
    await kill3100();
    fs.rmSync(RUNTIME, { recursive: true, force: true });
    // Restore the dev stack exactly as found (Vite only if it was running; it
    // does not serve /api/health, so probe :5174 for a 200 on any path).
    const apiWasUp = before[3000];
    if (apiWasUp || devPids.length) {
      // Tee the restored dev API's stdout/stderr: dev-mode logging never
      // reaches logs/*.log (stdout-only), so 'ignore' left the restored
      // stack unobservable. Same tee as testAll.spawnDetached.
      fs.mkdirSync(ROOT, { recursive: true });
      const logFd = fs.openSync(path.join(ROOT, 'logs', 'devstack.log'), 'a');
      fs.writeSync(logFd, `\n===== ${new Date().toISOString()} walAB.restoreDevApi =====\n`);
      const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, detached: true, stdio: ['ignore', logFd, logFd] });
      fs.closeSync(logFd);          // child holds its own duplicated handle
      child.unref();
      if (await waitHealthy('http://127.0.0.1:3000/api/health', 40_000)) console.log('dev API :3000 restored');
      else console.log('dev API :3000 FAILED to come back — check server logs');
    }
    if (before[5174] || devPids.length > 0) {
      const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5174', '--strictPort'], { cwd: ROOT, detached: true, stdio: 'ignore' });
      child.unref();
      console.log('Vite :5174 re-spawned');
    }
  }
  const anyFail = regimes.some((r) => r.rows.some((row) => row.exitCode !== 0 || row.failedThresholds?.length));
  process.exitCode = anyFail ? 1 : 0;
}

main().catch((err) => { console.error('walAB failed:', err.message); process.exitCode = 1; });
