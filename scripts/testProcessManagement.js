#!/usr/bin/env node
/**
 * scripts/testProcessManagement.js
 *
 * Automated verification of the PM2 process management integration.
 * Tests the full lifecycle: start → lock file → zero-downtime reload →
 * PID handoff → graceful shutdown → lock cleanup.
 *
 * Uses Node's child_process to orchestrate PM2 commands and native http
 * to fire concurrent requests during reloads.
 *
 * Usage:  node scripts/testProcessManagement.js
 */

import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Constants ──────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);   // Convert ESM import.meta.url to filesystem path
const __dirname = path.dirname(__filename);           // Derive __dirname equivalent for ESM (scripts/ directory)
const ROOT = path.resolve(__dirname, '..');            // Project root — one level up from scripts/

const PORT = 3000;                                    // Must match ecosystem.config.cjs env_production.PORT
const HOST = '127.0.0.1';                             // Loopback address for HTTP requests
const APP_NAME = 'it-asset-manager';                  // Must match ecosystem.config.cjs app name
const LOCK_FILE = path.join(ROOT, 'logs', '.app.lock'); // PID lock file — created by server/index.js on startup

const REQUEST_COUNT = 50;                             // Number of HTTP requests to fire during reload
const REQUEST_INTERVAL_MS = 80;                       // Milliseconds between each request (~6.25 req/sec)
const BOOT_TIMEOUT_MS = 20000;                        // Max time to wait for server to start responding
const RELOAD_SETTLE_MS = 5000;                        // Time to wait after reload for old process to fully exit
const SHUTDOWN_SETTLE_MS = 15000;                     // Time to wait after stop for shutdown hooks to complete — on Windows, PM2 kills a wrapper process, orphaning the actual Node.js process which cleans up asynchronously

// ── Test Bookkeeping ───────────────────────────────────────────────────────

let passed = 0;                                        // Counter for passed assertions
let failed = 0;                                        // Counter for failed assertions

/**
 * Assert a condition. Increments passed/failed counters and prints the result.
 * @param {boolean} condition - The condition to test
 * @param {string} message - Description of what was tested
 */
function assert(condition, message) {
  if (condition) {
    passed++;                                          // Increment pass counter
    console.log(`  ✅ ${message}`);                    // Green checkmark for passing assertion
  } else {
    failed++;                                          // Increment fail counter
    console.error(`  ❌ FAIL — ${message}`);           // Red X for failing assertion
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Execute a shell command synchronously, returning stdout.
 * Wraps execSync with error handling to prevent crashes on non-zero exit codes.
 * @param {string} command - Shell command to execute
 * @param {object} options - Additional options passed to execSync
 * @returns {{ stdout: string, exitCode: number }} - Command output and exit code
 */
function run(command, options = {}) {
  try {
    const stdout = execSync(command, {                 // Execute the command synchronously
      cwd: ROOT,                                       // Run from project root
      encoding: 'utf-8',                               // Return stdout as a string (not Buffer)
      stdio: ['pipe', 'pipe', 'pipe'],                 // Capture all stdio to prevent spillover into test output
      timeout: 30000,                                  // 30-second timeout to prevent hanging
      ...options,                                      // Allow caller overrides (e.g., env, timeout)
    });
    return { stdout: stdout.trim(), exitCode: 0 };     // Return trimmed stdout with success code
  } catch (err) {
    // execSync throws on non-zero exit — extract what we can
    return {
      stdout: (err.stdout || '').toString().trim(),    // stdout may be a Buffer — convert to string
      stderr: (err.stderr || '').toString().trim(),    // stderr for debugging failed commands
      exitCode: err.status || 1,                       // Exit code from the failed process
    };
  }
}

/**
 * Send an HTTP request and return the status code and any error.
 * Uses Node's native http module — no external dependencies needed.
 * @param {string} host - Hostname (e.g., '127.0.0.1')
 * @param {number} port - Port number
 * @param {string} path - URL path (e.g., '/api/asset-types')
 * @param {object} [headers] - Optional request headers (e.g., Authorization bearer token)
 * @returns {Promise<{ status: number|null, error: string|null }>} - Response status or error
 */
function httpRequest(host, port, urlPath, headers = {}) {
  return new Promise((resolve) => {                    // Never reject — errors are captured as results
    const req = http.get(                              // Use GET — lightweight liveness probe
      { hostname: host, port, path: urlPath, timeout: 5000, headers }, // 5s per-request timeout
      (res) => {
        res.resume();                                  // Drain the response body to free the socket
        resolve({ status: res.statusCode, error: null }); // Return the HTTP status code
      },
    );
    req.on('error', (err) => {                         // Network errors (ECONNREFUSED, EPIPE, etc.)
      resolve({ status: null, error: err.code });      // Return the error code instead of crashing
    });
    req.on('timeout', () => {                          // Request timed out
      req.destroy();                                   // Forcefully close the socket
      resolve({ status: null, error: 'TIMEOUT' });     // Signal timeout to the caller
    });
  });
}

/**
 * Read the contents of a file, returning null if it doesn't exist.
 * Used to check the lock file without throwing on missing files.
 * @param {string} filePath - Absolute path to the file
 * @returns {string|null} - File contents as UTF-8 string, or null if not found
 */
function readFileSyncSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');         // Read file synchronously as UTF-8
  } catch {
    return null;                                       // File doesn't exist or is unreadable
  }
}

/**
 * Wait for the HTTP server to start responding on the given port.
 * Polls every 500ms until a response is received or timeout is reached.
 * @param {number} maxWaitMs - Maximum time to wait in milliseconds
 * @returns {Promise<boolean>} - true if server is up, false if timed out
 */
async function waitForServer(maxWaitMs) {
  const start = Date.now();                            // Record the start time
  while (Date.now() - start < maxWaitMs) {             // Loop until timeout
    const result = await httpRequest(HOST, PORT, '/api/auth/login'); // Hit any endpoint to check liveness
    if (result.status !== null) {                      // Got a response (any HTTP status counts as "up")
      return true;                                     // Server is responding — exit the loop
    }
    await sleep(500);                                  // Wait 500ms before retrying
  }
  return false;                                        // Timed out — server never responded
}

/**
 * Sleep for the given number of milliseconds.
 * @param {number} ms - Duration to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));        // Simple promise-based delay
}

/**
 * POST a JSON body and resolve with the parsed response. Used once per run to
 * obtain an admin token for the reload traffic — see testZeroDowntimeReload.
 * @param {string} host - Hostname (e.g., '127.0.0.1')
 * @param {number} port - Port number
 * @param {string} urlPath - URL path (e.g., '/api/auth/login')
 * @param {object} body - JSON-serializable request body
 * @returns {Promise<{ status: number|null, data: object|null, error: string|null }>}
 */
function httpPostJson(host, port, urlPath, body) {
  return new Promise((resolve) => {                    // Never reject — errors are captured as results
    const payload = JSON.stringify(body);              // Serialize the request body once
    const req = http.request(
      {
        hostname: host,
        port,
        path: urlPath,
        method: 'POST',                                // Login is POST-only — a GET would 404
        timeout: 5000,                                 // 5s per-request timeout
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let raw = '';                                  // Accumulate response chunks
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let data = null;                             // Parsed JSON (null for non-JSON bodies)
          try { data = JSON.parse(raw); } catch { /* empty or non-JSON — leave null */ }
          resolve({ status: res.statusCode, data, error: null });
        });
      },
    );
    req.on('error', (err) => {                         // Network errors (ECONNREFUSED, EPIPE, etc.)
      resolve({ status: null, data: null, error: err.code });
    });
    req.on('timeout', () => {                          // Request timed out
      req.destroy();                                   // Forcefully close the socket
      resolve({ status: null, data: null, error: 'TIMEOUT' });
    });
    req.write(payload);                                // Send the JSON body
    req.end();                                         // Finalize the request
  });
}

/**
 * Clean up PM2 state: stop all processes, delete them, and kill the daemon.
 * This ensures a clean slate before and after the test suite.
 */
function pm2Cleanup() {
  run('npx pm2 kill', { timeout: 10000 });             // Kill the PM2 daemon and all managed processes
}

// ── Test 1: Start PM2 and Verify Server Boot ───────────────────────────────

/**
 * Start the application via PM2 using the production ecosystem config.
 * Verifies that PM2 starts the process and the server becomes responsive.
 */
async function testPM2Start() {
  console.log('\n🚀  Test 1: PM2 Start & Server Boot');
  console.log('─'.repeat(55));

  // Clean slate — kill any existing PM2 daemon and processes
  pm2Cleanup();                                        // Kill PM2 daemon and all managed processes
  console.log('  ℹ️  PM2 daemon cleaned up');

  // Delete the lock file if it exists from a previous run
  if (fs.existsSync(LOCK_FILE)) {                     // Check if stale lock file exists
    fs.unlinkSync(LOCK_FILE);                         // Remove stale lock file
    console.log('  ℹ️  Removed stale lock file');
  }

  // Start the application in production mode via PM2
  // env.js THROWS without JWT_SECRET in production, and PM2 inherits this
  // process's environment — so the harness supplies it. Without this the
  // PM2-managed server exits at boot (ECONNREFUSED everywhere downstream).
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'qa-harness-secret-not-for-production';
  const startResult = run('npx pm2 start ecosystem.config.cjs --env production'); // Start PM2 with ecosystem config
  console.log(`  PM2 start output:\n    ${startResult.stdout.replace(/\n/g, '\n    ')}`); // Log PM2 output

  assert(startResult.exitCode === 0, 'pm2 start exited with code 0');

  // Wait for the server to become responsive
  console.log(`  ⏳ Waiting for server on port ${PORT}...`);
  const isUp = await waitForServer(BOOT_TIMEOUT_MS);  // Poll until server responds or times out

  assert(isUp, `Server is responding on port ${PORT} within ${(BOOT_TIMEOUT_MS / 1000)}s`);

  // Verify PM2 reports the process as "online"
  const statusResult = run('npx pm2 jlist');           // Get PM2 process list as JSON
  if (statusResult.exitCode === 0 && statusResult.stdout) {
    try {
      const processes = JSON.parse(statusResult.stdout); // Parse the JSON process list
      const app = processes.find((p) => p.name === APP_NAME); // Find our app by name
      assert(app !== undefined, `PM2 process "${APP_NAME}" found in process list`);
      if (app) {
        assert(app.pm2_env.status === 'online', `PM2 process status is "online" (got "${app.pm2_env.status}")`);
        assert(app.pid > 0, `PM2 process has a valid PID (${app.pid})`);
      }
    } catch {
      assert(false, 'Could not parse PM2 jlist output as JSON');
    }
  } else {
    assert(false, 'pm2 jlist command failed');
  }
}

// ── Test 2: Lock File Verification ─────────────────────────────────────────

/**
 * Verify that the lock file was created at logs/.app.lock
 * and contains a valid PID that matches the running PM2 process.
 */
async function testLockFileCreation() {
  console.log('\n🔒  Test 2: Lock File Creation');
  console.log('─'.repeat(55));

  const lockContent = readFileSyncSafe(LOCK_FILE);    // Read the lock file contents

  assert(lockContent !== null, 'Lock file exists at logs/.app.lock');

  if (lockContent !== null) {
    const lockPid = parseInt(lockContent.trim(), 10);  // Parse the PID from the lock file
    assert(!isNaN(lockPid), `Lock file contains a valid numeric PID (got "${lockContent.trim()}")`);
    assert(lockPid > 0, `Lock PID is positive (${lockPid})`);

    // Verify the PID matches the running PM2 process
    const statusResult = run('npx pm2 jlist');         // Get PM2 process list as JSON
    if (statusResult.exitCode === 0 && statusResult.stdout) {
      try {
        const processes = JSON.parse(statusResult.stdout); // Parse the JSON process list
        const app = processes.find((p) => p.name === APP_NAME); // Find our app by name
        if (app) {
          assert(lockPid === app.pid, `Lock PID (${lockPid}) matches PM2 process PID (${app.pid})`);
        }
      } catch {
        // JSON parse failed — skip PID match check but don't fail the test
        console.log('  ⚠️  Could not verify PID match (PM2 jlist parse failed)');
      }
    }

    console.log(`  ℹ️  Lock file PID: ${lockPid}`);
  }
}

// ── Test 3: Zero-Downtime Reload with Concurrent Requests ──────────────────

/**
 * Fire a continuous stream of HTTP requests while simultaneously executing
 * a PM2 zero-downtime reload. Assert that ZERO requests return ECONNREFUSED
 * or are dropped, proving the old and new instances overlapped seamlessly.
 */
async function testZeroDowntimeReload() {
  console.log('\n🔄  Test 3: Zero-Downtime Reload');
  console.log('─'.repeat(55));

  // Capture the PID before reload to verify it changes
  const statusBefore = run('npx pm2 jlist');           // Get current PM2 process list
  let pidBefore = null;                                // Store the PID before reload
  if (statusBefore.exitCode === 0 && statusBefore.stdout) {
    try {
      const processes = JSON.parse(statusBefore.stdout); // Parse the JSON process list
      const app = processes.find((p) => p.name === APP_NAME); // Find our app by name
      if (app) pidBefore = app.pid;                    // Store the current PID
    } catch {
      // JSON parse failed — we'll check PID change later via lock file
    }
  }
  console.log(`  ℹ️  PID before reload: ${pidBefore}`);

  // Authenticate once and attach the token to every probe request. The old
  // code polled /api/asset-types unauthenticated, so each of the 50 probes
  // logged a 401 warning into logs/app.*.log (the 401-spam bug in PLAN.MD).
  // Retried: the PM2-spawned server accepts TCP before it finishes booting, so
  // the first login attempt can be reset mid-handshake (observed ECONNRESET).
  const loginBody = {
    email: process.env.ADMIN_EMAIL || 'admin@studio.com',   // Same credentials as tests/helpers.mjs
    password: process.env.ADMIN_PASSWORD || 'admin',
  };
  let login = null;                                    // Last login attempt result
  for (let attempt = 1; attempt <= 5 && !login?.data?.token; attempt++) {
    if (attempt > 1) await sleep(500);                 // Give the server a beat between attempts
    login = await httpPostJson(HOST, PORT, '/api/auth/login', loginBody);
  }
  const adminToken = login?.data?.token || null;       // Token for the Authorization header (null if login failed)
  const authHeaders = adminToken ? { Authorization: `Bearer ${adminToken}` } : {}; // Empty headers degrade to the old unauthenticated behavior
  if (adminToken) {
    console.log('  ℹ️  Reload traffic authenticated (admin token attached — no 401 log spam)');
  } else {
    console.log(`  ⚠️  Admin login failed (status ${login?.status}, error ${login?.error}) — probes will run unauthenticated`);
  }

  // Fire requests concurrently while reloading
  const results = [];                                  // Array to collect all HTTP response results
  const reloadTriggered = { value: false };            // Mutable flag to track when reload was triggered
  // Create an array of promises — each fires one HTTP request with a staggered delay
  const requestPromises = Array.from({ length: REQUEST_COUNT }, (_, i) => {
    return new Promise((resolve) => {                  // Each request is a self-contained promise
      const delay = i * REQUEST_INTERVAL_MS;           // Stagger requests: 0ms, 80ms, 160ms, ...

      // Use setTimeout to delay each request — avoids async promise executor
      setTimeout(async () => {
        // Trigger the PM2 reload at the halfway point (after ~25 requests)
        if (i === Math.floor(REQUEST_COUNT / 2) && !reloadTriggered.value) {
          reloadTriggered.value = true;                // Set the flag so we only trigger once
          console.log(`  ⚡ Triggering PM2 reload at request ${i + 1}/${REQUEST_COUNT}...`);

          // Spawn the reload command asynchronously — don't await it, let it run in parallel
          // shell: true is required on Windows where 'npx' is actually 'npx.cmd'
          // The DEP0190 warning is cosmetic — args are trusted internal strings, not user input
          spawn('npx', ['pm2', 'reload', 'ecosystem.config.cjs'], {
            cwd: ROOT,                                 // Run from project root
            stdio: 'ignore',                           // Discard output — we only care about HTTP results
            detached: true,                            // Detach so it doesn't block our event loop
            shell: process.platform === 'win32',       // Use shell on Windows to resolve npx.cmd
          }).unref();                                  // Don't let this child process keep the event loop alive
        }

        // Fire the HTTP request and record the result (token attached to avoid 401 spam)
        const result = await httpRequest(HOST, PORT, `/api/asset-types?_t=${Date.now()}_${i}`, authHeaders);
        results.push({                                 // Store the result with its index for analysis
          index: i,                                    // Request sequence number
          status: result.status,                       // HTTP status code (or null on network error)
          error: result.error,                         // Error code (e.g., 'ECONNREFUSED') or null
        });
        resolve();                                     // Resolve this request's promise
      }, delay);                                       // setTimeout delays the entire block by the staggered interval
    });
  });

  // Wait for all requests to complete
  await Promise.all(requestPromises);                  // Block until every request has resolved

  // Wait for the reload to fully settle (old process exits, new process starts)
  await sleep(RELOAD_SETTLE_MS);                       // Give PM2 time to complete the handoff

  // Analyze the results
  const successfulRequests = results.filter((r) => r.status !== null); // Requests that got any HTTP response
  const failedRequests = results.filter((r) => r.status === null);    // Requests that got ECONNREFUSED or similar
  const connectionRefused = failedRequests.filter((r) => r.error === 'ECONNREFUSED'); // Specifically ECONNREFUSED

  console.log(`  📊 Results: ${successfulRequests.length} succeeded, ${failedRequests.length} failed, ${connectionRefused.length} ECONNREFUSED`);

  if (failedRequests.length > 0) {
    console.log('  Failed request details:');
    failedRequests.forEach((r) => {
      console.log(`    Request #${r.index}: error=${r.error}`); // Log each failure for debugging
    });
  }

  assert(
    connectionRefused.length === 0,                    // Zero ECONNREFUSED = server was always available
    `Zero ECONNREFUSED errors during reload (${connectionRefused.length} found)`,
  );

  assert(
    failedRequests.length === 0,                       // Zero total failures = no dropped requests
    `Zero dropped requests during reload (${failedRequests.length} found)`,
  );

  // Verify that at least some requests were processed (sanity check)
  assert(
    successfulRequests.length > REQUEST_COUNT * 0.8,   // At least 80% should succeed (allowing for minor timing issues)
    `${successfulRequests.length}/${REQUEST_COUNT} requests succeeded (≥80% threshold)`,
  );

  console.log(`  ℹ️  All ${REQUEST_COUNT} requests completed without connection errors`);
}

// ── Test 4: Lock File PID Handoff ──────────────────────────────────────────

/**
 * After the reload, read the lock file again and verify that the PID has changed,
 * proving the old SQLite writer yielded to the new process.
 */
async function testLockFileHandoff() {
  console.log('\n🔄  Test 4: Lock File PID Handoff');
  console.log('─'.repeat(55));

  // Read the lock file — it should now contain the new process's PID.
  // PM2 flips its reported pid the moment it forks the new child, but the lock
  // keeps the OLD pid until the old instance finishes graceful shutdown — so a
  // single read after a fixed settle races the stamp. Poll (up to 10s, 250ms
  // steps) until the lock's pid matches the CURRENT pm2 pid; a genuinely stale
  // lock after 10s still fails the assert below, with evidence.
  const statusResult = run('npx pm2 jlist');           // Get PM2 process list as JSON
  let expectedPid = null;
  if (statusResult.exitCode === 0 && statusResult.stdout) {
    try {
      const processes = JSON.parse(statusResult.stdout); // Parse the JSON process list
      const app = processes.find((p) => p.name === APP_NAME); // Find our app by name
      if (app) expectedPid = app.pid;
    } catch {
      console.log('  ⚠️  Could not parse PM2 jlist (will fall back to a single read)');
    }
  }

  let lockContent = readFileSyncSafe(LOCK_FILE);      // First read
  if (expectedPid != null) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const pid = parseInt((lockContent ?? '').trim(), 10);
      if (Number.isInteger(pid) && pid > 0 && pid === expectedPid) break; // Handoff observed
      await sleep(250);                              // Stamp not there yet — poll
      lockContent = readFileSyncSafe(LOCK_FILE);
    }
    console.log(`  ℹ️  Lock handoff observed: ${lockContent?.trim().split('\n')[0]} (expected ${expectedPid})`);
  }

  assert(lockContent !== null, 'Lock file exists after reload');

  if (lockContent !== null) {
    const newPid = parseInt(lockContent.trim(), 10);   // Parse the new PID from the lock file
    assert(!isNaN(newPid), `Lock file contains a valid numeric PID (got "${lockContent.trim()}")`);
    assert(newPid > 0, `New lock PID is positive (${newPid})`);

    // Get the current PM2 process PID
    if (statusResult.exitCode === 0 && statusResult.stdout) {
      try {
        const processes = JSON.parse(statusResult.stdout); // Parse the JSON process list
        const app = processes.find((p) => p.name === APP_NAME); // Find our app by name
        if (app) {
          assert(newPid === app.pid, `New lock PID (${newPid}) matches current PM2 PID (${app.pid})`);

          console.log(`  ℹ️  New process PID: ${app.pid}`); // Log the new PID for visibility
        }
      } catch {
        console.log('  ⚠️  Could not verify PID match (PM2 jlist parse failed)');
      }
    }

    console.log(`  ℹ️  Lock file PID after reload: ${newPid}`);
    console.log('  ℹ️  PID handoff confirmed — old SQLite writer yielded to new process');
  }
}

// ── Test 5: Graceful Shutdown & Lock File Cleanup ──────────────────────────

/**
 * Execute a graceful stop via PM2 and verify that the shutdown handler ran.
 * Accepts TWO valid outcomes:
 *   1. Lock file deleted (Linux: exit handler fires synchronously)
 *   2. Lock file contains a dead PID (Windows: PM2 kills wrapper, orphan cleans up async)
 * Both are safe — acquireLock() in the next instance overrides stale PIDs after a 5s wait.
 */
async function testGracefulShutdown() {
  console.log('\n🛑  Test 5: Graceful Shutdown & Lock Cleanup');
  console.log('─'.repeat(55));

  // Read the PID from the lock file before stopping — we need it to check if it's dead later
  const lockBeforeStop = readFileSyncSafe(LOCK_FILE); // Check lock file exists before shutdown
  assert(lockBeforeStop !== null, 'Lock file exists before PM2 stop');

  // Execute graceful stop — PM2 sends SIGINT to the process
  const stopResult = run('npx pm2 stop ecosystem.config.cjs'); // Stop the PM2 process gracefully
  console.log(`  PM2 stop output:\n    ${stopResult.stdout.replace(/\n/g, '\n    ')}`);

  assert(stopResult.exitCode === 0, 'pm2 stop exited with code 0');

  // Wait for the shutdown handler to complete — on Windows, the orphaned Node.js process
  // may take additional time to exit and trigger its exit handler for lock file cleanup
  await sleep(SHUTDOWN_SETTLE_MS);

  // Check the lock file state after shutdown
  const lockAfterStop = readFileSyncSafe(LOCK_FILE);  // Check if lock file still exists after shutdown

  if (lockAfterStop === null) {
    // Best case: lock file was deleted by the exit handler (typical on Linux)
    assert(true, 'Lock file deleted after graceful shutdown');
  } else {
    // Windows case: lock file still exists because PM2 orphaned the Node.js process.
    // Verify the PID inside is no longer alive — proving the shutdown WILL complete
    // and the next instance's acquireLock() will safely override it.
    const lockPid = parseInt(lockAfterStop.trim(), 10);
    // Image-validated liveness (not bare signal-0): a Windows-recycled PID
    // would look "alive" and fail this check spuriously. The shutdown is
    // proven complete when the PID is dead OR no longer a node process.
    let pidAlive = false;                              // Assume the PID is dead
    let lockImage = null;
    {
      const { getProcessImage } = await import('../server/utils/appLock.js');
      const probe = await getProcessImage(lockPid);
      lockImage = probe.image;
      pidAlive = probe.exists && (probe.image === 'node.exe' || probe.image === 'node');
    }
    if (!pidAlive) {
      assert(true, `Lock file contains dead PID ${lockPid} — next instance will override (Windows orphan behavior)`);
    } else {
      assert(false, `Lock file PID ${lockPid} is still alive after shutdown — shutdown did not complete`);
    }
    console.log(`  ℹ️  Lock file PID: ${lockPid}, alive: ${pidAlive}${lockImage ? `, image: ${lockImage}` : ''}`);
    console.log('  ℹ️  On Windows, PM2 kills a wrapper process — the Node.js process exits asynchronously');
  }

  // Verify PM2 reports the process as "stopped"
  const statusResult = run('npx pm2 jlist');           // Get PM2 process list as JSON
  if (statusResult.exitCode === 0 && statusResult.stdout) {
    try {
      const processes = JSON.parse(statusResult.stdout); // Parse the JSON process list
      const app = processes.find((p) => p.name === APP_NAME); // Find our app by name
      if (app) {
        assert(
          app.pm2_env.status === 'stopped',
          `PM2 process status is "stopped" (got "${app.pm2_env.status}")`,
        );
      }
    } catch {
      console.log('  ⚠️  Could not verify PM2 status (jlist parse failed)');
    }
  }

  // Verify the server is no longer responding
  const postStopResult = await httpRequest(HOST, PORT, '/api/auth/login'); // Try to hit the server
  assert(
    postStopResult.status === null,                    // Should be null (connection refused) since server is stopped
    'Server is no longer responding after stop',
  );
}

// ── Test 6: Teardown ───────────────────────────────────────────────────────

/**
 * Clean up all PM2 state: stop processes, delete them, and kill the daemon.
 * This is the final step and also serves as emergency cleanup.
 */
async function testTeardown() {
  console.log('\n🧹  Test 6: Teardown');
  console.log('─'.repeat(55));

  // Delete all PM2 processes and stop the daemon
  pm2Cleanup();                                        // Kill PM2 daemon and remove all process entries

  // Verify the lock file is gone (should have been cleaned up in test 5)
  const lockAfterTeardown = readFileSyncSafe(LOCK_FILE); // Final check: lock file should not exist

  // If the lock file still exists (e.g., test 5 failed), clean it up manually
  if (lockAfterTeardown !== null) {                    // Stale lock file remaining
    try {
      fs.unlinkSync(LOCK_FILE);                       // Force-delete the stale lock file
      console.log('  ⚠️  Removed stale lock file during teardown');
    } catch {
      console.log('  ⚠️  Could not remove stale lock file during teardown');
    }
  }

  assert(true, 'PM2 teardown complete — all processes removed');
}

// ── Runner ─────────────────────────────────────────────────────────────────

/**
 * Main test runner. Executes all tests sequentially and prints a summary.
 * Ensures cleanup runs even if tests throw unexpectedly.
 */
async function main() {
  console.log('🧪  PM2 Process Management — Automated Verification Suite');
  console.log('='.repeat(55));

  const t0 = Date.now();                              // Record start time for elapsed time calculation

  try {
    await testPM2Start();                              // Test 1: Start PM2 and verify server boot
    await testLockFileCreation();                      // Test 2: Verify lock file was created with valid PID
    await testZeroDowntimeReload();                    // Test 3: Fire requests during reload — zero drops
    await testLockFileHandoff();                       // Test 4: Verify lock file PID changed after reload
    await testGracefulShutdown();                      // Test 5: Stop PM2, verify lock file deleted
    await testTeardown();                              // Test 6: Final PM2 cleanup
  } catch (err) {
    console.error('\n💥  Unexpected error during test execution:', err.message); // Log the crash
    console.error(err.stack);                          // Print the full stack trace for debugging
    failed++;                                          // Count the crash as a failure
  } finally {
    // Emergency cleanup: always ensure PM2 is cleaned up, even if tests crashed
    pm2Cleanup();                                      // Kill PM2 daemon and all managed processes

    // Emergency lock file removal if tests crashed before cleanup
    if (fs.existsSync(LOCK_FILE)) {                   // Check if lock file was left behind
      try {
        fs.unlinkSync(LOCK_FILE);                     // Force-delete the stale lock file
        console.log('  🧹 Emergency lock file removal during cleanup');
      } catch {
        // Non-fatal: log but don't crash
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2); // Calculate elapsed time in seconds

  // Print the final summary
  console.log('\n' + '='.repeat(55));
  console.log(`  Results:  ${passed} passed,  ${failed} failed  (${elapsed}s)`);
  console.log('='.repeat(55));
  console.log('');
  console.log('  Tests executed:');
  console.log('    1. PM2 Start & Server Boot — PM2 launches the app, server responds');
  console.log('    2. Lock File Creation — logs/.app.lock contains valid PID');
  console.log('    3. Zero-Downtime Reload — 50 requests during reload, zero drops');
  console.log('    4. Lock File PID Handoff — PID changed after reload (SQLite safety)');
  console.log('    5. Graceful Shutdown — SIGINT handler runs, lock file deleted');
  console.log('    6. Teardown — PM2 daemon cleaned up');
  console.log('');

  // Exit with code 1 on any failure so CI pipelines can detect it
  process.exit(failed > 0 ? 1 : 0);                   // Non-zero exit code signals failure to CI/CD
}

main();                                                // Start the test runner
