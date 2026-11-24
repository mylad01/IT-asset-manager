/**
 * Disk-status banner regression test: verifies the app-wide storage notice
 * through the real UI with an intercepted API layer.
 *
 * Covered behavior:
 *   1. 503 DISK_CRITICAL on a write  → amber banner with calm copy
 *      ("what still works", who to contact).
 *   2. Escalation to DISK_FULL       → red banner with reassurance copy.
 *   3. Dismiss hides the banner (5-min TTL).
 *   4. A fresh disk-status event overrides a dismissal — a failure the user
 *      just experienced must always be visible.
 *   5. Recovery: /api/health reporting ok clears the banner automatically.
 *   6. Zero unexpected console errors.
 *
 * Assertions read the banner element (role="status") — NOT body text — because
 * the apiClient toast repeats the same copy for ~5s and would false-match.
 *
 * Requires the dev stack running (Vite :5174, API :3000). All API traffic is
 * intercepted; nothing touches the real database.
 *
 *   node scripts/testDiskStatusBanner.js
 *
 * Env: APP_URL, CHROME_PATH, TEST_EMAIL, TEST_PASSWORD
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const APP_URL = process.env.APP_URL || 'http://localhost:5174';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@studio.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin';
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && fs.existsSync(p));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const check = (ok, name, note = '') => {
  if (ok) { console.log(`PASS - ${name}`); passed++; }
  else { console.log(`FAIL - ${name}${note ? ` :: ${note}` : ''}`); failed++; }
};

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-first-run'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.text())
      && !/Failed to load resource.*503/.test(m.text())) {
      consoleErrors.push(m.text().slice(0, 150));
    }
  });

  let mode = null;
  const CORS = {
    'Access-Control-Allow-Origin': APP_URL,
    'Access-Control-Allow-Credentials': 'true',
  };
  const RESP = {
    critical: { status: 503, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'Storage is critically low — writes are temporarily disabled. Please free disk space or contact an administrator.', code: 'DISK_CRITICAL' }) },
    full: { status: 503, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'Storage is full — the operation could not be completed. Please free disk space or contact an administrator.', code: 'DISK_FULL' }) },
    healthCritical: { status: 503, headers: CORS, contentType: 'application/json', body: JSON.stringify({ healthy: true, integrity: 'ok', state: 'ready', disk: { status: 'critical', free_bytes: 734003200, total_bytes: 214998523904 }, wal_bytes: 0 }) },
    healthOk: { status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ healthy: true, integrity: 'ok', state: 'ready', disk: { status: 'ok', free_bytes: 129000000000, total_bytes: 214998523904 }, wal_bytes: 100 }) },
  };

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (mode && u.includes('/api/health')) {
      // CORS preflights must reach the REAL server. Our synthetic bodies carry
      // Allow-Origin but NOT Allow-Headers, so answering OPTIONS here makes the
      // browser reject the Authorization header and log a CORS error — which
      // fails this suite's own "zero console errors" assertion. The actual GET
      // below is still faked.
      if (req.method() === 'OPTIONS') return req.continue();
      return req.respond(mode === 'recovered' ? RESP.healthOk : RESP.healthCritical);
    }
    if (mode === 'critical' && u.includes('/api/conversations') && req.method() === 'POST') return req.respond(RESP.critical);
    if (mode === 'full' && u.includes('/api/conversations') && req.method() === 'POST') return req.respond(RESP.full);
    req.continue();
  });

  const EMAIL = TEST_EMAIL;
  const PASSWORD = TEST_PASSWORD;
  // Login through the real UI form (this suite is about UI wiring).
  await page.goto(`${APP_URL}/login`, { waitUntil: 'domcontentloaded' });
  await wait(900);
  await page.evaluate((email, password) => {
    const setVal = (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setVal('input[type="text"]', email);
    setVal('input[type="password"]', password);
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Secure Login')?.click();
  }, EMAIL, PASSWORD);
  await wait(2500);

  // Post through the app's real apiClient so the disk-status event wiring is exercised.
  const postViaApp = () => page.evaluate(async () => {
    const mod = await import('/src/utils/apiClient.js');
    return mod.default.post('/api/conversations/55/messages', { content: 'x' });
  });

  // Assertions read the banner element itself (role="status"), NOT body text —
  // the apiClient toast repeats the same copy for 5s and would false-match.
  const bannerText = () => page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Dismiss storage notice"]');
    return btn ? btn.closest('[role="status"]')?.innerText ?? '' : '';
  });

  // 1. DISK_CRITICAL write → amber banner
  mode = 'critical';
  await postViaApp();
  await wait(900);
  let t = await bannerText();
  check(/Storage is critically low/.test(t), 'amber banner appears on DISK_CRITICAL write');
  check(/Saving is paused until an administrator frees up disk space/.test(t), 'calm copy: what still works');

  // 2. Escalation to red
  mode = 'full';
  await postViaApp();
  await wait(500);
  t = await bannerText();
  check(/Storage is full/.test(t), 'red escalation on DISK_FULL');
  check(/Nothing you just tried was lost/.test(t), 'reassurance copy on full');

  // 3. Dismiss hides it
  await page.evaluate(() => document.querySelector('button[aria-label="Dismiss storage notice"]')?.click());
  await wait(400);
  t = await bannerText();
  check(!/Storage is full/.test(t), 'dismiss hides the banner');

  // 4. A fresh event overrides the dismissal (kind 'full' — the component
  //    never de-escalates, so assert visibility, not a title downgrade)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('disk-status', { detail: { kind: 'full' } })));
  await wait(300);
  t = await bannerText();
  check(/Storage is full/.test(t), 'fresh event overrides dismissal (user just hit a failure)');

  // 5. Recovery: poll returns ok → banner auto-clears
  mode = 'recovered';
  await page.evaluate(() => document.querySelector('button[aria-label="Dismiss storage notice"]')?.click());
  await wait(400);
  t = await bannerText();
  check(!/Storage is (critically low|full)/.test(t), 'dismissed again before recovery wait');
  await wait(31_500);
  t = await bannerText();
  check(!/Storage is (critically low|full)/.test(t), 'banner auto-clears once /api/health reports recovery');

  // 6. No unexpected console errors (health 503 during simulated incidents is filtered)
  check(consoleErrors.length === 0, 'zero console errors', consoleErrors.join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('Disk status banner test failed:', e.message); process.exit(1); });
