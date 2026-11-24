#!/usr/bin/env node
/**
 * scripts/testAbortCleanup.mjs — abort-safety contract for testAllApi's seed
 * hygiene (the 2026-10-20 hardening: global purgeSuiteSeeds pre-clean + a
 * finally in every seeder phase).
 *
 * testAllApi seeds FIXED identifiers per phase (asset 'TEST-API-001' [assets.id
 * is the PK], 'Test API Kit', 'Test API Consumable', 'testcreated@test.com'
 * [UNIQUE], 'Test API Type' [UNIQUE], and the leave QA users + department).
 * Before the hardening every cleanup ran only on success, so an aborted run
 * leaked them and UNIQUE/PK seeds broke the NEXT run's create (409/500
 * cascade). This suite keeps that fix honest by replaying the abort:
 *
 *   P1  generate a probe copy of the CURRENT scripts/testAllApi.mjs with an
 *       observed-seed check + throw injected inside each seeder phase's try
 *       (anchors below; a drifted anchor fails loudly, forcing the two files
 *       to stay in sync)
 *   P2  run each probe against an ISOLATED instance — own port :3993, own
 *       seeded temp DB, own lock, rate-limit knobs raised via env. The
 *       isolation is load-bearing: probes run back-to-back and phase 2 burns
 *       deliberate failed logins, which would 429 race the dev server's
 *       30/15min auth cap and turn later probes into invalid worlds. NOTE:
 *       LOAD_TEST_MODE=1 is NOT usable here — it force-overrides DB_PATH to
 *       the shared load-test DB whenever LOAD_TEST_DB_PATH is set (which the
 *       shipped .env does), so the instance would silently serve the wrong
 *       database; high AUTH/GLOBAL/READ/WRITE_RATE_LIMIT_MAX achieve the same
 *       limiter silence without touching DB_PATH. One limiter is NOT
 *       env-configurable — passwordChangeLimiter is hardcoded max:3/15min
 *       (and phase 2 burns two change-password calls per probe), so the
 *       instance is restarted between probes for fresh in-memory state
 *   P3  each probe must abort (non-zero exit) with the injected error
 *   P4  the probe must have OBSERVED its seed right before the abort
 *       (PROBE-SEED-EXISTS:true), so a cleanup assertion can never pass
 *       vacuously because seeding itself broke
 *   P5  the probe must contain no 'FAIL:' lines — a degraded probe world
 *       (logins, 409s) invalidates the run rather than faking a pass
 *   P6  after every probe, ALL seven fixed identifiers must be absent from
 *       the temp DB — the finally ran and purged what the abort left behind
 *
 * Self-contained: no dev stack needed, touches no shared state. Registered in
 * scripts/testAll.js right after testAllApi.
 *
 * Run: node scripts/testAbortCleanup.mjs
 */

import { spawn } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(__dirname, 'testAllApi.mjs');
const RUNTIME = path.join(__dirname, '.runtime', 'abort-cleanup');
const PROBE_DIR = path.join(RUNTIME, 'probes');
const TEMP_DB = path.join(RUNTIME, 'database.sqlite');
const TEMP_LOCK = path.join(RUNTIME, 'server.lock');
const PROBE_LOCK = path.join(RUNTIME, 'probe.lock');
const PORT = 3993;
const API = `http://localhost:${PORT}/api`;
const PROBE_TIMEOUT_MS = 180000; // probes abort mid-sweep; generous ceiling

let passed = 0;
let failed = 0;
const fail = (msg) => { failed++; console.log(`  FAIL: ${msg}`); };
const check = (cond, msg) => { if (cond) { passed++; console.log(`  ok:   ${msg}`); } else { fail(msg); } };

// One entry per seeder phase. `anchor` is a unique line in the current
// testAllApi.mjs; `seedCheck` is injected immediately before the throw and
// must log PROBE-SEED-EXISTS:true (the seed existed at abort time).
const PROBES = [
  {
    name: 'phase5-asset', tag: 'abort-probe phase 5',
    anchor: "const createdAssetId = createAssetData.id;",
    seedCheck: "console.log('PROBE-SEED-EXISTS:' + JSON.stringify((await api('GET', '/assets/TEST-API-001', null, adminToken)).status === 200));",
  },
  {
    name: 'phase67-user', tag: 'abort-probe phase 6-7',
    anchor: "assertStatus(newUser.status, 200, 'Admin creates user');",
    seedCheck: "console.log('PROBE-SEED-EXISTS:' + JSON.stringify(((await api('GET', '/users', null, adminToken)).data || []).some(u => u.email === 'testcreated@test.com')));",
  },
  {
    name: 'phase9-kit', tag: 'abort-probe phase 9',
    anchor: "assertStatus(newKit.status, 200, 'Create kit');",
    seedCheck: "console.log('PROBE-SEED-EXISTS:' + JSON.stringify(((await api('GET', '/kits', null, adminToken)).data || []).some(k => k.name === 'Test API Kit')));",
  },
  {
    name: 'phase10-consumable', tag: 'abort-probe phase 10',
    anchor: "assertStatus(newConsumable.status, 200, 'Create consumable');",
    seedCheck: "console.log('PROBE-SEED-EXISTS:' + JSON.stringify(((await api('GET', '/consumables', null, adminToken)).data || []).some(c => c.name === 'Test API Consumable')));",
  },
  {
    name: 'phase11-type', tag: 'abort-probe phase 11',
    anchor: "assertStatus(newType.status, 200, 'Create asset type');",
    seedCheck: "console.log('PROBE-SEED-EXISTS:' + JSON.stringify(((await api('GET', '/asset-types', null, adminToken)).data || []).some(t => t.name === 'Test API Type')));",
  },
  {
    name: 'phase12-leave', tag: 'abort-probe phase 12',
    anchor: "const leaveReqId = leaveReq.data?.id;",
    seedCheck: "console.log('PROBE-SEED-EXISTS:' + JSON.stringify(((await api('GET', '/users', null, adminToken)).data || []).some(u => u.email === 'leave-mgr@qa.local')));",
  },
];

// All seven fixed identifiers — asserted absent from the temp DB after EVERY
// probe, not just the probed phase's own seed: a leak anywhere is a regression.
async function leftoverCounts() {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(TEMP_DB, { readonly: true });
  try {
    return db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM assets      WHERE id = 'TEST-API-001')                 AS asset,
        (SELECT COUNT(*) FROM kits        WHERE name = 'Test API Kit')               AS kit,
        (SELECT COUNT(*) FROM consumables WHERE name = 'Test API Consumable')        AS consumable,
        (SELECT COUNT(*) FROM asset_types WHERE name = 'Test API Type')              AS type,
        (SELECT COUNT(*) FROM users       WHERE email = 'testcreated@test.com')      AS testuser,
        (SELECT COUNT(*) FROM users       WHERE email IN ('leave-mgr@qa.local', 'leave-staff@qa.local')) AS leaveusers,
        (SELECT COUNT(*) FROM departments WHERE name = 'API-Leave-QA')              AS dept
    `).get();
  } finally {
    db.close();
  }
}

const tail = (s, n = 60) => s.trimEnd().split('\n').slice(-n).join('\n');

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

function stopServer(s) {
  return new Promise((resolve) => {
    if (!s || s.child.exitCode !== null) return resolve();
    const killer = setTimeout(() => { try { s.child.kill('SIGKILL'); } catch { /* gone */ } }, 15000);
    s.child.once('close', () => { clearTimeout(killer); resolve(); });
    s.child.kill('SIGTERM'); // graceful drain; the suite reaps within 15s regardless
  });
}

function startServer() {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: TEMP_DB,
      APP_LOCK_FILE: TEMP_LOCK,
      // Limiter silence WITHOUT LOAD_TEST_MODE (which would redirect DB_PATH
      // to the shared load-test DB — see the header note in P2).
      AUTH_RATE_LIMIT_MAX: '10000000',
      GLOBAL_RATE_LIMIT_MAX: '10000000',
      READ_RATE_LIMIT_MAX: '10000000',
      WRITE_RATE_LIMIT_MAX: '10000000',
    },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return { child, output: () => out };
}

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function buildProbe(p, src) {
  const idx = src.indexOf(p.anchor);
  if (idx < 0) throw new Error(`anchor not found in testAllApi.mjs: ${p.name} — ${p.anchor}`);
  const body = src
    // Point the probe at THIS suite's isolated instance + temp DB.
    .replace("const BASE = 'http://localhost:3000/api';", `const BASE = '${API}';`)
    .replaceAll("'./database.sqlite'", JSON.stringify(TEMP_DB))
    // The probe lives one directory deeper than testAllApi.mjs, so the phase-2
    // leave-purge import needs one more '..' to still resolve.
    .replaceAll("'../server/database.js'", "'../../server/database.js'")
    .replace(p.anchor, `${p.anchor}\n  ${p.seedCheck}\n  throw new Error('${p.tag}');`);
  const out = path.join(PROBE_DIR, `probe-${p.name}.mjs`);
  fs.writeFileSync(out, body);
  return out;
}

function runProbe(probePath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [probePath], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH: TEMP_DB, APP_LOCK_FILE: PROBE_LOCK },
    });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), PROBE_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

console.log('\n=== ABORT-CLEANUP CONTRACT (testAllApi seed hygiene) ===');

if (!fs.existsSync(SRC)) {
  console.error(`FAIL: cannot find ${SRC}`);
  process.exit(1);
}

fs.rmSync(RUNTIME, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
fs.mkdirSync(PROBE_DIR, { recursive: true });

let server = null;
// A SIGTERM/SIGKILL from a parent runner must not orphan the isolated server.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { server?.child.kill('SIGKILL'); } catch { /* already gone */ }
    process.exit(130);
  });
}

try {
  console.log('\n--- isolated instance (temp DB + own port) ---');
  const seed = await runNode(['scripts/resetDb.js'], {
    DB_PATH: TEMP_DB,
    RESET_DB_ALLOW_LIVE: '1', // the guard exists for the LIVE db; this is a temp file
  });
  check(seed.code === 0, `temp DB seeded via resetDb (exit ${seed.code})`);
  if (seed.code !== 0) console.log(tail(seed.out).replace(/^/gm, '  | '));

  server = startServer();
  const healthy = await waitForHealth();
  check(healthy, `isolated API healthy on :${PORT}`);
  if (!healthy) {
    console.log(tail(server.output()).replace(/^/gm, '  | '));
    throw new Error('isolated server failed to boot');
  }

  const src = fs.readFileSync(SRC, 'utf8');

  for (const p of PROBES) {
    console.log(`\n--- ${p.name} ---`);
    let probePath;
    try {
      probePath = buildProbe(p, src);
    } catch (e) {
      fail(`probe generation: ${e.message}`);
      continue;
    }

    const { code, out } = await runProbe(probePath);

    check(code !== 0, `probe aborted (exit ${code} !== 0)`);
    check(out.includes(p.tag), 'injected abort fired at the intended anchor');
    check(out.includes('PROBE-SEED-EXISTS:true'), 'seed existed at abort time (non-vacuous)');
    check(!out.includes('FAIL:'), 'no assertion failures inside the probe world');
    if (out.includes('FAIL:') || !out.includes('PROBE-SEED-EXISTS:true')) {
      console.log('  --- probe output tail ---');
      console.log(tail(out).replace(/^/gm, '  | '));
      console.log('  -------------------------');
    }

    const left = await leftoverCounts();
    const leaked = Object.entries(left).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`);
    check(leaked.length === 0, `finally purge left nothing behind${leaked.length ? ` — LEAKED: ${leaked.join(', ')}` : ''}`);

    if (p !== PROBES[PROBES.length - 1]) {
      // Fresh instance per probe: in-memory limiters (notably the hardcoded
      // passwordChangeLimiter max:3/15min) accumulate across probes otherwise.
      await stopServer(server);
      server = startServer();
      check(await waitForHealth(), `isolated API healthy again on :${PORT} (fresh limiter state)`);
    }
  }
} finally {
  // Wait for the instance to actually exit before removing its files — on
  // Windows the graceful drain keeps database.sqlite open and rmSync EPERMs.
  await stopServer(server);
  try {
    fs.rmSync(RUNTIME, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    console.warn(`  WARN: could not remove ${path.relative(ROOT, RUNTIME)}: ${e.message}`);
  }
}

console.log('\n' + '='.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
