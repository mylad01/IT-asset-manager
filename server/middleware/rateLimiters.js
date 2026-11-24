import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import env from '../config/env.js';

// In LOAD_TEST_MODE=1 we mount a no-op limiter so the load harness can drive
// 1000+ VUs without every request being 429'd. The auth limiter is also
// disabled in this mode; the auth-bruteforce scenario should be run against
// a non-load-test server to exercise real rate limiting.
const noop = (req, res, next) => next();

const pick = (limiter) => (env.LOAD_TEST_MODE ? noop : limiter);

export const globalLimiter = pick(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.GLOBAL_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
}));

// Failed logins only, keyed by email+IP (PLAN.MD §16.5 F4). Two independent
// knobs, both aimed at the same goal — same-IP logins stop locking each
// other out:
//   - key = `${email}|${ip}` — one office NAT (or localhost during a QA
//     sweep) no longer shares a single bucket across every mailbox, so one
//     account's failures can't lock a different account's login;
//   - skipSuccessfulRequests — the store increments on arrival but decrements
//     back on any <400 response, so successful logins cost nothing and only
//     WRONG passwords count toward AUTH_RATE_LIMIT_MAX / 15 min per key.
// Per-account brute force still dies at the cap (proven by
// scripts/testAuthLimiter.js), and credential spraying across many emails
// stays volume-capped per source by the per-IP globalLimiter above.
const loginKey = (req) => {
  const raw = req.body?.email;
  const email = typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : 'unknown';
  return `${email}|${ipKeyGenerator(req.ip || '0.0.0.0')}`;
};

export const authLimiter = pick(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: loginKey,
  skipSuccessfulRequests: true, // only FAILED attempts are counted
  message: { error: 'Too many failed login attempts. Please try again in 15 minutes.' },
  // Override default handler to guarantee Retry-After is always set
  handler: (req, res, _next, _options) => {
    const windowSec = Math.ceil((15 * 60 * 1000) / 1000);
    res.setHeader('Retry-After', windowSec.toString());
    res.status(429).json({ error: 'Too many failed login attempts. Please try again in 15 minutes.' });
  },
}));

export const readLimiter = pick(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: env.READ_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many read requests. Please try again later.' },
}));

export const writeLimiter = pick(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.WRITE_RATE_LIMIT_MAX ?? 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many write requests. Please try again later.' },
}));

export const passwordChangeLimiter = pick(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many password change attempts. Please try again later.' },
}));
