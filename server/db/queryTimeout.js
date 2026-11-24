// ── queryTimeout.js ──
// Provides application-level query timeout enforcement for SQLite.
// SQLite has no built-in per-statement timeout (busy_timeout only handles locks).
// This module wraps db.run/get/all/exec with a Promise.race-based timeout.

import { QueryTimeoutError } from '../utils/AppError.js';

// ── Default timeout values (in milliseconds) ──
// Single queries default to 5 seconds; configurable via DB_QUERY_TIMEOUT_MS env var
const DEFAULT_QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT_MS, 10) || 5000;

// ── withTimeout: wraps any async function with a timeout guard ──
// If fn() does not resolve within timeoutMs, an AbortController-based cancellation
// is attempted, and a QueryTimeoutError is thrown regardless.
export async function withTimeout(fn, timeoutMs = DEFAULT_QUERY_TIMEOUT_MS, sql = '') {
  // Create an AbortController that we can signal to cancel the operation
  const controller = new AbortController();
  // Start a timer that will abort after the timeout elapses
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Race the actual database operation against a timeout promise
    const result = await Promise.race([
      // The actual work - passes the signal so it can be cancelled
      fn(controller.signal),
      // The timeout - rejects with AbortError when the timer fires
      new Promise((_, reject) => {
        // Attach a listener to handle the abort signal
        controller.signal.addEventListener('abort', () => {
          // Create a standard AbortError for identification
          const err = new DOMException('The operation was aborted', 'AbortError');
          // Reject the race promise with this error
          reject(err);
        });
      }),
    ]);
    // If we got here, the operation succeeded before timeout - clear the timer
    clearTimeout(timer);
    // Return the result of the successful operation
    return result;
  } catch (err) {
    // Always clear the timer to prevent memory leaks
    clearTimeout(timer);
    // If the error is an AbortError, it means our timeout fired
    if (err.name === 'AbortError') {
      // Throw a descriptive QueryTimeoutError with the SQL and timeout details
      throw new QueryTimeoutError(sql, timeoutMs);
    }
    // For any other error (SQL errors, constraint violations, etc.), re-throw as-is
    throw err;
  }
}

// ── createTimedDb: wraps a raw sqlite Database object with timeout-enforced methods ──
// Every .run(), .get(), .all(), and .exec() call is automatically wrapped with withTimeout.
// Returns a Proxy-wrapped database object that can be used as a drop-in replacement.
export function createTimedDb(db, defaultTimeout = DEFAULT_QUERY_TIMEOUT_MS) {
  // Store the timeout in the proxy closure for access in the get trap
  const timeout = defaultTimeout;
  // Return a JavaScript Proxy that intercepts method calls on the db object
  return new Proxy(db, {
    // The get trap intercepts property access on the db object
    get(target, prop, _receiver) {
      // Get the original method from the target object
      const original = target[prop];
      // Only intercept the four core database methods
      if (['run', 'get', 'all', 'exec'].includes(prop)) {
        // Return a wrapped version that applies the timeout
        return (...args) => {
          // The SQL string is typically the first argument for all four methods
          const sql = typeof args[0] === 'string' ? args[0] : '';
          // Wrap the original method call with the timeout guard.
          // NOTE: We do NOT pass the signal as a SQL bind parameter —
          // sqlite3 doesn't support abort signals, and injecting { signal }
          // as a trailing argument would be misinterpreted as named params.
          return withTimeout(
            // The signal is unused by sqlite3; we just call the original method
            (_signal) => original.apply(target, args),
            // Use the configured timeout
            timeout,
            // Pass the SQL for error reporting
            sql
          );
        };
      }
      // For all other properties (not run/get/all/exec), return the original value
      // This preserves access to .close(), .pragma(), etc.
      return original;
    },
  });
}
