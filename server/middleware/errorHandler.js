import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

export default function errorHandler(err, req, res, _next) {
  // Defensive: req.log may be undefined if error occurs before pino-http attaches it
  const log = req.log || logger;

  if (err instanceof AppError) {
    log.warn({ reqId: req.id, statusCode: err.statusCode, err }, 'Application error');
    return res.status(err.statusCode).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }

  if (err.name === 'ZodError' && err.issues) {
    const details = err.issues.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    log.warn({ reqId: req.id, issues: details }, 'Validation failed');
    return res.status(400).json({ error: 'Validation failed', details });
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    log.warn({ reqId: req.id, errType: err.name }, 'Authentication error');
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  if (err.name === 'SyntaxError' && 'body' in err) {
    log.warn({ reqId: req.id }, 'Malformed JSON in request body');
    return res.status(400).json({ error: 'Malformed JSON in request body.' });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    log.warn({ reqId: req.id }, 'File too large');
    return res.status(413).json({ error: 'File too large — videos up to 50 MB, images up to 25 MB, documents up to 10 MB.' });
  }

  if (err.code === 'LIMIT_UNACCEPTABLE_TYPE') {
    log.warn({ reqId: req.id }, 'Unsupported file type');
    return res.status(400).json({ error: 'Unsupported file type. Allowed: JPG, PNG, GIF, WebP, MP4, WebM, MOV, PDF, TXT.' });
  }

  // Disk-full: SQLite cannot write (WAL append fails at max-reserve bytes)
  // or the OS cannot allocate for an upload file. Better a clear 503 with
  // Retry-After than a generic 500 — the diskSpaceGuard should have caught
  // most of these upstream; this is the last-resort mapping for races.
  if (err.code === 'SQLITE_FULL' || err.code === 'ENOSPC') {
    log.error({ reqId: req.id, code: err.code }, 'Disk full — storage exhausted');
    res.set('Retry-After', '60');
    return res.status(503).json({
      error: 'Storage is full — the operation could not be completed. Please free disk space or contact an administrator.',
      code: 'DISK_FULL',
    });
  }

  // SQLite UNIQUE/FK violations → 409 Conflict (e.g. duplicate email, duplicate asset type name).
  if (err.code && String(err.code).startsWith('SQLITE_CONSTRAINT')) {
    const isUnique = String(err.code).includes('UNIQUE');
    log.warn({ reqId: req.id, code: err.code }, 'Constraint violation');
    return res.status(409).json({
      error: isUnique
        ? 'A record with these details already exists.'
        : 'This operation conflicts with existing data.',
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    log.warn({ reqId: req.id, field: err.field }, 'Unexpected file field');
    return res.status(400).json({ error: 'Unexpected file field.' });
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    log.warn({ reqId: req.id }, 'Too many files uploaded');
    return res.status(400).json({ error: 'Too many files uploaded.' });
  }

  if (err.status && err.message) {
    log.warn({ reqId: req.id, statusCode: err.status, err }, 'Request error');
    return res.status(err.status).json({ error: err.message });
  }

  // Unhandled/unexpected errors — log at error level with full context
  log.error({ reqId: req.id, err }, 'Unhandled error');

  return res.status(500).json({ error: 'Internal server error.' });
}
