import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '../../.env') });

const DEFAULT_DB_PATH = process.env.DB_PATH || './database.sqlite';
const LOAD_TEST_DB_PATH = process.env.LOAD_TEST_DB_PATH;

// JWT_SECRET comes from the root .env (gitignored — never commit it) or the
// process environment. Production refuses to boot without it. In
// non-production the fallback is now a RANDOM per-boot secret — the old
// hardcoded fallback shipped in the repo, so anyone with source could forge
// valid tokens for any dev/test instance (security review 2026-10-12 #4).
// Random means tokens die on restart, which only affects environments that
// never configured a secret (sessions simply require a fresh login).
import { randomBytes } from 'crypto';
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET must be set in production'); })() : randomBytes(32).toString('hex'));

const loadTestMode = process.env.LOAD_TEST_MODE === '1';

let DB_PATH = DEFAULT_DB_PATH;

// LOAD_TEST_DB_PATH may redirect the database ONLY in load-test mode. The
// previous unconditional check made a fresh checkout that copied the
// shipped .env.example open scripts/loadTests/.runtime/… as its DEV
// database — SQLITE_CANTOPEN on first boot (found by the clone drill,
// 2026-09-30). `npm run test:server` sets both vars explicitly, so the
// isolated-instance recipe is unaffected.
if (loadTestMode && LOAD_TEST_DB_PATH) {
  DB_PATH = LOAD_TEST_DB_PATH;
  process.env.DB_PATH = LOAD_TEST_DB_PATH;
}

// Strict integer env parsing: unset/blank/garbage → documented fallback; a
// valid number is honored as-is, INCLUDING 0. The previous
// `parseInt(x) || fallback` pattern made "0 to disable" impossible to
// express (0 and blank both fell back to the default), and it disagreed
// with raw `process.env` reads elsewhere (connection.js) — the same .env
// line meant different things depending on which file parsed it. env.js is
// now the SINGLE parser for these knobs; consumers must read env.*, not
// process.env.
const intEnv = (raw, fallback) => {
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const rawOrigins = process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || 'http://localhost:5174';
const corsOriginsArray = rawOrigins.split(',').map(s => s.trim());

const env = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  DB_PATH: DB_PATH,
  JWT_SECRET: JWT_SECRET,
  CORS_ORIGINS: corsOriginsArray,
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOAD_TEST_MODE: loadTestMode,
  LOG_LEVEL: process.env.LOG_LEVEL || null,
  LOG_DIR: process.env.LOG_DIR || './logs',
  // Database resilience: query timeout in ms (default 5000ms / 5 seconds)
  DB_QUERY_TIMEOUT_MS: parseInt(process.env.DB_QUERY_TIMEOUT_MS, 10) || 5000,
  // Database resilience: transaction timeout in ms (default 30000ms / 30 seconds)
  DB_TRANSACTION_TIMEOUT_MS: parseInt(process.env.DB_TRANSACTION_TIMEOUT_MS, 10) || 30000,
  // Database resilience: periodic WAL checkpoint interval in ms (0 = disabled,
  // default 60000; unset/blank = default)
  DB_WAL_CHECKPOINT_INTERVAL_MS: intEnv(process.env.DB_WAL_CHECKPOINT_INTERVAL_MS, 60000),
  // Database resilience: run integrity check on startup (set to 'false' to skip)
  DB_INTEGRITY_CHECK_ON_STARTUP: process.env.DB_INTEGRITY_CHECK_ON_STARTUP !== 'false',
  // Auth rate limiter: max login attempts per window (default 5, set higher for dev/testing)
  AUTH_RATE_LIMIT_MAX: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 5,
  // Global rate limiter: max requests per window (default 300, higher for dev/testing)
  GLOBAL_RATE_LIMIT_MAX: parseInt(process.env.GLOBAL_RATE_LIMIT_MAX, 10) || 300,
  // Read rate limiter: max read requests per minute (default 60, higher for dev/testing)
  READ_RATE_LIMIT_MAX: parseInt(process.env.READ_RATE_LIMIT_MAX, 10) || 60,
  // Rate limiter overrides for dev/QA (env-only; production should keep sane defaults).
  // Raised from 60 so the full API sweep's write-heavy phases (e.g. PHASE 12)
  // do not 429 on the write limiter; the sweep restarts the API between phases
  // for a fresh limiter epoch, but a higher default reduces restarts for manual
  // runs that keep one server across many writes.
  WRITE_RATE_LIMIT_MAX: parseInt(process.env.WRITE_RATE_LIMIT_MAX, 10) || 300,
  // Backup configuration
  BACKUP_PATH: process.env.BACKUP_PATH || './backups',
  // Disk-full hardening: WAL size cap in MB (0 disables the cap; unset/blank
  // = default 256). When the -wal file exceeds this, the checkpoint loop
  // forces a TRUNCATE checkpoint so the WAL cannot silently eat the last
  // free bytes of the volume.
  DISK_WAL_CAP_MB: intEnv(process.env.DISK_WAL_CAP_MB, 256),
  // journal_size_limit in bytes (SQLite PRAGMA): after a checkpoint, SQLite
  // truncates the -wal file to at most this size. Default 64MB matches the
  // historical hard-coded value; load-test benchmarks may lower it.
  DB_JOURNAL_SIZE_LIMIT: parseInt(process.env.DB_JOURNAL_SIZE_LIMIT, 10) || 67108864,
  // WebSocket configuration
  WEBSOCKET_ENABLED: process.env.WEBSOCKET_ENABLED !== 'false',
};

export default env;