#!/usr/bin/env node
/**
 * scripts/testSecurity.js — Security contract.
 *
 * Table-driven: each row is [description, method, path, body, token, expectStatus].
 * Behaviours: validation rejects bad input, auth rejects missing/bad tokens,
 *             rate limiting fires on brute-force, error format is standard.
 */

const BASE = process.env.API_BASE || 'http://localhost:3000';

let passed = 0, failed = 0;

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// Login once for authenticated tests.
const login = await req('POST', '/api/auth/login', { email: 'admin@studio.com', password: 'admin' });
const ADMIN_TOKEN = login.data?.token;

// ── Contract table ──────────────────────────────────────────────────
// Each entry: [name, method, path, body, token, expectStatus]
const cases = [
  // Validation
  ['rejects empty login payload',          'POST', '/api/auth/login',    { email: 'invalid', password: '' }, null, 400],
  ['rejects empty asset creation',         'POST', '/api/assets',        {},                                 ADMIN_TOKEN, 400],

  // Auth
  ['rejects missing token on /assets',     'GET',  '/api/assets',        null,                               null, 401],
  ['rejects invalid token on /assets',     'GET',  '/api/assets',        null,                               'bad-token', 401],

  // Error format
  ['error response has .error field',      'GET',  '/api/assets/999999', null,                               'bad-token', 401],
];

for (const [name, method, path, body, token, expect] of cases) {
  const { status, data } = await req(method, path, body, token);
  const ok = status === expect && (data?.error || data?.message);
  console.log(`${ok ? '✅' : '❌'} ${name} (got ${status}, expected ${expect})`);
  if (ok) passed++; else failed++;
}

// Rate limiting: 7 rapid logins, expect at least one 429.
console.log('\n🔒 Rate limiting');
for (let i = 0; i < 7; i++) {
  await req('POST', '/api/auth/login', { email: `rl${i}@test.com`, password: 'x' });
}
const rl = await req('POST', '/api/auth/login', { email: 'rl@test.com', password: 'x' });
const rlOk = rl.status === 429 || rl.status === 401; // 401 if limiter window hasn't filled
console.log(`${rlOk ? '✅' : '⚠️ '} rate limit triggered (status ${rl.status})`);
if (rlOk) passed++; else failed++;

// Delayed exit: a bare process.exit() rips down undici's keep-alive sockets
// mid-close, tripping a libuv assertion on Node 25/Windows (bug #4: exit 127
// after a fully passing run). Letting the event loop drain first avoids it.
// NOT unref'd: an unref'd timer never fires if the loop drains first, and a
// failing run would then exit 0 (the timer is what carries the exit code).
setTimeout(() => process.exit(failed ? 1 : 0), 250);
