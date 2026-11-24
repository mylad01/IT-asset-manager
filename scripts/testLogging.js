#!/usr/bin/env node
/**
 * scripts/testLogging.js
 *
 * Automated verification of the Pino structured logging system.
 * Tests: 200 OK logging, password redaction, 500 error stack capture,
 *        X-Request-Id correlation, and log file creation.
 *
 * Usage: node scripts/testLogging.js
 */

import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── helpers ────────────────────────────────────────────────────────

function request(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readLogFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function findLogFile(dir, pattern) {
  const files = listDir(dir);
  for (const f of files) {
    if (pattern.test(f)) return path.join(dir, f);
  }
  return null;
}

// ── main ───────────────────────────────────────────────────────────

async function main() {
  let passed = 0;
  let failed = 0;
  let serverProc = null;

  const logDir = path.join(os.tmpdir(), `freebuff-test-logs-${Date.now()}`);
  const dbDir = path.join(os.tmpdir(), `freebuff-test-db-${Date.now()}`);
  const dbPath = path.join(dbDir, 'test.sqlite');
  const PORT = 3987;

  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(dbDir, { recursive: true });

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Structured Logging Verification Suite         ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  try {
    // ── start server with JSON logging to temp dir ──
    console.log('⏳ Starting server on port', PORT, '…');

    serverProc = spawn('node', ['server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'production',
        // env.js THROWS without JWT_SECRET in production (no silent fallback),
        // so the harness owns the secret for this isolated boot. Without it a
        // checkout that has no local .env cannot run this suite at all.
        JWT_SECRET: process.env.JWT_SECRET || 'qa-harness-secret-not-for-production',
        LOG_LEVEL: 'debug',
        LOG_DIR: logDir,
        DB_PATH: dbPath,
        // Own lock file: this instance is fully isolated (own port + DB), so it
        // must not collide with a running dev server's logs/.app.lock.
        APP_LOCK_FILE: path.join(dbDir, '.test.lock'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProc.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`));
    serverProc.stderr.on('data', (d) => process.stderr.write(`  [server:err] ${d}`));

    // wait until server is listening
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const probe = () => {
        const req = http.get(`http://127.0.0.1:${PORT}/api/auth/login`, (res) => {
          res.resume();
          resolve();
        });
        req.on('error', () => {
          if (Date.now() - start > 15_000) {
            reject(new Error('Server did not start within 15 s'));
          } else {
            setTimeout(probe, 300);
          }
        });
        req.end();
      };
      probe();
    });

    console.log('✅ Server is up.\n');

    // ──────────────────────────────────────────────────
    // SETUP BOOTSTRAP – first-run wizard on a fresh DB.
    // NODE_ENV=production skips the dev auto-seed, so the setup gate is
    // active (409 in_setup) until setup completes. Drive the same flow
    // the frontend wizard uses: create the root admin, which flips
    // getStatus() to SETUP_DONE and opens the API.
    // ──────────────────────────────────────────────────
    const WIZARD_ADMIN = { email: 'root@testing.local', password: 'testing123', name: 'Test Root' };
    console.log('⏳ Completing first-run setup (fresh test DB)…');
    const rootRes = await request(PORT, 'POST', '/api/setup/root-admin', WIZARD_ADMIN);
    if (rootRes.status !== 200) {
      throw new Error(`Setup root-admin failed (${rootRes.status}): ${JSON.stringify(rootRes.body)}`);
    }
    const statusRes = await request(PORT, 'GET', '/api/setup/status');
    if (statusRes.body?.status !== 'SETUP_DONE') {
      const completeRes = await request(PORT, 'POST', '/api/setup/complete', {});
      if (completeRes.status !== 200) {
        throw new Error(`Setup complete failed (${completeRes.status}): ${JSON.stringify(completeRes.body)}`);
      }
    }
    console.log('✅ Setup completed.\n');

    // ──────────────────────────────────────────────────
    // TEST 1 – Valid login → 200 OK with reqId log
    // ──────────────────────────────────────────────
    console.log('─── Test 1: Valid login → 200 OK ───');

    const loginRes = await request(PORT, 'POST', '/api/auth/login', {
      email: WIZARD_ADMIN.email,
      password: WIZARD_ADMIN.password,
    });

    const reqId1 = loginRes.headers['x-request-id'];
    console.log(`  Response: ${loginRes.status}`);
    console.log(`  X-Request-Id: ${reqId1 ?? 'MISSING'}`);

    if (loginRes.status === 200 && reqId1) {
      console.log('  ✅ Pass – 200 with X-Request-Id');
      passed++;
    } else {
      console.log('  ❌ Fail');
      failed++;
    }

    // Give pino-roll worker thread time to flush to disk
    await sleep(2000);

    // pino-roll names files like: app.1.log  or  app.2026-08-31.1.log
    const appLogFile = findLogFile(logDir, /^app\..*\.log$/);
    const logs1 = appLogFile ? readLogFile(appLogFile) : '';

    if (reqId1 && logs1.includes(reqId1) && logs1.includes('"statusCode":200')) {
      console.log('  ✅ Pass – reqId found in JSON logs with status 200');
      passed++;
    } else {
      console.log('  ❌ Fail – reqId or status 200 not found in logs');
      if (!appLogFile) console.log('    (no app log file found — listing dir:', listDir(logDir).join(', '), ')');
      failed++;
    }

    // ────────────────────────────────────────────────────
    // TEST 2 – Bad password → 400/401 + password is redacted
    // ────────────────────────────────────────────────────
    console.log('\n─── Test 2: Bad credentials → password redaction ───');

    const badPw = 's3cretP@ss!xyz';
    const badRes = await request(PORT, 'POST', '/api/auth/login', {
      email: WIZARD_ADMIN.email,
      password: badPw,
    });

    console.log(`  Response: ${badRes.status}`);

    if (badRes.status === 400 || badRes.status === 401) {
      console.log('  ✅ Pass – rejected as expected');
      passed++;
    } else {
      console.log('  ❌ Fail – expected 400/401, got', badRes.status);
      failed++;
    }

    await sleep(2000);

    const logs2 = appLogFile ? readLogFile(appLogFile) : '';
    if (logs2.includes(badPw)) {
      console.log('  ❌ Fail – plaintext password FOUND in logs (redaction broken!)');
      failed++;
    } else if (logs2.includes('[REDACTED]')) {
      console.log('  ✅ Pass – password correctly redacted as [REDACTED]');
      passed++;
    } else {
      // Check that the bad password doesn't appear in any log context
      // The password field is redacted at the logger level, so [REDACTED] should appear
      // in the pino-http serialized req body if body logging is enabled
      console.log('  ⚠  Info – password not found in plaintext (good), no [REDACTED] marker visible');
      console.log('    (password was never logged in request body — redaction path not triggered)');
      passed++;
    }

    // ──────────────────────────────────────────────────
    // TEST 3 – Trigger 500 → error stack in log
    // ──────────────────────────────────────────────────
    console.log('\n─── Test 3: 500 Internal Server Error ───');

    const errRes = await request(PORT, 'GET', '/api/_test/error', null, {
      Authorization: 'Bearer fake-token-for-test',
    });

    console.log(`  Response: ${errRes.status}`);

    if (errRes.status === 500) {
      console.log('  ✅ Pass – 500 returned');
      passed++;
    } else {
      console.log('  ❌ Fail – expected 500, got', errRes.status);
      failed++;
    }

    await sleep(2000);

    // Re-read all logs (including error log)
    const errorLogFile = findLogFile(logDir, /^error\..*\.log$/);
    const errLogs = errorLogFile ? readLogFile(errorLogFile) : '';
    const allLogs = (appLogFile ? readLogFile(appLogFile) : '') + errLogs;

    // Check the error handler's req.log.error() call and pino-http error logging
    const hasErrorMessage = allLogs.includes('Intentional test error');
    const hasLevel50 = allLogs.includes('"level":50');

    if (hasErrorMessage && hasLevel50) {
      console.log('  ✅ Pass – error message + level 50 (error) found in logs');
      passed++;
    } else {
      console.log('  ❌ Fail – error stack not found in logs');
      if (!hasErrorMessage) console.log('    (searched for "Intentional test error")');
      if (!hasLevel50) console.log('    (searched for level 50)');
      console.log('    Dir contents:', listDir(logDir).join(', '));
      failed++;
    }

    // ──────────────────────────────────────────────────────────
    // TEST 4 – X-Request-Id correlation across request lifecycle
    // ──────────────────────────────────────────────────────────
    console.log('\n─── Test 4: X-Request-Id correlation ───');

    const correlationId = 'test-cid-' + Date.now();
    const corrRes = await request(PORT, 'POST', '/api/auth/login', {
      email: 'nonexistent@test.com',
      password: 'whatever',
    }, { 'X-Request-Id': correlationId });

    console.log(`  Sent X-Request-Id: ${correlationId}`);
    console.log(`  Received X-Request-Id: ${corrRes.headers['x-request-id'] ?? 'MISSING'}`);

    if (corrRes.headers['x-request-id'] === correlationId) {
      console.log('  ✅ Pass – header echoed back');
      passed++;
    } else {
      console.log('  ❌ Fail – header not echoed');
      failed++;
    }

    await sleep(2000);

    const latestLogs = appLogFile ? readLogFile(appLogFile) : '';
    if (latestLogs.includes(correlationId)) {
      console.log('  ✅ Pass – correlationId found in JSON log entries');
      passed++;
    } else {
      console.log('  ❌ Fail – correlationId not found in logs');
      failed++;
    }

    // ───────────────────────────────────────────────
    // TEST 5 – logs/ directory and file verification
    // ───────────────────────────────────────────────
    console.log('\n─── Test 5: Log file creation ───');
    console.log(`  Log directory: ${logDir}`);

    if (fs.existsSync(logDir)) {
      console.log('  ✅ Pass – logs directory exists');
      passed++;
    } else {
      console.log('  ❌ Fail – logs directory missing');
      failed++;
    }

    const dirContents = listDir(logDir);
    console.log(`  Directory contents: ${dirContents.length > 0 ? dirContents.join(', ') : '(empty)'}`);

    // pino-roll creates files like: app.2026-08-31.1.log  (pattern: {name}.{date}.{num}.{ext})
    const hasAppLog = dirContents.some((f) => /^app\..+\.log$/.test(f));
    const hasErrorLog = dirContents.some((f) => /^error\..+\.log$/.test(f));

    if (hasAppLog) {
      console.log('  ✅ Pass – app log file found (pattern: app.*.log)');
      passed++;
    } else {
      console.log('  ❌ Fail – app log file not found');
      failed++;
    }

    if (hasErrorLog) {
      console.log('  ✅ Pass – error log file found (pattern: error.*.log)');
      passed++;
    } else {
      console.log('  ❌ Fail – error log file not found');
      failed++;
    }

    // Check file sizes
    for (const f of dirContents) {
      const fPath = path.join(logDir, f);
      const stat = fs.statSync(fPath);
      console.log(`    ${f}: ${stat.size} bytes`);
      if (stat.size > 0) {
        console.log(`  ✅ Pass – ${f} is non-empty`);
        passed++;
      } else {
        console.log(`  ❌ Fail – ${f} is empty`);
        failed++;
      }
    }
  } catch (err) {
    console.error('\n💥 Test runner crashed:', err.message);
    failed++;
  } finally {
    // ── shutdown ──
    if (serverProc) {
      serverProc.kill('SIGTERM');
      await sleep(1000);
      if (!serverProc.killed) serverProc.kill('SIGKILL');
    }

    // cleanup temp dirs
    try { fs.rmSync(logDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch {}

    // ── summary ──
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log(`║  Results:  ${passed} passed,  ${failed} failed`);
    console.log('╚══════════════════════════════════════════════════╝\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
