import express from 'express';                          // Express web framework — handles routing, middleware, HTTP
import cors from 'cors';                                // Cross-Origin Resource Sharing middleware — allows frontend to call API
import helmet from 'helmet';                            // Security headers middleware — sets CSP, HSTS, X-Frame-Options, etc.
import { randomUUID } from 'node:crypto';                           // UUID generation for request IDs (not available in node:fs)
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs'; // Node.js filesystem operations for PID lock file
import { resolve, dirname } from 'node:path';           // Path utilities for constructing absolute lock file path
import { fileURLToPath } from 'node:url';              // Convert import.meta.url to filesystem path for __dirname equivalent
import env from './config/env.js';                      // Centralized environment configuration — loads .env, exports typed config object
import routes from './routes/index.js';                 // API route aggregator — mounts all /api/* sub-routers
import { getDb } from './database.js';                  // Database boot sequence: connect → migrate → timeout proxy
import { globalLimiter } from './middleware/rateLimiters.js'; // Global rate limiter — protects against brute-force and DDoS
import errorHandler from './middleware/errorHandler.js'; // Centralized error handler — catches all unhandled errors, returns structured JSON
import logger from './utils/logger.js';                 // Pino logger instance — structured JSON logs, redacted fields, multistream in production
import requestLogger from './middleware/requestLogger.js'; // pino-http middleware — logs every HTTP request/response with timing and status
import connectionManager from './db/connection.js';     // SQLite ConnectionManager singleton — manages WAL mode, health checks, graceful close
import { initWebSocketServer, closeAllSockets } from './services/wsServer.js'; // WebSocket server for real-time notifications
import { startAutoBackupScheduler } from './services/conversationBackupService.js'; // Auto-backup scheduler for conversations
import { startAutoArchiveScheduler, scheduleVacuum } from './services/conversationArchiveService.js'; // Hard-move archive: idle auto-archive + retention purge + VACUUM debounce
import diskSpaceGuard from './middleware/diskSpaceGuard.js'; // Disk-full hardening: 503 short-circuit for writes when space is critical
import { watchdogState, noteTickEnd, recordRestamp, initWatchdogEvents, appendWatchdogEvent } from './services/watchdogState.js'; // Live guard state for /api/health
import { runDiskPreflight } from './services/diskSpaceService.js'; // Disk-full hardening: boot free-space preflight
import { uploadsStaticHeaders, privateUploadsGuard } from './utils/uploadSafety.js'; // Serve-time hardening + private-subtree 404 for /uploads

// ── Express Application Setup ──
const app = express();                                  // Create the Express application instance

// ── Trust Proxy ──
// Enable trust proxy so Express reads X-Forwarded-For / X-Forwarded-Proto from reverse proxies (nginx, Cloudflare, etc.)
// Without this, req.ip always returns the proxy's IP instead of the client's.
app.set('trust proxy', 1);                             // Trust the first proxy hop in the chain

// ── Security Headers (Helmet) ──
// Helmet sets various HTTP security headers. We disable CSP and cross-origin embedding
// because this API serves a React SPA that loads assets cross-origin (e.g., uploaded files).
app.use(helmet({
  contentSecurityPolicy: false,                         // Disabled — React SPA uses inline scripts/styles
  crossOriginEmbedderPolicy: false,                     // Disabled — allows cross-origin resource embedding
  crossOriginResourcePolicy: { policy: "cross-origin" } // Allow cross-origin resource access for uploaded files
}));

// ── Request ID Middleware ──
// Every incoming request gets a unique ID for distributed tracing across logs.
// If the client sends X-Request-Id (e.g., from a gateway), we reuse it; otherwise we generate one.
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || randomUUID(); // Use client-provided ID or generate a new UUID v4
  res.setHeader('X-Request-Id', req.id);               // Echo the request ID back to the client for correlation
  next();                                                // Pass control to the next middleware
});

// ── CORS Configuration ──
// IMPORTANT: CORS must be mounted BEFORE the rate limiter so that 429 responses
// still include Access-Control-Allow-Origin headers. Without this, the browser
// interprets rate-limited responses as CORS violations, hiding the real error.
// Allowlist enforcement: only origins in CORS_ORIGIN / CORS_ORIGINS may call
// the API cross-origin (security review 2026-10-12 #3 — the old
// `origin: true` mirrored ANY Origin while the allowlist knob sat unused).
// Requests without an Origin header (same-origin navigations, curl, k6,
// server-side QA harnesses) are always fine; set CORS_ORIGIN='*' to opt back
// into reflecting every origin. Production deployments MUST set CORS_ORIGIN
// to the frontend's real origin.
const corsOriginAllowlist = env.CORS_ORIGINS;
const corsOrigin = (origin, cb) => {
  if (!origin) return cb(null, true);                    // Non-browser / same-origin request
  if (corsOriginAllowlist.includes('*')) return cb(null, true); // Explicit wildcard opt-in
  cb(null, corsOriginAllowlist.includes(origin));        // Denied origins get no CORS headers (browser blocks)
};

// Credentials enabled for JWT token cookies. MaxAge caches preflight for 24 hours.
app.use(cors({
  origin: corsOrigin,                                    // Allowlist callback — see above
  credentials: true,                                    // Allow cookies and Authorization headers in cross-origin requests
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allowed HTTP methods
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'], // Allowed request headers
  exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit', 'RateLimit-Policy'], // Expose rate-limit + tracing headers to client-side JS
  maxAge: 86400,                                        // Cache preflight response for 24 hours (86400 seconds)
}));

// ── Global Rate Limiter ──
// Applied to all routes — prevents brute-force attacks and DDoS.
// Configured in server/middleware/rateLimiters.js with per-IP tracking.
// Mounted AFTER CORS so 429 responses include proper CORS headers.
app.use(globalLimiter);                                 // Mount the global rate limiter on all incoming requests

// ── Disk-Full Guard ──
// While the app volume is critically low on free space, WRITE requests to
// data-mutating endpoints are rejected with 503 BEFORE controllers run — a
// rejected request cannot grow the WAL or write uploads, preserving the
// remaining headroom for checkpoints and VACUUMs. Reads stay open so users
// can still inspect data while an operator frees space. Mounted after CORS
// (so 503s carry CORS headers, same rule as the rate limiter).
app.use(diskSpaceGuard);                                // 503 short-circuit for writes at DISK_CRITICAL_FREE_GB

// ── Body Parsing ──
// Limit JSON body size to 256KB to prevent memory abuse via large payloads.
// This matches the application's expected payload sizes (forms, asset metadata, etc.).
app.use(express.json({ limit: '256kb' }));             // Parse JSON bodies with 256KB size limit

// ── Static File Serving ──
// Serve uploaded files (asset images, QR codes, PDFs) from the uploads directory.
// These are served under /uploads/* and are publicly accessible.
// Private upload subtrees are never served statically: conversations, their
// archives, and leave attachments stream through auth-checked API routes only
// (404 here closes the unauthenticated-read hole verified 2026-10-13).
// Ensure upload directories exist on fresh clones/containers so multer destinations never ENOENT
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const relDir of ['uploads', 'uploads/conversations', 'uploads/archive/conversations', 'uploads/branding']) {
  const absDir = resolve(PROJECT_ROOT, relDir);
  if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });
}

app.use('/uploads', privateUploadsGuard);
app.use('/uploads', express.static('uploads', { setHeaders: uploadsStaticHeaders })); // Public uploads with serve-time hardening (nosniff always; SVG behind script-blocking CSP sandbox; unknown/non-raster extensions forced to download)

// ── HTTP Request Logging ──
// pino-http logs every request with method, URL, status code, response time, and request ID.
// Logs are routed through the Pino logger (structured JSON in production, pretty-printed in dev).
app.use(requestLogger);                                 // Mount pino-http as request logging middleware

// ── API Routes ──
// All API routes are mounted under /api — see server/routes/index.js for the full router tree.
app.use('/api', routes);                                // Mount the aggregated API router at /api

// ── Test Error Endpoint (development/test only) ──
// Generates an intentional unhandled error to verify the error handler and logging pipeline.
// Only enabled when LOG_DIR is set, which is always true in production but serves as a guard.
if (env.LOG_DIR) {
  app.get('/api/_test/error', () => {                   // GET /api/_test/error triggers a test exception
    throw new Error('Intentional test error for logging verification'); // Unhandled error caught by errorHandler
  });
}

// ── Single-Port SPA Frontend Serving ──
// When `npm run build` has produced dist/index.html, Express serves the compiled
// React frontend and falls back to index.html for client-side routes so one
// process (:3000) handles UI, /api, /uploads, and /ws in Codespaces & production.
const DIST_DIR = resolve(PROJECT_ROOT, 'dist');
const DIST_INDEX = resolve(DIST_DIR, 'index.html');
if (existsSync(DIST_INDEX)) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(DIST_INDEX);
  });
}

// ── Centralized Error Handler ──
// Catches all unhandled errors from middleware and route handlers above.
// Returns structured JSON errors (AppError, ZodError, JWT errors, etc.) with appropriate status codes.
// Logs the full error context via req.log (pino-http child logger).
app.use(errorHandler);                                  // Mount the error handler — must be LAST middleware in the chain

// ── PID-Based Lock File ──
// Prevents two application instances from opening the same SQLite database simultaneously.
// SQLite WAL mode allows concurrent readers but only ONE writer. Two writers cause SQLITE_BUSY deadlocks.
// During PM2 zero-downtime reloads, both old and new instances may coexist briefly.
// This lock file ensures the new instance waits or exits if the old one is still running.

const LOCK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'logs'); // Absolute path to the logs directory for the lock file
// APP_LOCK_FILE lets isolated instances (test harnesses, load-test servers with
// their own DB_PATH) use their own lock file instead of colliding with the dev
// server's logs/.app.lock. Default stays logs/.app.lock for normal operation.
const LOCK_FILE = process.env.APP_LOCK_FILE
  ? resolve(process.env.APP_LOCK_FILE)
  : resolve(LOCK_DIR, '.app.lock');      // Absolute path to the PID lock file

// Ensure the logs directory exists before writing the lock file
if (!existsSync(LOCK_DIR)) {
  mkdirSync(LOCK_DIR, { recursive: true });            // Create logs/ directory recursively if it doesn't exist
}
// Custom lock files (APP_LOCK_FILE) may live outside logs/ — e.g. the
// load-test server's scripts/loadTests/.runtime/.loadtest.lock, whose parent
// the README runbook deletes between runs. Create its parent directory too,
// or the writeFileSync below throws and the instance refuses to boot.
if (process.env.APP_LOCK_FILE) {
  const customLockDir = dirname(LOCK_FILE);            // Absolute dir of the override lock file
  if (!existsSync(customLockDir)) {
    mkdirSync(customLockDir, { recursive: true });     // Create the override lock dir recursively
  }
}

// Acquire the lock: check if another instance is already running.
// The PID inside the lock is validated against the PROCESS IMAGE before it
// is trusted: a dead process's PID gets recycled on Windows (observed live:
// a stale lock resolving to svchost.exe), so "signal 0 says alive" is not
// evidence that an instance of this app is running. readLockInfo/isLockLive
// come from server/utils/appLock.js — one implementation for every consumer.
// This is a PRODUCTION dependency: the module lives in server/ (not scripts/)
// so the layer arrow points down — scripts import from server/, never the
// reverse. (It was scripts/lib/appLock.js before the 2026-09-27 promotion.)
const acquireLock = async () => {
  try {
    if (existsSync(LOCK_FILE)) {                        // Lock file exists — another instance may be running
      const { isLockLive } = await import('./utils/appLock.js');
      const verdict = await isLockLive(LOCK_FILE);
      if (verdict.live) {
        // A live Node process holds the lock — treat it as the conflict it
        // claims to be, wait briefly for a graceful PM2 handoff, then die.
        const existingPid = verdict.pid;
        logger.warn({ existingPid, image: verdict.image }, 'Another instance is already running (validated: live node process holds the lock)');
        let waited = 0;
        const MAX_WAIT = 5000;                          // Maximum wait time in milliseconds
        const POLL_INTERVAL = 250;                      // Check every 250ms
        let stillLive = true;
        while (waited < MAX_WAIT) {
          const re = await isLockLive(LOCK_FILE);       // Re-validate FIRST: poll, then wait — a released lock is noticed immediately, never a full interval late
          if (!re.live) { stillLive = false; break; }   // Old process is gone — lock is stale, we can proceed
          await new Promise((r) => setTimeout(r, POLL_INTERVAL)); // Async sleep — does not freeze the event loop
          waited += POLL_INTERVAL;                      // Track elapsed wait time
        }
        if (stillLive) {
          logger.fatal({ existingPid }, 'Cannot start: another instance is still running after wait');
          process.exit(1);                              // Exit with error code 1 — PM2 will see the crash and retry
        }
        logger.info({ existingPid }, 'Previous instance exited during wait — lock is now stale, taking over');
      } else {
        // Stale (pid-dead or foreign-image) or garbage lock: the owner        // cannot be a running instance of this app — take over. Log what
        // was found so recycled-PID lies are visible in the server log.
        logger.warn({ pid: verdict.pid, image: verdict.image, reason: verdict.reason, lockFile: LOCK_FILE }, 'Stale or invalid lock file — ignoring and taking over');
      }
    }
    stampLock();
    logger.info({ pid: process.pid, lockFile: LOCK_FILE }, 'Lock file acquired');
    return true;                                        // Lock successfully acquired
  } catch (err) {
    // Lock file I/O error (permissions, disk full, etc.)
    logger.error({ err }, 'Failed to acquire lock file');
    return false;                                       // Could not acquire lock — caller should exit
  }
};

// Release the lock: remove the lock file on clean shutdown
// Uses console.log instead of Pino logger — the logger's thread-stream may be broken
// during shutdown, and a crash here would prevent lock file cleanup.
const releaseLock = () => {
  try {
    if (existsSync(LOCK_FILE)) {                        // Only delete if the lock file exists
      const lockPid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10); // Read the PID from the lock file
      if (lockPid === process.pid) {                    // Only delete OUR lock — not someone else's
        unlinkSync(LOCK_FILE);                          // Remove the lock file from disk
        console.log(`[shutdown] Lock file released (PID ${process.pid})`); // Use console — safe during shutdown
      } else {
        // The lock file belongs to a different PID — this shouldn't happen, but log it for safety
        console.warn(`[shutdown] Lock file belongs to PID ${lockPid}, not ours (${process.pid}) — skipping delete`); // Use console
      }
    }
  } catch (err) {
    // Non-fatal: log the error but don't crash during shutdown
    console.warn('[shutdown] Failed to release lock file:', err.message || err); // Use console — safe during shutdown
  }
};

// ── Lock-File Stamp + Watchdog (self-healing lock) ──────────────────────
// The lock file can vanish while this instance keeps serving: an operator
// or script deletes logs/ (it also holds rotated logs), a buggy consumer
// removes a lock it misread as stale, or a runtime wipe races the dev
// server. A server left WITHOUT its lock breaks the single-instance
// invariant in the worst way — every later consumer (boot takeover,
// kill-server, testAll stopApi) believes the port is free, and two
// instances end up sharing one SQLite file: the lockless "ghost" that
// once split-brained a full QA sweep.
//
// Watchdog rule (checked every APP_LOCK_WATCHDOG_MS, default 30s):
//   lock missing / unreadable / stale      → re-stamp (heal)
//   lock held by THIS pid                  → nothing (healthy)
//   lock held by a DIFFERENT LIVE node     → DO NOT overwrite; log + exit 1.
//     Overwriting would silently demote the legitimate owner and crown
//     this instance — the exact lie the image-validated lock exists to
//     prevent. Exiting surfaces the conflict to PM2/the operator; boot
//     takeover logic sorts out ownership on the restart.
//   lock held by a foreign (non-node) image → re-stamp (a recycled PID is
//     never a legitimate instance of this app — same policy as boot).
//
// Port half (same tick, checked FIRST): findListenerOwner(env.PORT) must
// resolve to THIS pid. The lock proves who may WRITE the database; the port
// proves who actually SERVES — a zombie holding a valid lock while another
// process has bound its port out from under it would otherwise pass every
// lock check while traffic goes elsewhere. Any foreign listener (node or
// not) is theft: exit loudly instead of serving alongside it.
//
// stampLock() is the single writer of the lock format (PID on line 1 —
// testProcessManagement parses it; metadata line 2; repo cwd line 3) and
// is shared with acquireLock() at boot, so the two paths cannot drift.
const stampLock = () => {
  mkdirSync(dirname(LOCK_FILE), { recursive: true });  // Heals a deleted logs/ (or APP_LOCK_FILE parent) too
  const lockMeta = [
    `pid=${process.pid}`,
    `ppid=${process.ppid ?? 0}`,
    `node=${process.execPath}`,
    `exe=node.exe`,
    `started=${new Date().toISOString()}`,
    `argv0=${process.argv0 || 'server'}`,
  ].join(' ');
  writeFileSync(LOCK_FILE, `${process.pid}\n${lockMeta}\ncwd=${resolve(dirname(fileURLToPath(import.meta.url)), '..')}\n`, 'utf-8');
};

let lockWatchdogTimer = null;                          // Cleared by gracefulShutdown so a dying instance never re-stamps

// Port-ownership check for the watchdog tick. Never throws into the caller
// beyond the tick's own catch; see the rule table above for the verdicts.
const checkPortOwnership = async () => {
  const { getProcessImage, findListenerOwners } = await import('./utils/appLock.js');
  const pids = await findListenerOwners(env.PORT);      // ALL listeners — SO_REUSEADDR allows several
  if (pids.length === 1 && pids[0] === process.pid) return; // Healthy: we alone own our port
  if (pids.length === 0) {
    // For a process that already bound the port, "no listener" is nearly
    // impossible (it would mean our own socket vanished) — warn and retry
    // next tick rather than dying on a detection glitch.
    logger.warn({ port: env.PORT, pid: process.pid }, 'Listener watchdog: no listener found on our port (unexpected — will re-check next tick)');
    return;
  }
  // Anything else bound to our port is theft — whether we are still among
  // the listeners (shared port, traffic now racing) or gone entirely. Node
  // or not, we can no longer assume we are the serving instance. Exit
  // loudly (console alongside pino: process.exit can beat the thread-stream
  // flush, the gracefulShutdown rule).
  const images = [];
  for (const pid of pids) images.push(await getProcessImage(pid));
  const thieves = pids.filter((pid) => pid !== process.pid);
  const detail = thieves.map((pid) => {
    const img = images[pids.indexOf(pid)]?.image;
    return `pid ${pid} (${img || 'unknown image'})`;
  }).join(', ');
  const fatal = { port: env.PORT, ourPid: process.pid, listenerPids: pids, thiefPids: thieves };
  // Durable evidence, written BEFORE the exit: the next instance's health
  // will surface this event, and the loud log pair is the second record.
  appendWatchdogEvent({ event: 'port-theft', thiefPids: thieves, ourPort: env.PORT });
  console.error(`[listener-watchdog] Port ${env.PORT} stolen — other listener(s): ${detail} — exiting loudly instead of serving alongside it`);
  logger.fatal(fatal, `Port ${env.PORT} is now held (also) by another process — exiting instead of serving alongside it (port-theft guard)`);
  process.exit(1);
};

const startLockWatchdog = () => {
  initWatchdogEvents(resolve(dirname(LOCK_FILE), 'watchdog-events.jsonl')); // Load previous run's fatal events before ticking can write
  const intervalMs = parseInt(process.env.APP_LOCK_WATCHDOG_MS, 10);
  if (intervalMs === 0) {                              // 0 = opt out (harnesses that manage the file themselves)
    logger.info('Lock + listener watchdog disabled (APP_LOCK_WATCHDOG_MS=0)');
    return;
  }
  const period = Number.isInteger(intervalMs) && intervalMs >= 1000 ? intervalMs : 30_000;
  lockWatchdogTimer = setInterval(async () => {
    const tickStart = Date.now();
    let tickVerdict = null;                            // Lock evidence for /api/health
    try {
      await checkPortOwnership();                      // Port half first (highest-priority signal)
      if (!existsSync(LOCK_FILE)) {                    // Vanished: heal immediately
        stampLock();
        recordRestamp('vanished');
        appendWatchdogEvent({ event: 'lock-restamp', reason: 'vanished' });
        logger.warn({ pid: process.pid, lockFile: LOCK_FILE }, 'Lock file had vanished while running — re-stamped (ghost lockless server prevented)');
        return;
      }
      const { isLockLive } = await import('./utils/appLock.js');
      const verdict = await isLockLive(LOCK_FILE);
      tickVerdict = verdict;                           // Evidence for /api/health regardless of outcome
      if (verdict.live) {
        if (verdict.pid === process.pid) return;       // Healthy: our own live lock
        // A different live node holds OUR lock path. Never overwrite it.
        // Console alongside pino: process.exit(1) can fire before pino's
        // thread-stream flushes (the same reason gracefulShutdown uses
        // console) — this line is the operator's only record of WHY.
        const fatal = { ourPid: process.pid, holderPid: verdict.pid, image: verdict.image, lockFile: LOCK_FILE };
        console.error('[lock-watchdog] Lock file now held by a different live process — exiting instead of overwriting (split-brain guard):', JSON.stringify(fatal));
        logger.fatal(fatal, 'Lock file now held by a different live process — exiting instead of overwriting (split-brain guard)');
        appendWatchdogEvent({ event: 'lock-conflict', holderPid: verdict.pid, image: verdict.image }); // Durable: survives this exit
        process.exit(1);                               // PM2 restarts us; boot takeover resolves ownership
      }
      // Stale (pid-dead / foreign-image / garbage): same policy as boot —
      // a dead or non-node PID can never be a legitimate instance. Heal.
      stampLock();
      recordRestamp('stale-while-running', verdict);
      appendWatchdogEvent({ event: 'lock-restamp', reason: verdict.reason || 'stale' });
      logger.warn({ pid: verdict.pid, image: verdict.image, reason: verdict.reason, lockFile: LOCK_FILE }, 'Lock file was stale while running — re-stamped');
    } catch (err) {
      // The watchdog must never crash the server; the next tick retries.
      logger.warn({ err: err?.message || String(err) }, 'Lock-file watchdog check failed (will retry next tick)');
      noteTickEnd(tickStart, { error: err });          // Failed ticks are evidence too
      return;
    } finally {
      noteTickEnd(tickStart, { verdict: tickVerdict }); // Every completed tick updates lastCheckAt/duration
    }
  }, period);
  lockWatchdogTimer.unref();                           // Never keep the event loop alive for the watchdog
  Object.assign(watchdogState, {                       // Startup metadata for /api/health
    enabled: true,
    periodMs: period,
    startedAt: new Date().toISOString(),
    ticks: 0,
    reStamps: 0,
    lastVerdict: null,
    lastError: null,
  });
  logger.info({ period, lockFile: LOCK_FILE, port: env.PORT }, 'Lock + listener watchdog started');
};

// Attempt to acquire the lock before proceeding with database initialization
// (async: lock validation consults the OS process table for image checks)
const lockAcquired = await acquireLock();                // Try to claim exclusive access to the SQLite database
if (!lockAcquired) {
  // Could not acquire lock — another instance is likely running or disk is full
  // Exit immediately so PM2 can manage the restart
  process.exit(1);                                      // Exit with non-zero code to signal failure
}

// ── Disk-Free Boot Preflight ──
// Refuse to boot when the volume holding the DB/uploads/backups is below
// DISK_MIN_FREE_BYTES: a half-booted instance on a full disk can corrupt the
// WAL, wedge migrations mid-transaction, and turn one full volume into a
// PM2 crash-restart loop. Exiting non-zero surfaces the condition to the
// process manager instead of booting into guaranteed failure.
const diskOk = await runDiskPreflight();                 // Defaults: warnOnly=false, 500 MB floor (DISK_MIN_FREE_BYTES)
if (!diskOk) {
  console.error('[boot] disk preflight failed — refusing to start'); // console: logger streams also live on that disk
  process.exit(1);                                      // PM2 surfaces the crash; ops sees the fatal preflight line in error.log
}

// ── Database Initialization ──
// Boot the database: connect → run Umzug migrations → wrap with timeout proxy.
// This is non-blocking: the HTTP server starts immediately, but the database may not be ready yet.
// In-flight requests that hit the DB before it's ready will receive a 503 via the query timeout wrapper.
getDb().catch(err => logger.fatal(err, 'Database initialization failed')); // Fatal log on DB failure — PM2 will restart

// ── Graceful Shutdown Handler ──
// Registered for SIGTERM (PM2 stop/reload) and SIGINT (Ctrl+C, PM2 reload).
// Sequence: close WebSocket → stop accepting HTTP → drain in-flight requests → release lock → close database → exit.
// This prevents WAL corruption from abrupt process termination and SQLite file locking issues.
const gracefulShutdown = async (signal) => {
  // Stop the lock watchdog FIRST: a shutdown in progress must never re-stamp
  // the lock it is about to release (that would recreate the ghost we guard against).
  if (lockWatchdogTimer) { clearInterval(lockWatchdogTimer); lockWatchdogTimer = null; }
  // Log the signal for debugging and audit trails
  logger.info({ signal, pid: process.pid }, 'Shutdown signal received, closing gracefully...');

  // Set a hard deadline — if shutdown doesn't complete in time, force exit
  const SHUTDOWN_DEADLINE_MS = 8000;                    // 8 seconds total budget for the entire shutdown sequence
  const deadline = setTimeout(() => {
    console.error('[shutdown] Deadline exceeded — forcing exit'); // Use console — safe during shutdown
    process.exit(1);                                    // Force exit with error code — PM2 will restart if configured
  }, SHUTDOWN_DEADLINE_MS);
  deadline.unref();                                     // Don't let the timer keep the event loop alive on its own

  try {
    // Step 0: Close all WebSocket connections
    closeAllSockets();
    console.log('[shutdown] WebSocket connections closed');

    // Step 1: Stop accepting new HTTP connections
    // server.close() stops the HTTP server from accepting new connections.
    // Existing (in-flight) requests will continue to be served.
    // The callback fires when all connections are closed (or immediately if none are active).
    // A 3-second timeout prevents hanging if keep-alive connections never close.
    if (server) {
      await new Promise((resolve) => {
        const closeTimeout = setTimeout(() => {        // Timeout: force proceed if server.close() hangs
          console.warn('[shutdown] server.close() timed out after 3s — proceeding'); // Use console — safe during shutdown
          resolve();                                   // Resolve anyway to continue shutdown sequence
        }, 3000);                                      // 3-second timeout for HTTP drain
        server.close(() => {                           // Close the HTTP server — stops accepting new connections
          clearTimeout(closeTimeout);                  // Cancel the timeout — server closed normally
          console.log('[shutdown] HTTP server closed'); // Use console — safe during shutdown
          resolve();                                   // Resolve the promise so we can proceed to DB close
        });
      });
    }

    // Step 2: Release the PID lock file IMMEDIATELY — before potentially hanging DB close.
    // This is critical: if connectionManager.close() hangs or the process is killed,
    // the lock file is already cleaned up and the next instance can start immediately.
    releaseLock();                                      // Remove the lock file so the next instance can start

    // Step 3: Close the database connection
    // connectionManager.close() performs: WAL TRUNCATE checkpoint → db.close()
    // This ensures all WAL data is flushed to the main database file before closing.
    // Wrapped in a race with a timeout to prevent hanging if the DB is busy.
    await Promise.race([
      connectionManager.close(),                       // Normal shutdown: WAL checkpoint + db.close()
      new Promise((resolve) => setTimeout(() => {      // Timeout: force proceed after 5 seconds
        console.warn('[shutdown] connectionManager.close() timed out after 5s'); // Log the timeout
        resolve();                                     // Resolve to continue shutdown sequence
      }, 5000)),                                       // 5-second timeout for database close
    ]);
    console.log('[shutdown] Database connection closed'); // Use console — safe during shutdown

  } catch (err) {
    // Log but don't rethrow — we want to exit cleanly even if cleanup partially fails
    // Use console.error as a fallback in case the logger's thread-stream is broken
    console.error('[shutdown] Error during graceful shutdown:', err.message || err);
  }

  // Step 4: Exit cleanly with success code
  clearTimeout(deadline);                               // Cancel the forced-exit timer — we made it in time
  process.exit(0);                                      // Exit with code 0 — PM2 sees this as a clean shutdown
};

// Register signal handlers for both termination signals
// PM2 sends SIGINT by default for graceful stop/reload (configurable via kill_retry_time)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // SIGTERM: sent by `pm2 stop`, `pm2 delete`, OS shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));  // SIGINT: sent by `pm2 reload`, Ctrl+C, `pm2 restart`

// ── Synchronous Exit Handler (Last-Resort Lock Cleanup) ──
// The async gracefulShutdown handler may not complete before PM2 kills the process
// (e.g., on Windows where signals behave differently, or if thread-stream crashes
// interrupt the event loop). This synchronous handler fires on ANY process exit
// and guarantees the lock file is cleaned up. It only runs synchronous fs operations
// so it executes reliably even during forced termination.
process.on('exit', () => {
  try {
    if (existsSync(LOCK_FILE)) {                        // Check if the lock file still exists
      const lockPid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10); // Read the PID from the lock file
      if (lockPid === process.pid) {                    // Only delete OUR lock — not someone else's
        unlinkSync(LOCK_FILE);                          // Synchronously remove the lock file
        console.log(`[exit] Lock file cleaned up (PID ${process.pid})`); // Log cleanup for debugging
      }
    }
  } catch {
    // Last-resort handler — silently ignore errors to avoid crashing the exit sequence
  }
});

// ── Start the HTTP Server ──
// Capture the return value of app.listen() — this is the http.Server instance.
// We need this reference in gracefulShutdown to call server.close() for draining connections.
// Without capturing this, we cannot stop accepting new requests before closing the database.
const server = app.listen(env.PORT, '0.0.0.0', () => {
  // Server is now listening for incoming connections on the configured port
  logger.info({ port: env.PORT, pid: process.pid }, 'Server started successfully');
  
  // Initialize WebSocket server attached to the same HTTP server
  initWebSocketServer(server);

  // Start the lock-file watchdog: self-heals a vanished/stale lock and
  // exits if another live node ever claims our lock path (split-brain guard).
  startLockWatchdog();

  // Start conversation auto-backup scheduler
  startAutoBackupScheduler();

  // Start hard-move archive scheduler (idle auto-archive, retention purge,
  // quota warnings) and the post-archive VACUUM debounce.
  startAutoArchiveScheduler();
  scheduleVacuum('boot');
});
