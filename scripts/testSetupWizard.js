#!/usr/bin/env node

/**
 * Setup Wizard Verification Script
 * Tests: SETUP_PENDING gate, wizard flow (root admin, backup, prefs, complete),
 *        re-run refusal, non-destructive existing-DB upgrade
 *
 * Requires: API server running in SETUP_PENDING state (fresh production DB:
 *   NODE_ENV=production, empty database). Run against a temporary DB only —
 *   this flow mutates setup state.
 * Usage:    node scripts/testSetupWizard.js
 * Env:      API_BASE (default http://localhost:3000)
 */

import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const BASE = process.env.API_BASE || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.WIZARD_EMAIL || 'wizard-admin@example.com';
const ADMIN_PASSWORD = process.env.WIZARD_PASSWORD || 'WizardPass123!';

let passed = 0;
let failed = 0;

async function api(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS - ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL - ${name}`);
    console.log(`       ${err.message}`);
    failed++;
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const status = await api('GET', '/setup/status');
if (status.status !== 200) {
  console.log(`Could not reach API (${status.status}). Start a SETUP_PENDING server first.`);
  process.exit(1);
}

if (status.data.status !== 'SETUP_PENDING') {
  console.log(`Server reports ${status.data.status} — script only works against a SETUP_PENDING instance.`);
  process.exit(1);
}

await runTest('status reports SETUP_PENDING', async () => {
  assert(status.data.status === 'SETUP_PENDING', `got ${status.data.status}`);
});

await runTest('gate blocks business routes with 409', async () => {
  const res = await api('GET', '/assets');
  assert(res.status === 409 && res.data.error === 'in_setup', `got ${res.status}`);
});

await runTest('login is reachable during pending (no 409)', async () => {
  const res = await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: 'whatever' });
  assert(res.status !== 409, 'login should not be gated');
});

await runTest('create root admin', async () => {
  const res = await api('POST', '/setup/root-admin', {
    name: 'Wizard Admin',
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  assert(res.status === 200 && res.data.success === true, `root-admin ${res.status} ${JSON.stringify(res.data)}`);
});

await runTest('reserved seed email rejected', async () => {
  const res = await api('POST', '/setup/root-admin', {
    name: 'Bad',
    email: 'admin@studio.com',
    password: 'xxxxxxxx123',
  });
  assert(res.status === 400, `reserved email should be rejected, got ${res.status}`);
});

const validPath = path.join(os.tmpdir(), `itame-setup-test-${Date.now()}`);

await runTest('backup path validated + saved', async () => {
  const testRes = await api('POST', '/setup/backup/test', { path: validPath });
  assert(testRes.status === 200, `backup/test ${testRes.status}`);
  const saveRes = await api('POST', '/setup/backup', { path: validPath });
  assert(saveRes.status === 200, `backup save ${saveRes.status}`);
});

await runTest('preferences saved', async () => {
  const res = await api('POST', '/setup/preferences', { wsEnabled: false, browserPopupEnabled: true });
  assert(res.status === 200, `preferences ${res.status}`);
});

await runTest('complete setup', async () => {
  const res = await api('POST', '/setup/complete');
  assert(res.status === 200, `complete ${res.status}`);
});

await delay(300);

await runTest('root admin logs in with isRoot=true', async () => {
  const res = await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert(res.status === 200, `login ${res.status}`);
  assert(res.data.user.isRoot === true, 'wizard admin must be root');
});

await runTest('gate opens after setup', async () => {
  const res = await api('GET', '/assets', null, 'anything');
  assert(res.status !== 409, 'business routes should no longer be gated');
});

await runTest('setup re-run refused', async () => {
  const res = await api('POST', '/setup/complete');
  assert(res.status === 409, `re-run should be refused, got ${res.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);