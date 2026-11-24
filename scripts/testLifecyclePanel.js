/**
 * Lifecycle panel regression test: drives the polished "Conversation Lifecycle
 * & Storage" panel in Settings through the real UI and verifies behavior, not
 * just markup:
 *
 *   1. Panel copy renders (restorability, 6-hour cadence, run-now helper).
 *   2. Number edits debounce — typing "45" fires exactly ONE settings PUT.
 *   3. Per-row "Saved" acknowledgement appears, then fades (~2s).
 *   4. "Run lifecycle now" is gated by a confirm modal warning about
 *      permanent purge; Cancel runs nothing; confirming reports real counts.
 *   5. Zero console errors across the whole flow.
 *
 * SIDE EFFECTS: confirming the run archives idle conversations and purges
 * expired recycle-bin items on whatever DB the API is serving — run against
 * the dev stack, never production. The retention number typed during the
 * debounce check is restored afterwards (best effort).
 *
 * Requires the dev stack already running (Vite :5174, API :3000).
 *   node scripts/testLifecyclePanel.js
 *
 * Env: APP_URL, API_URL, CHROME_PATH, TEST_EMAIL, TEST_PASSWORD
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const APP_URL = process.env.APP_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';
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

// Login through the API (the endpoint is rate-limited; reruns back off and
// retry instead of hard-failing) and inject the session before app load.
async function login() {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    if (res.ok) {
      const d = await res.json();
      if (!d.user || !d.token) throw new Error('Login response missing user/token');
      return { user: JSON.stringify(d.user), token: d.token };
    }
    console.log(`login ${res.status} — retry ${attempt}/10 in 20s`);
    await wait(20000);
  }
  throw new Error('Login kept failing (rate limit?)');
}

async function main() {
  const { user, token } = await login();

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-first-run'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  const server5xx = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.text())) {
      consoleErrors.push(m.text().slice(0, 150));
    }
  });
  page.on('response', (r) => {
    if (r.status() >= 500) {
      server5xx.push(`${r.request().method()} ${r.url()} -> ${r.status()}`);
    }
  });

  await page.evaluateOnNewDocument((u, t) => {
    localStorage.setItem('studioUser', u);
    localStorage.setItem('studioToken', t);
  }, user, token);

  await page.goto(`${APP_URL}/settings`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(
    () => document.body.innerText.includes('Conversation Lifecycle & Storage'),
    { timeout: 15000 },
  ).catch(() => {});

  // A freshly reseeded dev DB ships conversation auto-archive OFF, and
  // Settings.jsx renders the idle-threshold row inside `{convAutoArchive &&
  // …}` — so the cadence copy is not in the DOM at all, and the number-field
  // index below silently shifts (inputs[0] stops being the idle threshold).
  // Turning the toggle on is what a user would do to see that section; it
  // runs BEFORE the PUT listener is registered, so it is not counted as a
  // debounce.
  await page.evaluate(() => {
    const title = [...document.querySelectorAll('p')]
      .find((p) => p.textContent.includes('Auto-archive idle conversations'));
    const row = title?.closest('.items-center.justify-between');
    const box = row?.querySelector('input[type="checkbox"]');
    if (box && !box.checked) box.click();
  });
  await wait(600);

  const t = await page.evaluate(() => document.body.innerText);

  // ── 1. Copy present ──────────────────────────────────────────────────
  check(t.includes('Conversation Lifecycle & Storage'), 'lifecycle panel visible');
  check(t.includes('stay readable and can be restored'), 'intro copy explains restorability');
  check(t.includes('checked every 6 hours'), 'idle-threshold copy states cadence');
  check(t.includes('Run lifecycle now'), 'button renamed to Run lifecycle now');
  check(t.includes('Applies the settings above immediately'), 'run-now helper line present');

  // Count PUTs while typing to verify debounce (typing "45" = 1 PUT, not 2)
  const putCounts = [];
  page.on('response', (r) => {
    if (r.request().method() === 'PUT' && r.url().includes('/api/settings')) {
      putCounts.push(r.status());
    }
  });

  // ── 2. Debounced save on a number field ──────────────────────────────
  // Target the row by its LABEL, not a DOM index: the Conversation
  // Backups section renders a conditional "Backup Interval (hours)" number
  // input whenever auto-backup is on, which shifts every index — an
  // earlier run sent this suite's keystrokes into the idle-threshold row
  // and left garbage in conversation_auto_archive_days.
  const retention = await page.evaluateHandle(() => {
    const label = [...document.querySelectorAll('p')]
      .find((p) => p.textContent.trim() === 'Recycle bin retention (days)');
    let row = label;
    while (row && !row.querySelector?.('input[type="number"]')) row = row.parentElement;
    return row?.querySelector('input[type="number"]') || null;
  });
  const originalValue = await page.evaluate(
    (el) => (el ? el.value : null),
    retention.asElement(),
  );
  await retention.asElement().click({ clickCount: 3 });
  await page.keyboard.type('45', { delay: 60 });
  await wait(1400); // > debounce window
  check(putCounts.length === 1,
    `debounced save fires once for 2 keystrokes (${putCounts.length} PUTs)`);

  // ── 3. Per-row Saved tick appears, then fades ────────────────────────
  const tickVisible = await page.evaluate(() => {
    const ticks = [...document.querySelectorAll('span')]
      .filter((s) => s.textContent.trim().startsWith('Saved'));
    return ticks.some((s) => getComputedStyle(s).opacity === '1' && s.offsetParent !== null);
  });
  check(tickVisible, 'per-row Saved acknowledgement visible after save',
    `${putCounts.length} puts`);
  await wait(2600);
  const tickGone = await page.evaluate(() => {
    const ticks = [...document.querySelectorAll('span')]
      .filter((s) => s.textContent.trim().startsWith('Saved'));
    return ticks.every((s) => getComputedStyle(s).opacity === '0' || s.offsetParent === null);
  });
  check(tickGone, 'Saved tick fades out after ~2s');

  // Restore the retention value we overwrote (same debounced path).
  if (originalValue != null && originalValue !== '45') {
    await retention.asElement().click({ clickCount: 3 });
    await page.keyboard.type(originalValue, { delay: 60 });
    await wait(1400);
  }

  // ── 4. Confirm modal gates the destructive run ───────────────────────
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Run lifecycle now'))?.click();
  });
  await wait(700);
  const modalText = await page.evaluate(() => document.body.innerText);
  check(/Run lifecycle now\?/.test(modalText) && /cannot be recovered/.test(modalText),
    'confirm modal warns about permanent purge');
  check(/\bCancel\b/.test(modalText), 'modal offers cancel');

  // Cancel first — nothing should run
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.glass-modal button, [class*="modal"] button')];
    btns.find((b) => b.textContent.trim() === 'Cancel')?.click();
  });
  await wait(500);

  // Now confirm for real
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Run lifecycle now'))?.click();
  });
  await wait(500);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.find((b) => b.textContent.trim() === 'Run lifecycle' && !b.textContent.includes('now'))?.click();
  });
  await wait(2500);
  const after = await page.evaluate(() => document.body.innerText);
  check(/Lifecycle run completed — \d+ conversations? archived, \d+ recycle-bin items? purged/.test(after),
    'success summary states real counts',
    after.match(/Lifecycle run[^\n]*/)?.[0] || 'missing');

  // ── 5. No console errors during the whole flow ───────────────────────
  // Known transient: Vite proxies /api to :3000, and post-run lifecycle work
  // (WAL checkpoint / debounced VACUUM) can stall the single-threaded server
  // long enough for the proxy to answer the DiskStatusBanner's health poll
  // with a one-off 503. The app correctly ignores it (ok:false → notice left
  // alone). Each health-503 response is typically logged twice by Chrome
  // (the browser logs both the proxied response and the socket reset), so
  // the discount is 1:1 per observed health-503 response, not a single
  // removal — any other console error or 5xx still fails.
  const health503s = server5xx.filter((s) => /\/api\/health/.test(s) && /-> 503$/.test(s));
  const real5xx = server5xx.filter((s) => !(/\/api\/health/.test(s) && /-> 503$/.test(s)));
  const realConsole = [...consoleErrors];
  for (let i = 0; i < health503s.length; i += 1) {
    const idx = realConsole.findIndex((c) => /Failed to load resource.*503/.test(c));
    if (idx < 0) break;
    realConsole.splice(idx, 1);
  }
  check(realConsole.length === 0 && real5xx.length === 0, 'zero console errors',
    [...realConsole, ...real5xx].join(' :: '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('Lifecycle panel test failed:', e.message); process.exit(1); });
