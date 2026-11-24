#!/usr/bin/env node
/**
 * scripts/testAuthLimiter.js — failed-attempts-only auth rate limiter contract
 * (PLAN.MD §16.5 F4).
 *
 * Boots its OWN server instance (own port, own temp DB, own lock, own log
 * dir) with AUTH_RATE_LIMIT_MAX=5 so the cap is observable in a handful of
 * requests. Everything runs from one shared IP (127.0.0.1) and proves:
 *
 *   P1  N failed logins on one mailbox → 401 × max, then 429 (cap works)
 *   P2  a DIFFERENT mailbox on the same IP still logs in — the F4 fix:
 *       same-IP logins no longer lock each other out
 *   P3  the capped mailbox stays capped (its own bucket)
 *   P4  successful logins never spend the budget (skipSuccessfulRequests;
 *       the old count-everything limiter 429s partway through this burst)
 *   P5  failures still count after successes — same cap, then 429
 *
 * The old limiter (count everything, keyed by IP alone) fails P2 and P4, so
 * this suite discriminates the regression in both directions.
 *
 * Run: node scripts/testAuthLimiter.js   (registered in scripts/testAll.js)
 */

import { spawn } from 'child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 3989;
const MAX = 5; // must match AUTH_RATE_LIMIT_MAX passed to the server

let passed = 0;
let failed = 0;
const serverOutput = [];

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { /* keep null */ }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(cond, msg) {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (cond) passed++;
  else failed++;
}

function checkSeq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(ok, `${msg} — got [${actual}] expected [${expected}]`);
}

async function login(email, password) {
  const res = await request('POST', '/api/auth/login', { email, password });
  return res.status;
}

async function main() {
  const stamp = Date.now();
  const logDir = path.join(os.tmpdir(), `freebuff-authlim-log-${stamp}`);
  const dbDir = path.join(os.tmpdir(), `freebuff-authlim-db-${stamp}`);
  const dbPath = path.join(dbDir, 'test.sqlite');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(dbDir, { recursive: true });

  let serverProc = null;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Auth limiter: failed-only · email+IP keys       ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  try {
    console.log(`⏳ Starting isolated server on :${PORT} (AUTH_RATE_LIMIT_MAX=${MAX}, temp DB)…`);
    serverProc = spawn('node', ['server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'production',
        // env.js THROWS without JWT_SECRET in production (no silent fallback),
        // so the harness owns the secret for this isolated boot.
        JWT_SECRET: process.env.JWT_SECRET || 'qa-harness-secret-not-for-production',
        LOG_DIR: logDir,
        DB_PATH: dbPath,
        APP_LOCK_FILE: path.join(dbDir, '.test.lock'),
        AUTH_RATE_LIMIT_MAX: String(MAX),
        LOAD_TEST_MODE: '0', // the limiter must be ON for this suite
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout.on('data', (d) => serverOutput.push(String(d)));
    serverProc.stderr.on('data', (d) => serverOutput.push(String(d)));

    // Wait until the server answers (setup status is always accessible).
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const probe = () => {
        const req = http.get(`http://127.0.0.1:${PORT}/api/setup/status`, (res) => {
          res.resume();
          resolve();
        });
        req.on('error', () => {
          if (Date.now() - start > 20_000) reject(new Error('server did not start within 20 s'));
          else setTimeout(probe, 300);
        });
        req.end();
      };
      probe();
    });
    console.log('✅ Server up.\n');

    // First-run wizard on the fresh DB (NODE_ENV=production → setup gate),
    // same flow scripts/testLogging.js drives.
    const WIZARD = { name: 'Limiter Probe', email: 'root@limiter.local', password: 'testing123' };
    const create = await request('POST', '/api/setup/root-admin', WIZARD);
    check(create.status === 200, `setup: root admin created (${create.status})`);
    const status = await request('GET', '/api/setup/status');
    if (status.body?.status !== 'SETUP_DONE') {
      const done = await request('POST', '/api/setup/complete', {});
      check(done.status === 200, `setup: completed (${done.status})`);
    } else {
      check(true, 'setup: root-admin creation flipped status to SETUP_DONE');
    }

    const VICTIM = 'victim@limiter.local'; // no such account → 401 invalid email
    const ADMIN = WIZARD.email;

    // P1 — failures cap out on ONE mailbox: 401 × max, then 429.
    console.log('\n─── P1: failed logins hit the cap ───');
    const p1 = [];
    for (let i = 0; i < MAX + 1; i++) p1.push(await login(VICTIM, 'wrong-password'));
    checkSeq(p1, [...Array(MAX).fill(401), 429], `victim failures x${MAX + 1}`);

    // P2 — a DIFFERENT mailbox on the SAME IP still gets in (the F4 fix).
    console.log('\n─── P2: same IP, different mailbox still logs in ───');
    const p2 = [await login(ADMIN, WIZARD.password), await login(ADMIN, WIZARD.password)];
    checkSeq(p2, [200, 200], 'admin logins while victim is capped');

    // P3 — the capped mailbox stays capped (its own bucket).
    console.log('\n─── P3: capped mailbox stays capped ───');
    check((await login(VICTIM, 'wrong-password')) === 429, 'victim still 429');

    // P4 — successes never spend the budget: MAX+2 in a row. The old
    // count-everything limiter 429s partway through this burst.
    console.log('\n─── P4: successful logins do not count ───');
    const p4 = [];
    for (let i = 0; i < MAX + 2; i++) p4.push(await login(ADMIN, WIZARD.password));
    checkSeq(p4, Array(MAX + 2).fill(200), `admin success burst x${MAX + 2} (old limiter 429s midway)`);

    // P5 — but failures still count: the SAME account that just logged in
    // successfully 8 times caps out on wrong passwords.
    console.log('\n─── P5: failures still cap after successes ───');
    const p5 = [];
    for (let i = 0; i < MAX + 1; i++) p5.push(await login(ADMIN, 'still-wrong'));
    checkSeq(p5, [...Array(MAX).fill(401), 429], `admin failures x${MAX + 1} after successes`);
  } catch (err) {
    console.error('\n💥 Suite crashed:', err.message);
    failed++;
  } finally {
    // ── shutdown ──
    if (serverProc) {
      serverProc.kill('SIGTERM');
      await sleep(1000);
      if (!serverProc.killed) serverProc.kill('SIGKILL');
    }

    // cleanup temp dirs
    try { fs.rmSync(logDir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* best effort */ }

    if (failed > 0) {
      console.log('\n─── server output (last 40 lines) ───');
      console.log(serverOutput.join('').split(/\r?\n/).slice(-40).join('\n'));
    }

    console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
    // Let sockets drain before exit (Node 25/Windows keep-alive — bug #4).
    setTimeout(() => process.exit(failed ? 1 : 0), 250);
  }
}

main();
