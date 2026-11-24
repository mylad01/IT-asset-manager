/**
 * UI Settings suite — PLAN.MD §13 P4 ("registry→UI contract, toggle→CSS-var
 * assertions, persistence across reload, staff-vs-admin section gating, FOUC
 * check, zero console errors").
 *
 * Drives the real Settings panel through puppeteer-core (same pattern as the
 * UI trio: system Chrome/Edge, no browser download):
 *
 *   A. Admin (IT Admin) — every section renders (registry-driven labels);
 *      accessibility toggles drive data-* attrs and persist to the server;
 *      Notifications shows explicit per-user/system scope labels; branding
 *      (root) edits name/logo/defaults and the sidebar wordmark + tab title
 *      follow; Manage import rejects invalid payloads whole and reset
 *      restores registry defaults.
 *   B. Staff — /settings is REACHABLE (P3 route opening) but the panel fails
 *      closed: no Branding section, no system-scope toggles, no backup cards;
 *      per-user prefs (accessibility) still work and persist; the server
 *      rejects staff writes to admin endpoints (403) even if the UI hid.
 *   C. FOUC: data-theme is present on <html> BEFORE any hydration (probe on
 *      the server HTML) — the pre-paint contract holds on the settings page.
 *
 * Read-only on DATA; branding changes (name/defaults) are restored at the
 * end, and the accessibility toggle is reverted — the suite stays
 * side-effect-free overall.
 *
 * Requires the dev stack already running (Vite :5174, API :3000).
 *   node scripts/testUiSettings.js
 *
 * Env: APP_URL, ADMIN_EMAIL, ADMIN_PASSWORD, STAFF_EMAIL, STAFF_PASSWORD,
 *      CHROME_PATH
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const APP_URL = process.env.APP_URL || 'http://localhost:5174';
// Branding is requireRoot on the server (PLAN.MD §13: root scope) — the
// admin leg of this suite logs in as the ROOT account.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@studio.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const STAFF_EMAIL = process.env.STAFF_EMAIL || 'staff1@studio.com';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || '12345678';
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

/** The typed-input helper React needs (native setter + input event). */
const typeInto = (page, selector, text) => page.evaluate((sel, val) => {
  const input = document.querySelector(sel);
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, val);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, selector, text);

/** Login through the real UI; localStorage must be clean first. */
async function loginAs(page, email, password) {
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());      // app origin → allowed
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input', { timeout: 15000 });
  await typeInto(page, 'input', email); // first input = email
  await page.evaluate((val) => {
    const inputs = document.querySelectorAll('input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[1], val);
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  }, password);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Secure Login/i.test(b.textContent))?.click();
  });
  return page.waitForFunction(
    () => document.body.innerText.includes('Secure Logout'),
    { timeout: 15000 },
  ).then(() => true).catch(() => false);
}

/** Authenticated in-page fetch (page context keeps localStorage token). */
const apiGet = (page, url) => page.evaluate(async (u) => {
  try {
    const res = await fetch(u, { headers: { Authorization: `Bearer ${localStorage.getItem('studioToken')}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) { return { status: 0, body: null, error: String(e) }; }
}, url);

const apiPut = (page, url, payload) => page.evaluate(async (u, body) => {
  try {
    const res = await fetch(u, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${localStorage.getItem('studioToken')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) { return { status: 0, body: null, error: String(e) }; }
}, url, payload);

/** Toggle a labelled switch row (button/checkbox inside the row with text). */
const toggleRow = (page, label) => page.evaluate((lbl) => {
  const row = [...document.querySelectorAll('div')]
    .find((d) => d.querySelector('p')?.textContent.includes(lbl) && d.querySelector('input[type="checkbox"]'));
  const box = row?.querySelector('input[type="checkbox"]');
  if (!box) return false;
  box.click();
  return true;
}, label);

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-first-run'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.text())) consoleErrors.push(m.text().slice(0, 150));
  });

  // ── C. FOUC probe: installed before ANY page script; records <html> state
  // at the FIRST documentElement access (server HTML, pre-hydration).
  await page.evaluateOnNewDocument(() => {
    const probe = { preHydration: null };
    let installed = false;
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'documentElement');
    Object.defineProperty(document, 'documentElement', {
      configurable: true,
      get() {
        const real = desc ? desc.get.call(this) : null;
        if (real && !installed) {
          installed = true;
          probe.preHydration = {
            theme: real.getAttribute('data-theme'),
            brightness: real.getAttribute('data-brightness'),
          };
        }
        return real;
      },
    });
    window.__settingsFoucProbe = probe;
  });

  // ══ A. Admin ══════════════════════════════════════════════════════════
  const adminIn = await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  check(adminIn, 'admin login through the UI succeeds');
  if (adminIn) {
    // Route opening + section registry contract (labels render).
    await page.goto(`${APP_URL}/settings`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes('Appearance'), { timeout: 15000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    check(text.includes('Appearance'), 'settings: Appearance section renders');
    for (const label of ['Layout & Density', 'Motion & Effects', 'Tables & Data', 'Notifications', 'Accessibility', 'Branding & Defaults', 'Manage Preferences']) {
      check(text.includes(label), `settings: section "${label}" renders (registry-driven)`);
    }

    // Sidebar exposes Settings for admins too (relocated link).
    const sidebarHasSettings = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      return !!aside && [...aside.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/settings');
    });
    check(sidebarHasSettings, 'sidebar: Settings link present (admin)');

    // Accessibility toggles → data-* attrs → server persistence.
    check(await toggleRow(page, 'Reduced transparency'), 'a11y: Reduced transparency toggle clickable');
    await wait(700);
    const rt = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-reduced-transparency'),
      server: null,
    }));
    check(rt.attr === 'on', 'a11y: data-reduced-transparency=on applied to <html>', JSON.stringify(rt));
    const rtServer = await apiGet(page, '/api/auth/preferences');
    check(rtServer.body?.reducedTransparency === true, 'a11y: toggle persisted to the server blob',
      JSON.stringify(rtServer.body).slice(0, 120));
    // Revert through the UI (suite stays side-effect-free).
    check(await toggleRow(page, 'Reduced transparency'), 'a11y: Reduced transparency reverted');
    await wait(700);
    check(await page.evaluate(() => document.documentElement.getAttribute('data-reduced-transparency')) === 'off',
      'a11y: revert applied on <html>');

    // Notifications scope labels: per user + system badges both visible to admin.
    const notifText = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.glass-card')];
      const card = cards.find((c) => c.innerText.includes('Notifications'));
      return card ? card.innerText : '';
    });
    check(/per user/i.test(notifText) && /system/i.test(notifText),
      'notifications: explicit scope labels (per user + system) for admin', notifText.slice(0, 200));

    // Branding — root: name change propagates to sidebar + tab title.
    const origBrand = await apiGet(page, '/api/settings/branding');
    const originalName = origBrand.body?.brandName || 'Studio IT Sync';
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.glass-card')].find((c) => c.innerText.includes('Branding & Defaults'));
      const input = card?.querySelector('input[type="text"], input:not([type])');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'QA Brand Check');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.glass-card')].find((c) => c.innerText.includes('Branding & Defaults'));
      [...card.querySelectorAll('button')].find((b) => /Save name/i.test(b.textContent))?.click();
    });
    await wait(900);
    const renamed = await apiGet(page, '/api/settings/branding');
    check(renamed.body?.brandName === 'QA Brand Check', 'branding: name persisted via /api/settings/branding',
      JSON.stringify(renamed.body).slice(0, 140));
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes('Appearance'), { timeout: 15000 }).catch(() => {});
    const sidebarName = await page.evaluate(() => document.querySelector('aside')?.innerText || '');
    check(sidebarName.includes('QA Brand Check'), 'branding: sidebar wordmark follows the brand name',
      sidebarName.slice(0, 60));
    const tabTitle = await page.title();
    check(tabTitle === 'QA Brand Check', 'branding: document.title follows the brand name', tabTitle);
    // Restore the original name.
    await apiPut(page, '/api/settings/branding', { brandName: originalName });
    check((await apiGet(page, '/api/settings/branding')).body?.brandName === originalName,
      'branding: original name restored');

    // Branding defaults: set + read back + restore.
    const d1 = await apiPut(page, '/api/settings/branding', { defaultTheme: 'paper' });
    check(d1.status === 200 && d1.body?.defaults?.theme === 'paper', 'branding: defaultTheme=paper stored',
      JSON.stringify(d1.body?.defaults));
    await apiPut(page, '/api/settings/branding', { defaultTheme: 'dark' });
    check((await apiGet(page, '/api/settings/branding')).body?.defaults?.theme === 'dark',
      'branding: defaults restored (theme=dark)');

    // Logo upload validation: a non-image payload must be rejected (400).
    const logoReject = await page.evaluate(async () => {
      const fd = new FormData();
      fd.append('logo', new Blob(['definitely not an image'], { type: 'text/plain' }), 'x.png');
      const res = await fetch('/api/settings/branding/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('studioToken')}` },
        body: fd,
      });
      return res.status;
    });
    check(logoReject === 400, 'branding: logo upload rejects non-image payloads (400)', String(logoReject));

    // Manage: import rejects an invalid payload WHOLE (server schema).
    const badImport = await apiPut(page, '/api/auth/preferences', { theme: 'DROP TABLE users' });
    check(badImport.status === 400, 'manage: invalid import rejected whole (400)', String(badImport.status));
    // Manage: reset writes every registry default back.
    const reset = await apiPut(page, '/api/auth/preferences', {
      theme: 'dark', glass: 'balanced', toastBannersEnabled: true, density: 'comfortable', fontScale: 100,
      motion: 'full', performanceMode: false, pageSize: 50, dateFormat: 'mdy', timeFormat: '12h',
      hideColumnTotals: false, reducedTransparency: false, alwaysFocusRings: false, largerTouchTargets: false,
    });
    check(reset.status === 200 && reset.body?.theme === 'dark', 'manage: reset-to-defaults round-trips',
      JSON.stringify(reset.body).slice(0, 100));
    // The stored blob must hold the full registry key set (export source).
    const blobKeys = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('studioUiPrefs') || '{}')));
    check(['theme', 'glass', 'density', 'motion', 'reducedTransparency', 'largerTouchTargets']
      .every((k) => blobKeys.includes(k)), 'manage: stored blob holds all registry keys (export source)',
      JSON.stringify(blobKeys));
  }

  // ══ B. Staff — route open, content gated, server fails closed ═════════
  const staffIn = await loginAs(page, STAFF_EMAIL, STAFF_PASSWORD);
  check(staffIn, 'staff login through the UI succeeds');
  if (staffIn) {
    await page.goto(`${APP_URL}/settings`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes('Appearance'), { timeout: 15000 }).catch(() => {});
    const staffText = await page.evaluate(() => document.body.innerText);
    check(staffText.includes('Appearance'), 'staff: /settings reachable — Appearance renders (route open)');
    check(staffText.includes('Accessibility'), 'staff: Accessibility section renders (per-user, universal)');
    check(!staffText.includes('Branding & Defaults'), 'staff: Branding section hidden (fail closed)');
    check(!staffText.includes('On-Demand Backup'), 'staff: backup cards hidden');

    const staffSidebar = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      return !!aside && [...aside.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/settings');
    });
    check(staffSidebar, 'sidebar: Settings link present (staff)');

    // Scope labels: staff sees only the per-user toggle row.
    const staffNotif = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.glass-card')].find((c) => c.innerText.includes('Notifications'));
      return card ? card.innerText : '';
    });
    check(/per user/i.test(staffNotif) && !/system/i.test(staffNotif.replace(/per user[^S]*$/i, '')),
      'staff: notifications show "per user" only — system toggles hidden', staffNotif.slice(0, 200));

    // Staff per-user prefs still work end-to-end.
    check(await toggleRow(page, 'Always-visible focus rings'), 'staff: accessibility toggle clickable');
    await wait(700);
    const staffServer = await apiGet(page, '/api/auth/preferences');
    check(staffServer.body?.alwaysFocusRings === true, 'staff: per-user pref persisted (own route works)',
      JSON.stringify(staffServer.body).slice(0, 100));
    check(await toggleRow(page, 'Always-visible focus rings'), 'staff: accessibility toggle reverted');

    // Server fail-closed: admin endpoints reject staff even without UI.
    const brandingPut = await apiPut(page, '/api/settings/branding', { brandName: 'Hacked' });
    check(brandingPut.status === 403 || brandingPut.status === 404, 'server: staff PUT branding rejected',
      String(brandingPut.status));
    const settingsPut = await apiPut(page, '/api/settings', { wsEnabled: false });
    check(settingsPut.status === 403, 'server: staff PUT /api/settings rejected', String(settingsPut.status));
    const brandingGet = await apiGet(page, '/api/settings/branding');
    check(brandingGet.status === 403 || brandingGet.status === 404, 'server: staff GET branding rejected',
      String(brandingGet.status));
  }

  // ══ C. FOUC assertion (captured during the LAST navigation above) ═════
  const fouc = await page.evaluate(() => window.__settingsFoucProbe || null);
  check(!!fouc && fouc.preHydration?.theme === 'dark' && fouc.preHydration?.brightness === 'dark',
    'fouc: data-theme present pre-hydration (server HTML carries the attrs)',
    JSON.stringify(fouc?.preHydration));

  // Console hygiene — same documented discount classes as testUiJourney:
  //   503 — DiskStatusBanner's health poll during backend restarts.
  //   400/403 — this suite's own deliberate negative probes (logo reject,
  //         invalid import, staff poking admin endpoints); they MUST stay
  //         in the responses, but Chrome mirrors them as resource noise.
  // Rate-limit noise would still surface; real JS errors log differently.
  const realConsole = consoleErrors.filter((c) => {
    if (/429/.test(c)) return true;
    if (/Failed to load resource.*503/.test(c)) return false;
    if (/Failed to load resource.*(400|403)/.test(c)) return false;
    return true;
  });
  check(realConsole.length === 0, 'zero console errors across the settings journeys',
    JSON.stringify(realConsole.slice(0, 3)));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('SUITE ERROR:', err.message);
  process.exit(1);
});
