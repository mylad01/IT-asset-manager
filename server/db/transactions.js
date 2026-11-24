// ── transactions.js ──
// Provides withTransaction() helper wrapping DB operations in
// BEGIN IMMEDIATE / COMMIT / ROLLBACK for atomicity and deadlock prevention.

import { withTimeout } from './queryTimeout.js';

// Default transaction timeout: 30 seconds (longer than single-query timeout)
const DEFAULT_TX_TIMEOUT_MS = parseInt(process.env.DB_TRANSACTION_TIMEOUT_MS, 10) || 30000;

// ── Per-connection transaction lane ──
// The sqlite3 driver behind getDb() is ASYNC and every request shares ONE
// connection, so two concurrent withTransaction calls interleave their
// statements: request A's BEGIN IMMEDIATE, then an await inside its callback
// yields the event loop, request B's BEGIN IMMEDIATE lands INSIDE A's open
// transaction, and SQLite answers "cannot start a transaction within a
// transaction" (HTTP 500) to the loser. Reproduced at 30-way concurrent
// asset transfers on 2026-10-13 (probe): 29/30 got 500.
//
// The fix mirrors the _onWalLane precedent in connection.js: serialize
// transactions per db handle on a promise lane, so only one transaction is
// open at a time. SQLite is single-writer anyway (WAL allows one writer), so
// the lane costs only queueing — it does not reduce throughput, it just makes
// the serialization explicit instead of corrupting each other's scope.
//
// Timeouts deliberately start only when a queued transaction BEGINS — a
// transaction stuck behind a slow predecessor is not itself slow.
// No call site nests withTransaction inside another (checked 2026-10-13:
// assetService, ticketService, conversationService, conversationArchiveService,
// setupService all call it at service entry points only), so the lane cannot
// deadlock on self-wait. Keep it that way.
const txLanes = new WeakMap();

function laneFor(db) {
  let lane = txLanes.get(db);
  if (!lane) {
    lane = Promise.resolve();
    txLanes.set(db, lane);
  }
  return lane;
}

async function runTransaction(db, fn, timeoutMs, logger) {
  // Begin an IMMEDIATE transaction to acquire the write lock upfront
  await db.exec('BEGIN IMMEDIATE');
  try {
    // Execute the callback within the transaction, passing db handle and signal
    const result = await withTimeout((signal) => fn(db, signal), timeoutMs, '<transaction>');
    // Commit the transaction to persist all changes atomically
    await db.exec('COMMIT');
    // Return the callback result for the caller to use
    return result;
  } catch (err) {
    // On any error, roll back to undo partial changes and maintain consistency
    await db.exec('ROLLBACK');
    // Log the rollback if a logger was provided (for debugging)
    if (logger) logger.error({ err }, 'Transaction rolled back');
    // Re-throw the original error so the caller can handle it appropriately
    throw err;
  }
}

// withTransaction: wraps a callback in a BEGIN IMMEDIATE TRANSACTION block,
// serialized per db handle (see lane comment above).
export function withTransaction(db, fn, { timeoutMs = DEFAULT_TX_TIMEOUT_MS, logger } = {}) {
  const run = laneFor(db).then(() => runTransaction(db, fn, timeoutMs, logger));
  // Advance the lane past this transaction (success OR failure — a rolled-back
  // transaction must not poison the queue, same pattern as _onWalLane).
  txLanes.set(db, run.then(() => {}, () => {}));
  return run;
}
