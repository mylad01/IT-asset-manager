#!/usr/bin/env node

/**
 * UI Smoke Test — drives the real frontend (Vite dev on :5174) against the
 * real API (:3000) using the installed Chrome via puppeteer-core.
 * Captures screenshots, records console/page errors, and verifies both the
 * admin and staff experiences of the notification/backup/setup feature.
 *
 * Usage: node scripts/uiSmoke.mjs
 * Env:   UI_BASE (default http://localhost:5174)
 *        SHOT_DIR (default %TEMP%\opencode\ui-test)
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const UI_BASE = process.env.UI_BASE || 'http://localhost:5174';
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), 'opencode', 'ui-test', 'shots');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const ADMIN = { email: 'admin@studio.com', password: 'admin' };
const STAFF = { email: 'staff1@studio.com', password: '12345678' };

let passed = 0;
let failed = 0;
let ok = false;
const problems = [];

fs.rmSync(SHOT_DIR, { recursive: true, force: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const check = (name, ok, note = '') => {
  if (ok) { console.log(`PASS - ${name}`); passed++; }
  else { console.log(`FAIL - ${name}${note ? ` :: ${note}` : ''}`); failed++; problems.push(`${name} :: ${note}`); }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('requestfailed', (req) => {
  if (req.url().includes('localhost:3000')) consoleErrors.push(`REQFAIL ${req.url()} ${req.failure()?.errorText}`);
});

await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');

const shot = async (name) => page.screenshot({ path: path.join(SHOT_DIR, name) });
const waitFor = (sel, timeout = 10000) => page.waitForSelector(sel, { timeout });
const bodyText = () => page.evaluate(() => document.body.innerText);

const login = async ({ email, password }) => {
  const attempt = async () => {
    await page.goto(`${UI_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await waitFor('input[type="text"]');
    await delay(400);
    await page.evaluate(({ email, password }) => {
      localStorage.removeItem('studioToken');
      const setVal = (sel, v) => {
        const el = document.querySelector(sel);
        if (!el) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setVal('input[type="text"]', email);
      setVal('input[type="password"]', password);
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Secure Login');
      if (btn) btn.click();
    }, { email, password });
    await delay(1800);
  };
  await attempt();
  const authed = await page.evaluate(() => !window.location.pathname.startsWith('/login'));
  if (!authed) {
    console.log('   [warn] login attempt did not leave /login, retrying once');
    await attempt();
  }
  await delay(1000);
};

// ---------- 1. Login page without session ----------
await page.goto(`${UI_BASE}/`, { waitUntil: 'domcontentloaded' });
await delay(1500);
const loginTitle = await bodyText();
check('guest is redirected to login screen', /Studio IT Sync/.test(loginTitle) && /Secure Login/.test(loginTitle));
await shot('01-login.png');

// ---------- 2. Admin login ----------
await login(ADMIN);
let body = await bodyText();
check('admin logs in to dashboard', /Dashboard/.test(body) && /Activity Log/.test(body), body.slice(0, 120));
await shot('02-admin-dashboard.png');

const adminNav = ['IT Helpdesk', 'All Hardware', 'Personnel Resources', 'Storage Room', 'User Access', 'Settings', 'Asset Kits', 'Consumables', 'Global Asset Types', 'Activity Log', 'Scan Station'];
const missingNav = adminNav.filter((label) => !body.includes(label));
check(`admin sidebar shows all ${adminNav.length} nav items`, missingNav.length === 0, `missing: ${missingNav.join(', ')}`);

// ---------- 3. Admin pages render without crashing ----------
const adminRoutes = [
  ['/dashboard', 'admin-dashboard', 'Dashboard'],
  ['/helpdesk', 'helpdesk', 'IT Helpdesk'],
  ['/assets', 'assets', 'All Hardware'],
  ['/user-assets', 'user-assets', 'Personnel Resources'],
  ['/storage', 'storage', 'Storage Room'],
  ['/users-admin', 'users-admin', 'User Access'],
  ['/kits', 'kits', 'Asset Kits'],
  ['/consumables', 'consumables', 'Consumables'],
  ['/types', 'types', 'Global Asset Types'],
  ['/activity', 'activity', 'Activity Log'],
  ['/scan', 'scan', 'Scan Station'],
];
for (const [route, name, needle] of adminRoutes) {
  await page.goto(`${UI_BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await delay(1200);
  const t = await bodyText();
  ok = !/Application Error/.test(t) && !t.includes('Something went wrong') && t.includes(needle);
  check(`admin route /${route} renders (${needle})`, ok, t.slice(0, 90));
  await shot(`03-admin-${name}.png`);
}

// ---------- 4. Notification bell (admin) ----------
await page.goto(`${UI_BASE}/settings`, { waitUntil: 'domcontentloaded' });
await delay(1000);
const bellBtn = await page.$('button[aria-label^="Notifications"]');
check('notification bell visible in sidebar', !!bellBtn);
if (bellBtn) {
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label^="Notifications"]');
    if (b) b.click();
  });
  await delay(1200);
  await shot('04-bell-open.png');
  const bellText = await bodyText();
  check('bell panel opens with notifications or empty state', /Notifications/.test(bellText) && (/You're all caught up|Mark all read/.test(bellText)));
}

// ---------- 5. Settings page (admin): backup + prefs UI ----------
await page.goto(`${UI_BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await delay(1500);
  const settingsText = await bodyText();
  check('Settings shows On-Demand Backup + Notification Preferences',
    /On-Demand Backup/.test(settingsText) && /Notification Preferences/.test(settingsText) && /Root Admin Only/.test(settingsText));
  await shot('05-settings-top.png');

  // Toggle the two notification toggles and expect persistence confirmations
  let toggleCount = 0;
  for (let i = 0; i < 2; i++) {
    await page.evaluate((idx) => {
      const inputs = document.querySelectorAll('input[type="checkbox"]');
      if (inputs[idx]) inputs[idx].click();
    }, i);
    await delay(1200);
    const afterText = await bodyText();
    if (/Settings saved/.test(afterText)) toggleCount++;
  }
  check('notification toggles persist via Settings saved confirmation', toggleCount === 2, `saved ${toggleCount}/2`);

  // Set a backup path and run a real backup from the UI
  const backupDir = path.join(SHOT_DIR, 'backups');
  await page.evaluate((val) => {
    const input = [...document.querySelectorAll('input')].find((i) => i.type === 'text');
    if (!input) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, backupDir);
  await delay(700);
  let saveOk = false;
  for (let attempt = 0; attempt < 6 && !saveOk; attempt++) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Save Path'));
      if (btn) btn.click();
    });
    await delay(1200);
    saveOk = /Settings saved/.test(await bodyText());
  }
  check('backup path saved from UI', saveOk);

  const backupNow = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Start Backup'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!backupNow) check('on-demand backup runs from Settings UI', false, 'Start Backup button not found');
  let backupDone = false;
  for (let attempt = 0; attempt < 10 && !backupDone; attempt++) {
    await delay(1000);
    const txt = await bodyText();
    backupDone = /Backup completed: itame-backup-/.test(txt) || (/Backup History/.test(txt) && /itame-backup-/.test(txt) && !/No backups yet/.test(txt));
  }
  const afterBackup = await bodyText();
  check('on-demand backup runs + records in history UI', /itame-backup-/.test(afterBackup), afterBackup.slice(0, 200));
  await shot('06-backup-complete.png');

  await delay(1500);
  const historyText = await bodyText();
  check('backup history list updated in UI', /Backup History/.test(historyText) && /itame-backup-/.test(historyText));

// ---------- 6. Bell shows generated backup + ticket notifications after admin sessions ----------
await page.evaluate(() => {
  document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Secure Logout') b.click(); });
});
await delay(1200);

// ---------- 7. Staff login (role-scoped nav) ----------
await login(STAFF);
body = await bodyText();
const staffChecks = ['My Assigned Gear', 'Support Tickets'];
check('staff logs in with staff nav', staffChecks.every((s) => body.includes(s)));
check('staff nav hides admin-only items',
  !['IT Helpdesk', 'All Hardware', 'Settings', 'Scan Station', 'Consumables'].some((s) => body.includes(s)));
await shot('07-staff-dashboard.png');

const staffRoutes = [['/my-assets', 'staff-my-assets', 'My Assigned Gear'], ['/my-tickets', 'staff-my-tickets', 'Support Tickets']];
for (const [route, name, needle] of staffRoutes) {
  await page.goto(`${UI_BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await delay(1200);
  const t = await bodyText();
  ok = !/Application Error/.test(t) && !t.includes('Something went wrong') && t.includes(needle);
  check(`staff route /${route} renders (${needle})`, ok, t.slice(0, 90));
  await shot(`08-${name}.png`);
}

// ---------- 8. Staff creates a ticket via the UI ----------
await page.goto(`${UI_BASE}/my-tickets`, { waitUntil: 'domcontentloaded' });
await delay(1000);
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('New Ticket'))?.click();
});
await waitFor('.glass-modal').catch(() => {});
await delay(800);
const modalText = await bodyText();
check('create-ticket modal opens', /Submit IT Support Ticket/.test(modalText));

await page.evaluate(() => {
  const modal = document.querySelector('.glass-modal');
  if (!modal) return false;
  const setVal = (el, v) => {
    if (!el) return;
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (el.tagName === 'SELECT') el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const titleInput = modal.querySelector('input[type="text"]');
  setVal(titleInput, `UI Smoke Ticket ${Date.now()}`);
  const selects = [...modal.querySelectorAll('select')];
  const assign = selects.find((s) => [...s.options].some((o) => o.text.includes('Select IT Admin')));
  if (assign) {
    const val = [...assign.options].find((o) => o.value !== '')?.value;
    if (val) setVal(assign, val);
  }
  setVal(modal.querySelector('textarea'), 'Created by the headless UI smoke test run.');
  return true;
});
await delay(400);
await page.evaluate(() => {
  [...document.querySelectorAll('.glass-modal button')].find((b) => b.textContent.includes('Submit Ticket'))?.click();
});
await delay(2000);
const afterTicket = await bodyText();
const modalGone = !await page.$('.glass-modal').catch(() => null);
check('staff ticket submitted from UI (modal closes)', modalGone && !/Submit IT Support Ticket/.test(afterTicket));
await shot('09-after-ticket.png');

// ---------- 9. Staff bell (may be empty / caught up) ----------
const staffBell = await page.$('button[aria-label^="Notifications"]');
if (staffBell) {
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label^="Notifications"]');
    if (b) b.click();
  });
  await delay(1200);
  const b = await bodyText();
  // Panel opens if it shows the header + (empty state OR a populated list with actions)
  check('staff notification bell opens', /Notifications/.test(b) && (/caught up|Mark all read|new|Mark all read/.test(b)));
  await shot('10-staff-bell.png');
}

// ---------- 10. Re-login admin + bell updated with ticket:assigned ----------
await page.evaluate(() => {
  document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Secure Logout') b.click(); });
});
await delay(1000);
await page.evaluate(() => localStorage.clear());
await login(ADMIN);
let adminBellOk = false;
for (let attempt = 0; attempt < 6 && !adminBellOk; attempt++) {
  await delay(800);
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label^="Notifications"]');
    if (b) b.click();
  });
  await delay(700);
  const adminBell = await bodyText();
  adminBellOk = /Notifications/.test(adminBell) && /Mark all read/.test(adminBell) && /UI Smoke Ticket/.test(adminBell);
  if (!adminBellOk) {
    await page.evaluate(() => {
      const b = document.querySelector('button[aria-label^="Notifications"]');
      if (b) b.click();
    });
  }
}
await delay(400);
const adminBellFinal = await bodyText();
check('admin bell shows new ticket notification after staff submission', /Mark all read/.test(adminBellFinal) && /UI Smoke Ticket/.test(adminBellFinal), adminBellFinal.slice(0, 160));
await shot('11-admin-bell-after-ticket.png');

await browser.close();

// ---------- Summary ----------
const realErrors = [...new Set(consoleErrors.filter((e) => !/favicon/.test(e)))];
console.log(`\nConsole errors (${realErrors.length}):`);
realErrors.slice(0, 20).forEach((e) => console.log(`  - ${e.slice(0, 300)}`));
pageErrors.slice(0, 10).forEach((e) => console.log(`  PAGEERROR: ${e.slice(0, 300)}`));
console.log(`\nScreenshots: ${SHOT_DIR}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed || realErrors.length ? 1 : 0);