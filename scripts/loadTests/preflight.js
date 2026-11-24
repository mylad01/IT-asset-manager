#!/usr/bin/env node
/**
 * scripts/loadTests/preflight.js — fail-fast gate before any k6 scenario.
 *
 * Wired into every `npm run load:*` script ahead of k6. Asserts, in order:
 *
 *   1. The load-test server answers /api/health on BASE_URL (default :3100)
 *      — and BASE_URL is NOT the dev server on :3000.
 *   2. The server's WAL is under PREFLIGHT_WAL_MAX_MB (default 1MB), read
 *      from the /api/health `wal_bytes` field with a filesystem fallback to
 *      `<DB_PATH>-wal`. A WAL that starts big only grows: the 200-VU read
 *      storm lengthens every checkpoint, so the latency tail measured by the
 *      scenarios would describe leftover state, not the code under test.
 *      Fresh boots get a settle window (default 90s): the server's first
 *      periodic checkpoint (60s cadence) truncates the seed WAL, so the
 *      preflight re-polls instead of failing the documented runbook flow.
 *   3. The host has at least PREFLIGHT_MIN_FREE_RAM_MB (default 2048MB) of
 *      free RAM — k6 at 200 VUs plus the server need headroom, and a
 *      memory-starved run produces p95 noise that looks like a regression.
 *
 * Env overrides: BASE_URL, DB_PATH, PREFLIGHT_WAL_MAX_MB,
 * PREFLIGHT_MIN_FREE_RAM_MB, PREFLIGHT_WAL_SETTLE_MS.
 *
 * Output: one line per check plus a PASS/FAIL verdict. Exit 0 only when all
 * checks pass, so `npm run load:*` never reaches k6 on a bad foundation.
 * Exit is delayed 250ms after the verdict — a bare synchronous
 * process.exit() rips undici's keep-alive sockets mid-close and trips a
 * libuv assertion on Node 25/Windows (same bug #4 class as testSecurity:
 * observed as exit 127 after a fully-correct failing verdict).
 */
import fs from 'node:fs';
import os from 'node:os';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
const WAL_MAX_BYTES = (parseInt(process.env.PREFLIGHT_WAL_MAX_MB, 10) || 1) * 1024 * 1024;
const MIN_FREE_RAM = parseInt(process.env.PREFLIGHT_MIN_FREE_RAM_MB, 10) || 2048;
const WAL_SETTLE_MS = parseInt(process.env.PREFLIGHT_WAL_SETTLE_MS, 10);
const WAL_SETTLE = Number.isInteger(WAL_SETTLE_MS) ? WAL_SETTLE_MS : 90_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Delayed exit — never a bare synchronous process.exit() (libuv assertion,
 *  see header + PLAN.MD bug #4). Deliberately NOT unref'd: an unref'd timer
 *  never fires if the event loop drains first, and the process then exits 0
 *  even on a failing verdict (observed live). */
const finish = (code) => setTimeout(() => process.exit(code), 250);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;

const results = [];
const check = (ok, name, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const fetchHealth = async () => {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) return await res.json();
  } catch { /* handled below */ }
  return null;
};

async function main() {
  // ── 1. The load-test server must be up, and it must not be the dev one ──
  let health = await fetchHealth();

  check(!!health, `load-test server answers on ${BASE_URL}`,
    health ? `integrity ${health.integrity || '?'}, state ${health.state || '?'}` : 'no response — start it with `npm run test:server` (runbook step 2)');

  if (!health) {
    console.log('\n❌ PREFLIGHT FAILED — load-test server is not reachable. Nothing was load-tested.');
    finish(1);
    return;
  }

  const healthPort = (() => { try { return new URL(BASE_URL).port; } catch { return ''; } })();
  if (healthPort === '3000' || /:3000\/?$/.test(BASE_URL)) {
    check(false, 'BASE_URL must target the load-test server (:3100), not the dev server (:3000)');
  } else {
    check(true, `target port sanity (${healthPort || 'default'}) — dev DB out of the blast radius`);
  }

  // ── 2. WAL must start (almost) clean ────────────────────────────────────
  // Health's wal_bytes is the server's own view (null when disabled). If it
  // is absent, fall back to stat-ing <DB_PATH>-wal directly. A fresh boot+
  // seed briefly sits above the bar until the first 60s periodic checkpoint
  // — the settle window re-polls instead of failing the documented flow.
  const dbPath = process.env.DB_PATH || './scripts/loadTests/.runtime/database.loadtest.sqlite';
  const readWal = () => {
    if (typeof health?.wal_bytes === 'number') return { bytes: health.wal_bytes, source: 'health endpoint' };
    try { return { bytes: fs.statSync(`${dbPath}-wal`).size, source: `${dbPath}-wal` }; }
    catch { return { bytes: null, source: `${dbPath}-wal` }; }
  };

  let wal = readWal();
  if (wal.bytes === null) {
    check(false, `WAL size readable (${wal.source})`, 'no wal_bytes in health and no -wal file on disk — wrong DB_PATH?');
  } else {
    if (wal.bytes > WAL_MAX_BYTES && WAL_SETTLE > 0) {
      console.log(`  … WAL ${mb(wal.bytes)} > ${mb(WAL_MAX_BYTES)} — waiting up to ${WAL_SETTLE / 1000}s for the server's periodic checkpoint (60s cadence) to truncate it`);
      const deadline = Date.now() + WAL_SETTLE;
      while (wal.bytes > WAL_MAX_BYTES && Date.now() < deadline) {
        await sleep(5000);
        health = (await fetchHealth()) || health;
        wal = readWal();
      }
    }
    check(wal.bytes <= WAL_MAX_BYTES, `WAL starts under ${mb(WAL_MAX_BYTES)} (${wal.source})`,
      `${mb(wal.bytes)}${wal.bytes > WAL_MAX_BYTES ? ' — rerun runbook step 1 (wipe .runtime, reseed) or force a PRAGMA wal_checkpoint(TRUNCATE) before loading' : ''}`);
  }

  // ── 3. Host must have RAM headroom ────────────────────────────────────
  const freeRam = os.freemem();
  check(freeRam >= MIN_FREE_RAM * 1024 * 1024, `host free RAM ≥ ${MIN_FREE_RAM}MB`,
    `${(freeRam / 1024 ** 3).toFixed(2)}GB free of ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB`);

  const failed = results.filter((r) => !r).length;
  if (failed) {
    console.log(`\n❌ PREFLIGHT FAILED — ${failed} check(s) did not pass. k6 was NOT started.`);
    console.log('   Fix the items above, then re-run the scenario.');
    finish(1);
    return;
  }
  console.log('\n✅ Preflight passed — starting k6.');
  finish(0);
}

main();
