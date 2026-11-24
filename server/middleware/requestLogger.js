import pinoHttp from 'pino-http';
import logger from '../utils/logger.js';

// ── Request/Response Serializers ──
// Whitelist safe headers only — never log Authorization, Cookie, Set-Cookie
const requestSerializer = (req) => ({
  method: req.method,
  url: req.originalUrl || req.url,
  headers: {
    'user-agent': req.headers['user-agent'],
    'content-type': req.headers['content-type'],
    'x-request-id': req.headers['x-request-id'],
    'x-forwarded-for': req.headers['x-forwarded-for'],
  },
  reqId: req.id,
  ip: req.ip,
});

const responseSerializer = (res) => ({
  statusCode: res.statusCode,
});

// ── pino-http Middleware ──
const requestLogger = pinoHttp({
  logger,
  // Use the existing req.id from index.js:23-26 (randomUUID / X-Request-Id header)
  genReqId: (req) => req.id,

  customSuccessMessage: (req, res) =>
    `Request completed: ${req.method} ${req.originalUrl} ${res.statusCode}`,

  customErrorMessage: (req, res, err) =>
    `Request failed: ${req.method} ${req.originalUrl} ${res.statusCode}`,

  // Status-code-based log levels: 4xx → warn, 5xx → error, else → info
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },

  serializers: {
    req: requestSerializer,
    res: responseSerializer,
  },

  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
});

export default requestLogger;
