// connection.js - Advanced SQLite ConnectionManager
// Health checks, WAL optimization, periodic checkpointing, graceful shutdown

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const State = { IDLE: 'idle', CONNECTING: 'connecting', READY: 'ready', CLOSED: 'closed' };

// Request-queue visibility: better-sqlite3-style calls here run on the sqlite3
// driver's thread pool. When a long operation (VACUUM, checkpoint, big query)
// occupies it, other DB-bound work queues behind it — historically invisible,
// which made the one-shot /api/health 503 class impossible to diagnose. A
// bounded ring (512 slots ≈ 4KB) of recent completion timings turns "is the
// queue backed up right now?" into a number surfaced on /api/health.
const RING_CAPACITY = 512;
const completionRing = new Float64Array(RING_CAPACITY);
let ringIndex = 0;
let ringCount = 0;
let inFlightDbOps = 0;
let peakInFlightDbOps = 0;

const recordDbOp = (durationMs) => {
  completionRing[ringIndex] = durationMs;
  ringIndex = (ringIndex + 1) % RING_CAPACITY;
  if (ringCount < RING_CAPACITY) ringCount += 1;
};

const timedDbOp = async (op) => {
  inFlightDbOps += 1;
  if (inFlightDbOps > peakInFlightDbOps) peakInFlightDbOps = inFlightDbOps;
  const t0 = performance.now();
  try {
    return await op();
  } finally {
    recordDbOp(performance.now() - t0);
    inFlightDbOps -= 1;
  }
};

class ConnectionManager {
  constructor() {
    this.db = null;
    this.state = State.IDLE;
    this._checkpointInterval = null;
    this._healthInflight = null;   // single-flight: concurrent probes share one execution
    this._walLane = Promise.resolve(); // serialized lane for WAL-touching PRAGMAs
  }

  async connect() {
    if (this.db && this.state === State.READY) return this.db;
    if (this.state === State.CONNECTING) {
      return new Promise((resolve) => {
        const check = () => { if (this.state !== State.CONNECTING) resolve(this.db); else setTimeout(check, 50); };
        check();
      });
    }
    this.state = State.CONNECTING;
    try {
      this.db = await open({ filename: env.DB_PATH, driver: sqlite3.Database });
      await this.db.exec('PRAGMA journal_mode = WAL');
      await this.db.exec('PRAGMA synchronous = NORMAL');
      await this.db.exec('PRAGMA busy_timeout = 5000');
      await this.db.exec('PRAGMA foreign_keys = ON');
      await this.db.exec('PRAGMA cache_size = -8000');
      await this.db.exec('PRAGMA temp_store = MEMORY');
      await this.db.exec('PRAGMA mmap_size = 268435456');
      await this.db.exec('PRAGMA wal_autocheckpoint = 1000');
      await this.db.exec(`PRAGMA journal_size_limit = ${env.DB_JOURNAL_SIZE_LIMIT}`);
      if (env.DB_INTEGRITY_CHECK_ON_STARTUP !== false) {
        const result = await timedDbOp(() => this.db.get('PRAGMA integrity_check'));
        if (result.integrity_check !== 'ok') {
          logger.fatal({ result }, 'Database integrity check failed');
          throw new Error('Integrity check failed');
        }
      }
      await this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      this.state = State.READY;
      this._startCheckpointInterval();
      logger.info({ dbPath: env.DB_PATH }, 'Database connection established');
      return this.db;
    } catch (err) { this.state = State.IDLE; throw err; }
  }

  _startCheckpointInterval() {
    if (this._checkpointInterval) clearInterval(this._checkpointInterval);
    // Single source of truth: server/config/env.js (strict 0-honoring parse).
    // The previous raw process.env re-read here disagreed with env.js on
    // unset/blank handling, so DB_WAL_CHECKPOINT_INTERVAL_MS=0 ("disable")
    // was parsed as "disabled" here but "60000" in env.js.
    const ms = env.DB_WAL_CHECKPOINT_INTERVAL_MS;
    // Disk-full hardening: when DISK_WAL_CAP_MB > 0, the checkpoint tick also
    // enforces a hard WAL size cap (TRUNCATE checkpoint) so the -wal file
    // cannot silently eat the last free bytes of the volume under write load.
    const capEnabled = env.DISK_WAL_CAP_MB > 0;
    if (ms > 0) {
      this._checkpointInterval = setInterval(async () => {
        try {
          // On the WAL lane: a periodic wal_checkpoint overlapping a health
          // probe's wal_checkpoint(PASSIVE) is one of the two ways SQLite
          // answered SQLITE_LOCKED (health 503) live on 2026-10-03.
          await this._onWalLane(() => this.db.exec('PRAGMA wal_checkpoint(PASSIVE)'));
          if (capEnabled) {
            const { maybeCheckpointWal } = await import('../services/diskSpaceService.js');
            await this._onWalLane(() => maybeCheckpointWal(this.db, { reason: 'periodic-checkpoint' }));
          }
        }
        catch (err) { logger.warn({ err }, 'Periodic WAL checkpoint failed'); }
      }, ms);
    } else if (capEnabled) {
      // Checkpoint loop disabled but a WAL cap was requested — run the cap
      // check on its own slow tick so the cap still holds.
      this._checkpointInterval = setInterval(async () => {
        try {
          const { maybeCheckpointWal } = await import('../services/diskSpaceService.js');
          await this._onWalLane(() => maybeCheckpointWal(this.db, { reason: 'wal-cap-only' }));
        }
        catch (err) { logger.warn({ err }, 'WAL cap check failed'); }
      }, 60_000);
    }
  }

  /** Serialize every in-process WAL-touching PRAGMA on one lane. Concurrent
   *  `PRAGMA wal_checkpoint(PASSIVE)` statements on a single connection make
   *  the sqlite3 driver run them in parallel, and SQLite answers
   *  SQLITE_LOCKED ("database table is locked") to the loser — proven
   *  offline on a DB copy 2026-10-03: concurrent health sequences fail at
   *  the wal step (5/8 at 8-way), while plain SELECT/UPDATE never collide.
   *  Live symptoms were /api/health 503s whenever two probes overlapped
   *  (direct + dev-proxy, or two browser polls fired by one page load) or a
   *  probe met the periodic checkpoint tick. */
  _onWalLane(fn) {
    const run = this._walLane.then(() => fn());
    this._walLane = run.then(() => {}, () => {}); // a failed op must not poison the lane
    return run;
  }

  /** Single-flight: concurrent probes share ONE execution instead of racing
   *  two PRAGMA sequences against each other. */
  async healthCheck() {
    if (!this.db || this.state !== State.READY) return { healthy: false, state: this.state };
    if (this._healthInflight) return this._healthInflight;
    this._healthInflight = this._runHealthCheck();
    return this._healthInflight;
  }

  async _runHealthCheck() {
    // Step-tagged attempts: an SQLITE_LOCKED/BUSY here names the step that
    // contended (integrity vs wal), which is what made the live 503 at
    // 2026-10-03 11:24:27 impossible to attribute from the payload alone.
    const attempt = () => this._onWalLane(async () => {
      const integrity = await timedDbOp(() => this.db.get('PRAGMA integrity_check'))
        .catch((err) => { err.message = `integrity step: ${err.message}`; throw err; });
      const wal = await timedDbOp(() => this.db.get('PRAGMA wal_checkpoint(PASSIVE)'))
        .catch((err) => {
          err.message = `wal step: ${err.message}`;
          err.integrityResult = integrity; // the DB was readable even though checkpointing contended
          throw err;
        });
      return { integrity, wal };
    });
    try {
      let res = null;
      let lastErr = null;
      // Bounded retries (100ms, then 300ms) for lock contention: in-process
      // WAL ops are serialized on the lane and health probes are
      // single-flighted, so a LOCKED here is by definition foreign — the
      // vacuum worker's VACUUM/TRUNCATE checkpoint thread or another
      // process. Transient contention must not be reported as unhealthiness.
      for (let i = 0; i < 3 && !res; i += 1) {
        try {
          res = await attempt();
        } catch (err) {
          if (!/SQLITE_(LOCKED|BUSY)/.test(String(err.message))) throw err;
          lastErr = err;
          if (i < 2) await new Promise((r) => setTimeout(r, i === 0 ? 100 : 300));
        }
      }
      if (!res) {
        if (lastErr?.integrityResult?.integrity_check === 'ok') {
          // Integrity answered ok in the failing attempt: the DB serves
          // reads fine — only checkpointing contended. Report healthy and
          // omit the wal figures rather than a false 503 (which the dev
          // proxy surfaces as a hard error to the UI).
          logger.warn({ err: lastErr.message }, 'Health probe: WAL checkpoint contended after retries — reporting healthy with wal omitted');
          return {
            healthy: true, integrity: 'ok', walResult: null, walPages: null,
            walOmitted: lastErr.message, state: this.state, ...this.getQueueStats(),
          };
        }
        throw lastErr;
      }
      const { integrity, wal } = res;
      return { healthy: integrity.integrity_check === 'ok', integrity: integrity.integrity_check,
        walResult: wal.checkpointed, walPages: wal.log, state: this.state, ...this.getQueueStats() };
    } catch (err) { return { healthy: false, reason: err.message, state: this.state, ...this.getQueueStats() }; }
    finally { this._healthInflight = null; }
  }

  // Snapshot of DB request-queue pressure for /api/health and diagnostics.
  getQueueStats() {
    const completed = completionRing.slice(0, ringCount);
    let total = 0;
    let max = 0;
    let slow = 0;
    for (let i = 0; i < completed.length; i += 1) {
      const v = completed[i];
      total += v;
      if (v > max) max = v;
      if (v > 100) slow += 1; // >100ms on a PRAGMA means the queue was stalled
    }
    return {
      state: this.state,
      db_queue: {
        in_flight: inFlightDbOps,
        peak_in_flight: peakInFlightDbOps,
        recent_completions: ringCount,
        recent_avg_ms: ringCount ? Math.round(total / ringCount * 10) / 10 : 0,
        recent_max_ms: ringCount ? Math.round(max * 10) / 10 : 0,
        recent_over_100ms: slow,
      },
    };
  }

  async getStats() {
    if (!this.db || this.state !== State.READY) return { pageCount: 0, pageSize: 0, dbSizeBytes: 0 };
    try {
      const pc = await this.db.get('PRAGMA page_count');
      const ps = await this.db.get('PRAGMA page_size');
      return { pageCount: pc.page_count, pageSize: ps.page_size, dbSizeBytes: pc.page_count * ps.page_size };
    } catch { return { pageCount: 0, pageSize: 0, dbSizeBytes: 0 }; }
  }

  async close() {
    if (this.db && this.state === State.READY) {
      if (this._checkpointInterval) { clearInterval(this._checkpointInterval); this._checkpointInterval = null; }
      try { await this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); await this.db.close(); }
      catch (err) { logger.warn({ err }, 'Error during database shutdown'); }
      this.state = State.CLOSED; this.db = null;
      logger.info('Database connection closed');
    }
  }
}

const connectionManager = new ConnectionManager();
export default connectionManager;
export const getConnection = () => connectionManager.connect();
