// diskSpaceGuard.js — request-path short-circuit for disk-full conditions.
//
// While free space on any watched volume is 'critical', WRITE requests are
// rejected with 503 (Retry-After: 60) BEFORE they reach controllers — a
// rejected request cannot allocate WAL pages or write uploads, so the volume
// keeps whatever headroom remains for checkpoints and VACUUMs. READs stay
// open (better-sqlite3 reads don't grow the DB materially) so users can
// still inspect data while an operator frees space.
//
// 'low' and 'unknown' never block: unknown guards against statfs flakiness
// turning into an outage, and low is only advisory.
//
// The status comes from the TTL cache in diskSpaceService (one statfs per
// DISK_CHECK_INTERVAL_MS at most, burst-coalesced), so this middleware adds
// ~zero latency in the common case.

import { getStatus } from '../services/diskSpaceService.js';
import logger from '../utils/logger.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Only protect endpoints that actually write to disk. Auth/login stays open
// during an incident (operators need it), and GETs are never blocked.
const PROTECTED_PREFIXES = [
  '/api/assets',
  '/api/asset-types',
  '/api/departments',
  '/api/users',
  '/api/tickets',
  '/api/conversations',
  '/api/kits',
  '/api/consumables',
  '/api/backup',
  '/api/settings',
  '/api/setup',
];

let warnedCriticalAt = 0; // log at most once per minute, not per request

export default async function diskSpaceGuard(req, res, next) {
  if (!WRITE_METHODS.has(req.method)) return next();
  if (!PROTECTED_PREFIXES.some(p => req.originalUrl.startsWith(p))) return next();

  let status;
  try {
    status = await getStatus();
  } catch {
    return next(); // statfs infrastructure failure — fail open
  }

  if (status.status !== 'critical') return next();

  const now = Date.now();
  if (now - warnedCriticalAt > 60_000) {
    warnedCriticalAt = now;
    logger.error(
      { freeBytes: status.freeBytes, volume: status.path, url: req.originalUrl },
      'Disk critical — short-circuiting write requests with 503'
    );
  }

  res.set('Retry-After', '60');
  res.set('X-Disk-Status', 'critical');
  return res.status(503).json({
    error: 'Storage is critically low — writes are temporarily disabled. Please free disk space or contact an administrator.',
    code: 'DISK_CRITICAL',
  });
}
