/**
 * Trend theme preset regression — the 2026-10 preset wave (Noir, Aurora,
 * Matcha, Slate) promoted out of scripts/.runtime. Drives the real
 * Appearance gallery through the system Chrome/Edge (puppeteer-core, same
 * pattern as testUiJourney / testDiskStatusBanner):
 *
 *   1. Login through the UI, open Settings → Appearance.
 *   2. The gallery lists every registry preset label (labels are
 *      single-sourced from shared/preferencesRegistry.js — a new preset
 *      needs no edit here).
 *   3. Click Noir / Matcha / Aurora / Slate through the real gallery
 *      buttons and assert the [data-theme] token blocks ACTUALLY APPLY —
 *      computed --glass-bg / --sidebar-text values, not just the
 *      data-theme attribute (the live counterpart to testThemeContrast's
 *      static index.css parsing).
 *   4. Reload: Matcha must survive the pre-paint script (no FOUC of the
 *      previous theme).
 *   5. Restore the original theme through the same gallery and restore
 *      localStorage byte-for-byte — side-effect-free overall.
 *   6. Zero unexpected console errors.
 *
 * Requires the dev stack already running (Vite :5174, API :3000).
 *   node scripts/testTrendPresets.js
 *
 * Env: APP_URL, CHROME_PATH, TEST_EMAIL, TEST_PASSWORD
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { THEME_PRESETS } from '../shared/preferencesRegistry.js';

const APP_URL = process.env.APP_URL || 'http://localhost:5174';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@studio.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin';
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('no browser'); process.exit(2); }

/** Gallery labels + value→label map, single-sourced from the registry. */
const LABELS = THEME_PRESETS.map((t) => t.label);
const themeLabel = (v) => THEME_PRESETS.find((t) => t.value === v)?.label;

let passed = 0, failed = 0;
const check = (ok, name, note = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && note ? ` :: ${note}` : ''}`);
  if (ok) passed++; else failed++;
};
const consoleErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickLabel(page, label) {
  await page.waitForFunction((lbl) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(lbl)), { timeout: 15000 }, label)
    .catch(() => {});
  const ok = await page.evaluate((lbl) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(lbl));
    if (btn) { btn.click(); return true; }
    return false;
  }, label);
  if (!ok) throw new Error(`gallery button "${label}" not found`);
  await sleep(700);
}

const state = (page) => page.evaluate(() => {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  return {
    theme: html.getAttribute('data-theme'),
    brightness: html.getAttribute('data-brightness'),
    glassBg: cs.getPropertyValue('--glass-bg').trim(),
    sidebarText: cs.getPropertyValue('--sidebar-text').trim(),
  };
});

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 150)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) consoleErrors.push(m.text().slice(0, 150)); });

  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  const saved = await page.evaluate(() => JSON.stringify({
    prefs: localStorage.getItem('studioUiPrefs'),
    token: localStorage.getItem('studioToken'),
    user: localStorage.getItem('studioUser'),
  }));
  const originalTheme = await page.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem('studioUiPrefs') || '{}').theme) || 'dark'; } catch { return 'dark'; }
  });

  // login through the UI
  await page.type('input[type="text"]', TEST_EMAIL);
  await page.type('input[type="password"]', TEST_PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!document.querySelector('main'), { timeout: 20000 });

  // ── gallery lists every registry preset ──────────────────────────────
  await page.goto(`${APP_URL}/settings`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  const labels = await page.evaluate((want) => {
    const text = document.body.innerText;
    return want.map((w) => [w, text.includes(w)]);
  }, LABELS);
  check(labels.every(([, ok]) => ok), `gallery: all ${LABELS.length} preset labels render`,
    JSON.stringify(labels.filter(([, ok]) => !ok).map(([w]) => w)));

  const before = await state(page);

  // ── NOIR: dark preset applies token block ────────────────────────────
  await clickLabel(page, 'Noir');
  const noir = await state(page);
  check(noir.theme === 'noir' && noir.brightness === 'dark', 'noir: data-theme + data-brightness', JSON.stringify(noir));
  check(noir.glassBg === 'rgba(255, 255, 255, 0.06)', 'noir: [data-theme=noir] token block applied (--glass-bg)', JSON.stringify(noir));

  // ── MATCHA: light preset applies token block + patch interplay ───────
  await clickLabel(page, 'Matcha');
  const matcha = await state(page);
  check(matcha.theme === 'matcha' && matcha.brightness === 'light', 'matcha: data-theme + data-brightness', JSON.stringify(matcha));
  check(matcha.glassBg.startsWith('rgba(247, 251, 238, 0.5'), 'matcha: [data-theme=matcha] token block applied (--glass-bg)', JSON.stringify(matcha));
  check(matcha.sidebarText === 'rgba(44, 56, 32, 0.72)', 'matcha: sidebar text token applied', JSON.stringify(matcha));

  // ── persistence through reload (pre-paint path) ──────────────────────
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(500);
  const afterReload = await state(page);
  check(afterReload.theme === 'matcha' && afterReload.brightness === 'light',
    'matcha survives reload (pre-paint maps it before hydration)', JSON.stringify(afterReload));

  // ── AURORA + SLATE: switch both, assert distinct tokens ──────────────
  await page.goto(`${APP_URL}/settings`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(900);
  await clickLabel(page, 'Aurora');
  const aurora = await state(page);
  check(aurora.theme === 'aurora' && aurora.glassBg === 'rgba(45, 212, 191, 0.08)',
    'aurora: token block applied', JSON.stringify(aurora));
  await clickLabel(page, 'Slate');
  const slate = await state(page);
  check(slate.theme === 'slate' && slate.glassBg === 'rgba(203, 213, 225, 0.07)',
    'slate: token block applied', JSON.stringify(slate));

  // ── restore the original preset through the same gallery ─────────────
  await clickLabel(page, themeLabel(originalTheme) || 'Studio Dark');
  const restoredTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check(restoredTheme === originalTheme, `restore: theme back to ${originalTheme}`, `got ${restoredTheme}`);

  await page.evaluate((s) => {
    const o = JSON.parse(s);
    localStorage.clear();
    if (o.prefs) localStorage.setItem('studioUiPrefs', o.prefs);
    if (o.token) localStorage.setItem('studioToken', o.token);
    if (o.user) localStorage.setItem('studioUser', o.user);
    return true;
  }, saved);

  check(consoleErrors.length === 0, 'zero unexpected console errors', JSON.stringify(consoleErrors.slice(0, 4)));
  console.log(`\noriginal theme was: ${before.theme} / gallery-click state restored first`);
  await browser.close();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('trend presets test crashed:', e); process.exit(1); });
