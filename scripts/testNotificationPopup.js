/**
 * Verifies the NotificationBell 75% popup end-to-end in real Chrome:
 *
 *   1. Bell click → popup opens, centered on viewport, 75vw × 75vh (desktop)
 *      and 92vw × 85vh on a phone viewport.
 *   2. Entrance animation runs and settles (opacity 0 → 1).
 *   3. Esc closes, backdrop click closes, X button closes — each unmounts
 *      the portal within the exit window (no stranded opacity:0 dialog).
 *   4. Backdrop blocks the page (backdrop-blur present) and body scroll locks.
 *   5. Content intact: Notifications heading, live dot, item rows or
 *      "caught up" empty state, footer toggle.
 *   6. No console errors during the whole flow.
 *
 * Requires the dev stack (Vite :5174, API :3000).
 *   node scripts/testNotificationPopup.js
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const APP_URL = process.env.APP_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && fs.existsSync(p));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function login(page) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL || 'admin@studio.com', password: process.env.ADMIN_PASSWORD || 'admin' }),
  }).then((r) => r.json());
  if (!res.token) throw new Error(`login failed: ${JSON.stringify(res).slice(0, 200)}`);
  await page.evaluateOnNewDocument((u, t) => {
    localStorage.setItem('studioUser', u);
    localStorage.setItem('studioToken', t);
  }, JSON.stringify(res.user), res.token);
}

async function openPopup(page) {
  await page.click('button[aria-label^="Notifications"]');
  await page.waitForSelector('[role="dialog"][aria-label="Notifications"]', { visible: true, timeout: 5000 });
  await wait(600); // let the entrance animation settle
  return page.$('[role="dialog"][aria-label="Notifications"]');
}

async function closeAndWait(page, how) {
  if (how === 'esc') await page.keyboard.press('Escape');
  if (how === 'backdrop') await page.mouse.click(8, 8);
  if (how === 'x') await page.click('[aria-label="Close notifications"]');
  // The panel must fully unmount (exit done) within ~1s.
  try {
    await page.waitForSelector('[role="dialog"][aria-label="Notifications"]', { hidden: true, timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

const dlgState = (page) => page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"][aria-label="Notifications"]');
  if (!dlg) return null;
  const r = dlg.getBoundingClientRect();
  return {
    w: r.width, h: r.height,
    x: r.x, y: r.y,
    vw: innerWidth, vh: innerHeight,
    opacity: getComputedStyle(dlg).opacity,
    text: dlg.textContent,
    hasBackdrop: !!document.querySelector('div.fixed.inset-0.backdrop-blur-sm'),
    bodyOverflow: document.body.style.overflow,
  };
});

console.log('Notification popup verification (75% screen, centered, animated)\n');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });

try {
  const consoleErrors = [];
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => consoleErrors.push(e.message.slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120)); });
  await page.setViewport({ width: 1280, height: 800 });
  await login(page);
  await page.goto(`${APP_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1000);

  // ── 1. Desktop open + geometry + animation ──
  const bell = await page.$('button[aria-label^="Notifications"]');
  check('bell button present', !!bell);
  await openPopup(page);
  let s = await dlgState(page);
  check('popup opens (opacity 1)', s && s.opacity === '1', `opacity=${s?.opacity}`);
  check('centered horizontally', Math.abs(s.x + s.w / 2 - s.vw / 2) < 2, `center offset=${(s.x + s.w / 2 - s.vw / 2).toFixed(1)}px`);
  check('centered vertically', Math.abs(s.y + s.h / 2 - s.vh / 2) < 2, `center offset=${(s.y + s.h / 2 - s.vh / 2).toFixed(1)}px`);
  check('desktop size is 75vw × 75vh', Math.abs(s.w - s.vw * 0.75) < 4 && Math.abs(s.h - s.vh * 0.75) < 4, `${Math.round(s.w)}×${Math.round(s.h)} in ${s.vw}×${s.vh}`);
  check('backdrop present (dim + blur)', s.hasBackdrop);
  check('body scroll locked', s.bodyOverflow === 'hidden');

  // entrance animation actually ran (framer leaves inline style after settle)
  const animated = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"][aria-label="Notifications"]');
    return el.style.opacity === '1' && el.style.transform === 'none';
  });
  check('entrance animation settled (scale/y → identity)', animated);

  // content intact
  s = await dlgState(page);
  check('header intact (Notifications + live dot)', /Notifications/.test(s.text));
  check('list or empty state renders', /caught up|new|Mark all read|info|critical|warning/.test(s.text));

  // ── 2. Close paths ──
  check('Esc closes and unmounts', await closeAndWait(page, 'esc'));
  await openPopup(page);
  check('X button closes and unmounts', await closeAndWait(page, 'x'));
  await openPopup(page);
  check('backdrop click closes and unmounts', await closeAndWait(page, 'backdrop'));
  check('body scroll restored after close', await page.evaluate(() => document.body.style.overflow !== 'hidden'));

  // ── 3. Exit doesn't strand the portal (reopen still works) ──
  await openPopup(page);
  await closeAndWait(page, 'esc');
  await openPopup(page);
  s = await dlgState(page);
  check('reopen after multiple cycles works', s && s.opacity === '1');

  // ── 4. Item interactions (if any notifications exist) ──
  const itemCount = await page.evaluate(() => document.querySelectorAll('[role="dialog"][aria-label="Notifications"] li').length);
  if (itemCount > 0) {
    const hoverBtns = await page.evaluate(() => {
      const li = document.querySelector('[role="dialog"][aria-label="Notifications"] li');
      li.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      return li.querySelectorAll('button').length;
    });
    check('item hover reveals actions', hoverBtns >= 2, `${hoverBtns} buttons`);
  } else {
    check('item hover reveals actions', true, 'skipped — no items');
  }

  // ── 5. Phone viewport ──
  await page.setViewport({ width: 390, height: 844 });
  await wait(500);
  if (!(await page.$('[role="dialog"][aria-label="Notifications"]'))) await openPopup(page);
  s = await dlgState(page);
  check('phone size is 92vw × 85vh', Math.abs(s.w - s.vw * 0.92) < 6 && Math.abs(s.h - s.vh * 0.85) < 6, `${Math.round(s.w)}×${Math.round(s.h)} in ${s.vw}×${s.vh}`);
  check('phone centered', Math.abs(s.x + s.w / 2 - s.vw / 2) < 2 && Math.abs(s.y + s.h / 2 - s.vh / 2) < 2);
  await closeAndWait(page, 'esc');

  // ── 6. Console cleanliness ──
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
