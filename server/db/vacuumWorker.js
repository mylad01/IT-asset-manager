// vacuumWorker.js — off-thread VACUUM + WAL checkpoint for the main DB.
//
// Runs in its own worker thread so better-sqlite3's synchronous VACUUM never
// blocks the API server's event loop (bug #2: /api/health answered 503 while
// a large VACUUM ran, even though healthy:true and disk status was ok).
// It opens its OWN connection straight through better-sqlite3 — deliberately
// NOT getDb()/connectionManager, which are main-thread constructs. WAL mode
// allows this second connection; VACUUM's brief write lock now blocks only
// this worker thread, which is the whole point.

import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import Database from 'better-sqlite3';

const startedAt = Date.now();

try {
  const dbPath = workerData?.dbPath;
  if (!dbPath) throw new Error('vacuumWorker: workerData.dbPath is required');

  // Relative DB_PATH values resolve against the process CWD — exactly what
  // the main connection does, because node-sqlite3's open({ filename }) and
  // better-sqlite3 both hand relative paths to SQLite core, which resolves
  // them against the CWD (worker threads inherit the host process CWD).
  // Resolving against the repo root instead would vacuum the WRONG file for
  // any instance launched from a different working directory.
  const file = path.resolve(dbPath);

  // timeout: 30s busy timeout — a live write transaction on the main thread
  // delays the VACUUM instead of failing it with SQLITE_BUSY.
  const db = new Database(file, { timeout: 30_000 });

  const pageSize = db.pragma('page_size', { simple: true });
  const pagesBefore = db.pragma('page_count', { simple: true });

  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');

  const pagesAfter = db.pragma('page_count', { simple: true });
  db.close();

  parentPort.postMessage({
    ok: true,
    durationMs: Date.now() - startedAt,
    spaceReclaimedBytes: Math.max(0, (pagesBefore - pagesAfter) * pageSize),
  });
} catch (err) {
  parentPort?.postMessage({ ok: false, error: err?.message || String(err) });
  process.exitCode = 1;
}
