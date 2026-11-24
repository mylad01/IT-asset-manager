#!/usr/bin/env node
/**
 * tests/helpers.mjs — shared test infrastructure for verification scripts.
 *
 * Every API test file duplicates api(), runTest(), assert(), login, and
 * pass/fail reporting.  This module centralises that so each contract file
 * focuses purely on behaviour.
 */

// ── Config ──────────────────────────────────────────────────────────
export const BASE = process.env.API_BASE || 'http://localhost:3000';

export const USERS = {
  admin:  { email: process.env.ADMIN_EMAIL  || 'admin@studio.com',  password: process.env.ADMIN_PASSWORD  || 'admin' },
  admin1: { email: process.env.ADMIN_EMAIL1 || 'admin1@studio.com', password: process.env.ADMIN_PASSWORD1 || '12345678' },
  admin2: { email: process.env.ADMIN_EMAIL2 || 'admin2@studio.com', password: process.env.ADMIN_PASSWORD2 || '12345678' },
  staff1: { email: process.env.STAFF_EMAIL  || 'staff1@studio.com', password: process.env.STAFF_PASSWORD  || '12345678' },
  staff2: { email: process.env.STAFF_EMAIL2 || 'staff2@studio.com', password: process.env.STAFF_PASSWORD2 || '12345678' },
};

// ── HTTP helper ─────────────────────────────────────────────────────
export async function api(method, url, body, token) {
  const headers = {};
  const isForm = body instanceof FormData;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* binary / empty */ }
  return { status: res.status, data, res };
}

// ── Login ───────────────────────────────────────────────────────────
export async function login(user = USERS.admin) {
  const { status, data } = await api('POST', '/auth/login', { email: user.email, password: user.password });
  if (status !== 200 || !data?.token) {
    throw new Error(`Login failed for ${user.email} (status ${status})`);
  }
  return { token: data.token, user: data.user ?? data };
}

// Resolve a user's id from GET /users.  Requires a working token.
export async function resolveUserId(email, token) {
  const { data: users } = await api('GET', '/users', null, token);
  return users?.find?.(u => u.email === email)?.id;
}

// ── Assertions ──────────────────────────────────────────────────────
export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── Test runner with pass/fail tracking ─────────────────────────────
let _passed = 0;
let _failed = 0;

export async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS - ${name}`);
    _passed++;
  } catch (err) {
    console.log(`FAIL - ${name}`);
    console.log(`       ${err.message}`);
    _failed++;
  }
}

/** Call at end of script to print summary and exit. */
export function report() {
  console.log(`\n--- Summary: ${_passed} passed, ${_failed} failed ---`);
  process.exit(_failed ? 1 : 0);
}

/** Non-fatal login — returns token or null. */
export async function tryLogin(user = USERS.admin) {
  try { return (await login(user)).token; } catch { return null; }
}
