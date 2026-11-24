// diskSpaceService.js — disk-full hardening for the API.
//
// Three cooperating layers (verified by scripts/testDiskGuard.js):
//   1. Boot preflight (runDiskPreflight) — refuses to start when the volume
//      holding the DB/uploads/backups is below DISK_MIN_FREE_BYTES.
//   2. Runtime guard (middleware/diskSpaceGuard) — short-circuits write
//      requests with 503 while free space is 'critical'; reads stay open so
//      users can still inspect data while space is freed.
//   3. WAL size cap (maybeCheckpointWal, wired into the existing periodic
//      checkpoint loop) — checkpoints + truncates the WAL before it can grow
//      unbounded, which is the in-process mitigations for a WAL-only disk
//      squeeze (DELETEs/updates append to the WAL; under disk pressure the
//      WAL is often what actually eats the last free bytes).
//
// A single TTL cache backs the guard so request bursts do not statfs-spam
// the kernel (statfs on Windows is a syscall; a burst of 200 req/min would
// otherwise hit it per request). getStatus() returns a three-level verdict:
//   'ok' | 'low' | 'critical' (plus 'unknown' when statfs failed)
// 'low' only logs (and shows in /api/health); 'critical' trips the 503 guard.

import fs from 'node:fs';
import path from 'node:path';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const MB = 1024 * 1024;
const GB = 1024 * MB;

// ── Thresholds (parsed once; 0 = disabled) ──
const WARN_BYTES = (parseInt(process.env.DISK_WARN_FREE_GB, 10) || 5) * GB;
const CRITICAL_BYTES = (parseInt(process.env.DISK_CRITICAL_FREE_GB, 10) || 1) * GB;
const MIN_BOOT_BYTES = parseInt(process.env.DISK_MIN_FREE_BYTES, 10) || 500 * MB;

// Paths to watch. The DB (and its -wal/-shm siblings), uploads and backups
// are all expected on the app volume; env.DB_PATH is the source of truth.
export function watchedPaths() {
  const dbPath = path.resolve(env.DB_PATH || './database.sqlite');
  return {
    primary: path.dirname(dbPath),
    uploads: path.resolve('./uploads'),
    backups: path.resolve(env.BACKUP_PATH || './backups'),
  };
}

// ── TTL cache ──
const CACHE_TTL_MS = Math.max(250, parseInt(process.env.DISK_CHECK_INTERVAL_MS, 10) || 5000);
let cached = null;            // { status, freeBytes, totalBytes, checkedAt, path }
let inFlight = null;          // coalesce concurrent refreshes

/** Raw statfs for one directory; throws on error. */
async function statfsDir(dir) {
  const st = await fs.promises.statfs(dir);
  return {
    freeBytes: Number(st.bavail) * Number(st.bsize),
    totalBytes: Number(st.blocks) * Number(st.bsize),
  };
}

function classify(freeBytes) {
  if (freeBytes <= CRITICAL_BYTES) return 'critical';
  if (freeBytes <= WARN_BYTES) return 'low';
  return 'ok';
}

/** Stat every watched directory and return the WORST verdict. */
export async function refreshNow() {
  const paths = watchedPaths();
  const results = [];
  for (const [key, dir] of Object.entries(paths)) {
    try {
      const r = await statfsDir(dir);
      results.push({ key, dir, ...r });
    } catch (err) {
      // Directory may not exist yet (fresh checkout) — fall back to the
      // process CWD volume rather than failing the guard entirely.
      try {
        const r = await statfsDir(process.cwd());
        results.push({ key, dir: process.cwd(), fallback: true, ...r });
      } catch {
        logger.warn({ err, dir, key }, 'disk statfs failed');
      }
    }
  }

  if (!results.length) {
    cached = { status: 'unknown', freeBytes: null, totalBytes: null, checkedAt: Date.now() };
    return { ...cached };
  }

  const worst = results.reduce((a, b) => (a.freeBytes <= b.freeBytes ? a : b));
  cached = {
    status: classify(worst.freeBytes),
    freeBytes: worst.freeBytes,
    totalBytes: worst.totalBytes,
    checkedAt: Date.now(),
    path: worst.key,
  };
  return { ...cached };
}

/**
 * Cached status for the request path. Never throws — a statfs failure must
 * not 500 the API; it degrades to 'unknown' and the guard stays open.
 */
export async function getStatus() {
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return { ...cached };
  if (inFlight) return { ...(await inFlight) };
  inFlight = refreshNow()
    .catch((err) => {
      logger.warn({ err }, 'disk status refresh failed');
      cached = { status: 'unknown', freeBytes: null, totalBytes: null, checkedAt: Date.now() };
      return { ...cached };
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Force a fresh read (used by the periodic watchdog and /api/health). */
export async function getStatusFresh() {
  await refreshNow();
  return { ...cached };
}

/**
 * Boot preflight. Resolves true when safe to start; false when below
 * DISK_MIN_FREE_BYTES (caller should exit non-zero so the process manager
 * can alert instead of half-booting onto a full disk). warnOnly mode logs
 * loudly but still starts (dev convenience / controlled deploys).
 */
export async function runDiskPreflight({ warnOnly = false } = {}) {
  if (MIN_BOOT_BYTES <= 0) return true; // 0/negative disables the preflight
  return runDiskPreflightInner({ warnOnly });
}

async function runDiskPreflightInner({ warnOnly }) {
  const status = await refreshNow();
  if (status.status === 'unknown') {
    logger.warn('disk preflight: could not stat any watched path — proceeding');
    return true;
  }
  if (status.freeBytes >= MIN_BOOT_BYTES) {
    logger.info(
      { freeGB: +(status.freeBytes / GB).toFixed(2), minGB: +(MIN_BOOT_BYTES / GB).toFixed(2), volume: status.path },
      'disk preflight passed'
    );
    return true;
  }
  const msg = `disk preflight FAILED: only ${+(status.freeBytes / MB).toFixed(1)} MB free (need ${+(MIN_BOOT_BYTES / MB).toFixed(1)} MB)`;
  if (warnOnly) {
    logger.error({ freeBytes: status.freeBytes }, `${msg} — starting anyway (warnOnly)`);
    return true;
  }
  logger.fatal({ freeBytes: status.freeBytes, minBytes: MIN_BOOT_BYTES }, msg);
  return false;
}

// ── WAL size tracking + cap ──
let lastWalBytes = null;

/** Current size of the -wal file (bytes), or null if absent. */
export function walBytes() {
  try {
    const wal = `${path.resolve(env.DB_PATH || './database.sqlite')}-wal`;
    return fs.statSync(wal).size;
  } catch {
    return null;
  }
}

/**
 * Called by the periodic checkpoint loop. Checkpoints (and truncates) the
 * WAL when it exceeds DISK_WAL_CAP_MB, so the WAL cannot silently eat the
 * last free bytes of the volume. Cheap when under the cap (one statSync per
 * tick). Returns the action taken: 'truncated' | 'ok' | 'disabled'.
 */
export async function maybeCheckpointWal(db, { reason = 'periodic' } = {}) {
  if (env.DISK_WAL_CAP_MB <= 0) return 'disabled';
  const bytes = walBytes();
  lastWalBytes = bytes;
  if (bytes == null || bytes <= env.DISK_WAL_CAP_MB * MB) return 'ok';

  logger.warn({ walBytes: bytes, capBytes: env.DISK_WAL_CAP_MB * MB, reason }, 'WAL above cap — forcing TRUNCATE checkpoint');
  try {
    await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const after = walBytes();
    logger.info({ before: bytes, after }, 'WAL truncate checkpoint completed');
    return after != null && after < bytes ? 'truncated' : 'ok';
  } catch (err) {
    logger.warn({ err, before: bytes }, 'WAL truncate checkpoint failed (busy?)');
    return 'ok';
  }
}

/** Last observed WAL size — surfaced in /api/health. */
export function getLastWalBytes() {
  return lastWalBytes;
}
