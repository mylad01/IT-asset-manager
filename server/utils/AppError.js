// ── AppError: Base class for all operational (non-programmer) errors ──
export default class AppError extends Error {
  // Constructor takes a message, an optional HTTP status code (defaults to 500),
  // and an optional structured payload for the error body
  constructor(message, statusCode = 500, details = null) {
    // Call the parent Error constructor with the message
    super(message);
    // Set the error name to 'AppError' for identification in error handlers
    this.name = 'AppError';
    // Store the HTTP status code to be used by the Express error handler middleware
    this.statusCode = statusCode;
    // Optional structured payload for the error body (e.g. the conflicting
    // range on a 409 overlap) — errorHandler spreads it next to `error`.
    this.details = details;
    // Mark as operational error — distinguishes from programmer bugs (syntax errors, etc.)
    this.isOperational = true;
  }
}

// ── QueryTimeoutError: Thrown when a database query exceeds its timeout limit ──
export class QueryTimeoutError extends AppError {
  // Constructor takes the SQL that timed out and the timeout duration in ms
  constructor(sql, timeoutMs) {
    // Call parent with a descriptive 508 (Loop Detected) status code
    super(`Query timed out after ${timeoutMs}ms`, 508);
    // Set a distinct error name for easy identification in error handlers and logs
    this.name = 'QueryTimeoutError';
    // Store the original SQL so developers can identify which query was slow
    this.sql = sql;
    // Store the timeout value for diagnostics and monitoring
    this.timeoutMs = timeoutMs;
    // Mark as operational — this is expected behavior, not a bug
    this.isOperational = true;
  }
}
