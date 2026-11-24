import pino from 'pino';
import path, { resolve } from 'path';
import env from '../config/env.js';

// ── Level Selection ──
// Priority: explicit LOG_LEVEL env var > NODE_ENV heuristic
const resolveLevel = () => {
  if (env.LOG_LEVEL) return env.LOG_LEVEL;
  switch (env.NODE_ENV) {
    case 'production':
      return 'info';
    case 'test':
      return 'silent';
    default:
      return 'debug'; // development
  }
};

const level = resolveLevel();
const isProduction = env.NODE_ENV === 'production';
const logDir = resolve(env.LOG_DIR || './logs');

// ── Sensitive field paths redacted BEFORE serialization ──
const REDACT_PATHS = [
  'password',
  'newPassword',
  'password_hash',
  'token',
  'req.headers.authorization',
  'req.body.password',
  'req.body.newPassword',
];

// ── Build the Logger ──
const buildLogger = () => {
  const baseOptions = {
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
      remove: false, // keep key, replace value — preserves log structure
    },
    base: {
      service: 'it-asset-manager',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (!isProduction) {
    // Development: pretty-print to stdout with colors
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  // Production: multistream → stdout + app log file + error log file
  const streams = [
    // Stream 1: stdout — captured by process manager / container runtime
    { level: 'info', stream: process.stdout },
    // Stream 2: app log — all levels DEBUG+, written to daily-rotated files
    {
      level: 'debug',
      stream: pino.transport({
        target: 'pino-roll',
        options: {
          file: path.join(logDir, 'app.log'),
          frequency: 'daily',
          limit: { count: 30, totalSize: 500_000_000 }, // 30 days, 500MB cap
          dateFormat: 'yyyy-MM-dd',
        },
      }),
    },
    // Stream 3: error log — only ERROR+, separate file for alerting/monitoring
    {
      level: 'error',
      stream: pino.transport({
        target: 'pino-roll',
        options: {
          file: path.join(logDir, 'error.log'),
          frequency: 'daily',
          limit: { count: 30, totalSize: 100_000_000 }, // 30 days, 100MB cap
          dateFormat: 'yyyy-MM-dd',
        },
      }),
    },
  ];

  return pino(baseOptions, pino.multistream(streams));
};

const logger = buildLogger();

// ── Helper: Create a Child Logger ──
export function createChildLogger(bindings) {
  return logger.child(bindings);
}

export default logger;
