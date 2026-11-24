/**
 * DataTable first-load regression test — the gate for the 2026-10-12
 * stale-memo bug, where User & Access Management showed "No records
 * available." until a new user was added.
 *
 * Root cause being guarded: DataTable's filteredData useMemo read rows from a
 * ref that was NOT in its dependency array, so the memo cached the table's
 * first (always empty) render and never recomputed when data arrived. Adding
 * a user happened to unmount/remount the table, which is why the workaround
 * "worked".
 *
 * Why the delay matters: the bug only shows when the table mounts BEFORE its
 * data lands. On a fast localhost that race usually loses, so a naive test
 * would pass even with the bug reintroduced. This suite intercepts every
 * /api/ GET and holds it for DELAY_MS before passing it through to the real
 * server (no synthetic bodies — auth, CORS and data stay real), making the
 * mount-empty-then-data-arrives condition deterministic on every page.
 *
 * Covered pages (every DataTable-backed route) and their assertion mode:
 *   - /users-admin   strict: rendered rows === GET /api/users length
 *   - /assets        strict: rendered rows === GET /api/assets length
 *   - /storage       strict: rendered rows === GET /api/assets/unassigned length
 *   - /user-assets   strict against the SELECTED user's assets (picks the
 *                    first user who actually has assigned hardware)
 *   - /my-assets     invariant: rows > 0 whenever the user's assets are
 *                    non-empty; empty state expected when they are not
 *   - /helpdesk      invariant (admin may own zero tickets)
 *   - /my-tickets    invariant (same)
 * A legitimately empty dataset is reported as SKIP, not PASS — you cannot
 * render rows that do not exist. The DataTable empty row ("No records
 * available.") is detected explicitly so it never counts as a data row.
 *
 * Read-only on DATA: no seeding, no writes (tickets have no DELETE route, so
 * a seeded ticket would leave permanent residue in the dev database).
 *
 * Phase 2 (asymmetric delay): users-admin fires /api/users + /api/departments
 * through ONE useApi instance inside Promise.all. The old per-call isLoading
 * boolean let the first response flip loading off while its sibling was still
 * in flight — mounting DataTable with users=[] (the mount-with-empty-data
 * race, the sibling of the stale-memo bug above). Holding /api/users far
 * longer than its siblings makes that window deterministic: the skeleton must
 * stay up until EVERY parallel response lands.
 *
 * Requires the dev stack running (Vite :5174, API :3000).
 *   node scripts/testDataTableFirstLoad.js
 *
 * Env: APP_URL, API_URL, CHROME_PATH, TEST_EMAIL, TEST_PASSWORD, TABLE_DELAY_MS,
 *      TABLE_PHASE=parallel (run ONLY phase 2 — the useApi race check)
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const APP_URL = process.env.APP_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@studio.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin';
const DELAY_MS = Number(process.env.TABLE_DELAY_MS) > 0 ? Number(process.env.TABLE_DELAY_MS) : 600;
// TABLE_PHASE=parallel: skip the per-page sweep and run only the phase-2
// useApi race check (fast iteration when working on the loading gate).
const ONLY_PHASE_2 = process.env.TABLE_PHASE === 'parallel';
// Pages with a proper loading gate mount their table WITH data; pages with a
// shared isLoading flag (users-admin, assets) mount it empty for a beat first.
// Give the table this long to settle into real rows before judging it — well
// past DELAY_MS, but the buggy memo NEVER renders rows, so it still fails.
const SETTLE_MS = DELAY_MS * 2 + 2000;
// Phase 2 (parallel-fetch race): the SLOW sibling of users-admin's
// Promise.all pair vs. everything else. Gap must be wide enough to sample the
// danger window with margin on both sides (see runParallelRace).
const ASYM_SLOW_MS = 2200; // /api/users hold
const ASYM_FAST_MS = 300;  // its siblings (/api/departments, shell GETs)
// The API's read limiter is 60 req/60s (server/middleware/rateLimiters.js) and
// the app shell itself fires /api/notifications on every page mount, so the
// suite paces itself between pages and backs off once if a probe is limited.
const INTER_PAGE_MS = 1200;

const TABLE_TIMEOUT_MS = 10_000; // generous for localhost; caps the table-less pages
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && fs.existsSync(p));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll a (sync) predicate until true or timeout. */
const waitFor = async (fn, timeout) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (fn()) return true; await wait(80); }
  return fn();
};

/** Gate for the delay-only interception (module scope: the request listener
 *  and runPage both drive it). */
let delayApi = false;
/** Phase 2 state: asymmetric per-URL delays + timestamp of the slow hold. */
let asym = false;
let slowHoldStart = 0;

let passed = 0, failed = 0, skipped = 0;
const check = (ok, name, note = '') => {
  if (ok) { console.log(`PASS - ${name}`); passed++; }
  else { console.log(`FAIL - ${name}${note ? ` :: ${note}` : ''}`); failed++; }
};
const skip = (name, why) => { console.log(`SKIP - ${name} :: ${why}`); skipped++; };

/** Every DataTable-backed page. `mode: 'exact'` compares the rendered row
 *  count to the backing endpoint's length; 'invariant' only asserts rows
 *  appear when data exists (the page may legitimately have none). */
const PAGES = [
  { path: '/users-admin', backing: '/api/users', mode: 'exact' },
  { path: '/assets', backing: '/api/assets', mode: 'exact' },
  { path: '/storage', backing: '/api/assets/unassigned', mode: 'exact' },
  { path: '/user-assets', backing: '/api/users/{selected}/assets', mode: 'exact', selectUser: true },
  { path: '/my-assets', backing: '/api/users/{me}/assets', mode: 'invariant' },
  { path: '/helpdesk', backing: '/api/tickets', mode: 'invariant' },
  { path: '/my-tickets', backing: '/api/tickets/my-tickets', mode: 'invariant' },
];

async function main() {
  // Fail fast with a useful message instead of a 20s puppeteer timeout.
  for (const [label, url] of [['Vite', APP_URL], ['API', API_URL]]) {
    const up = await fetch(url, { signal: AbortSignal.timeout(3000) }).then(() => true).catch(() => false);
    if (!up) { console.error(`Dev stack is not running: ${label} at ${url} is unreachable.`); console.error('Start it first (npm start + npm run dev), then re-run.'); process.exit(2); }
  }
  if (!CHROME) { console.error('No Chrome/Edge found — set CHROME_PATH.'); process.exit(2); }

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-first-run'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    // 429s are environmental (the dev server's rate limiter, possibly tripped
    // by OTHER traffic on the shared stack) — the row assertions still fail
    // loudly if limiting hurt a page, so filtering them here is safe.
    if (m.type() === 'error' && !/favicon/.test(m.text()) && !/status of 429/.test(m.text())) consoleErrors.push(m.text().slice(0, 150));
  });

  // Delay-only passthrough for /api/ GETs while a page under test loads.
  // Real server answers — we only hold the response back so the table always
  // mounts first (the exact condition that hid the stale-memo bug).
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      if (delayApi && req.method() === 'GET' && req.url().includes('/api/')) {
        if (asym) {
          if (new URL(req.url()).pathname === '/api/users') {
            slowHoldStart = Date.now(); // stamped for runParallelRace's sampling window
            await wait(ASYM_SLOW_MS);
          } else {
            await wait(ASYM_FAST_MS);
          }
        } else {
          await wait(DELAY_MS);
        }
      }
      await req.continue();
    } catch { /* navigation already swapped the request out */ }
  });

  // Login through the real UI form (house pattern: native setter + input event).
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
  }, TEST_EMAIL, TEST_PASSWORD);
  await wait(2500);

  if (!ONLY_PHASE_2) {
    for (const def of PAGES) { await runPage(page, def); await wait(INTER_PAGE_MS); }
  }

  await runParallelRace(page);
  await wait(INTER_PAGE_MS);

  check(consoleErrors.length === 0, 'zero console errors', consoleErrors.join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed ? 1 : 0);
}

/** Navigate fresh (page.goto, never a client-side link — the bug is a
 *  mount-time cache, so a remount via SPA nav could mask it), read the table
 *  the moment it exists, then compare against the backing API. */
async function runPage(page, def) {
  delayApi = true;
  let selectedId = null;

  await page.goto(`${APP_URL}${def.path}`, { waitUntil: 'domcontentloaded' });

  if (def.selectUser) {
    // Roster mounts from /api/users (delayed). Pick a user who actually has
    // assets so the strict comparison is meaningful, then select them.
    await page.waitForFunction(() => document.querySelectorAll('main button').length > 3, { timeout: TABLE_TIMEOUT_MS }).catch(() => {});
    delayApi = false;
    selectedId = await page.evaluate(async () => {
      const api = (await import('/src/utils/apiClient.js')).default;
      const u = await api.get('/api/users', { showToast: false });
      if (!u.ok || !Array.isArray(u.data)) return null;
      for (const user of u.data.slice(0, 5)) {
        const r = await api.get(`/api/users/${user.id}/assets`, { showToast: false });
        if (r.ok && Array.isArray(r.data) && r.data.length > 0) return { id: user.id, name: user.name, count: r.data.length };
      }
      return null;
    });
    if (!selectedId) { delayApi = false; skip(`${def.path} first-load rows`, 'no user has assigned assets'); return; }
    delayApi = true; // the selection's asset fetch must be delayed too
    await page.evaluate((name) => {
      const btn = [...document.querySelectorAll('main button')].find((b) => b.textContent.includes(name));
      btn?.click();
    }, selectedId.name);
  }

  const tableUp = await page
    .waitForFunction(() => !!document.querySelector('main table.glass-table'), { timeout: TABLE_TIMEOUT_MS })
    .then(() => true).catch(() => false);

  if (tableUp) {
    await page.waitForFunction(() => {
      const t = document.querySelector('main table.glass-table');
      if (!t) return false;
      const rows = [...t.querySelectorAll('tbody tr')];
      return !(rows.length === 1 && /No records available\./.test(rows[0].innerText));
    }, { timeout: SETTLE_MS, polling: 150 }).catch(() => {}); // settle; judged below
  }

  const state = tableUp
    ? await page.evaluate(() => {
        const rows = [...document.querySelectorAll('main table.glass-table tbody tr')];
        const empty = rows.length === 1 && /No records available\./.test(rows[0].innerText);
        return { rows: empty ? 0 : rows.length, empty };
      })
    : { rows: -1, empty: false };

  delayApi = false;

  const backing = await probeBacking(page, def, selectedId);

  if (backing < 0) {
    check(false, `${def.path} backing API reachable`, `${def.backing} did not answer ok`);
    return;
  }

  if (backing === 0) {
    // Empty dataset: no rows is CORRECT — assert the empty state and move on.
    if (!tableUp) skip(`${def.path} first-load rows`, 'backing data empty and page renders its own empty state');
    else check(state.empty, `${def.path} empty state while backing data is empty`, `table showed ${state.rows} rows`);
    return;
  }

  if (def.mode === 'exact') {
    check(state.rows === backing, `${def.path} renders all ${backing} rows on first load`, `table showed ${state.rows}`);
  } else {
    check(state.rows > 0 && !state.empty, `${def.path} renders rows on first load`, `backing had ${backing}, table showed ${state.rows}`);
  }
}

/**
 * Phase 2 — the useApi parallel-fetch gate.
 *
 * users-admin fires /api/users + /api/departments through ONE useApi
 * instance inside Promise.all. The ref-counted isLoading must hold the
 * skeleton until BOTH settle; the old per-call boolean mounted the table
 * empty as soon as the fast sibling landed.
 */
async function runParallelRace(page) {
  asym = true; slowHoldStart = 0; delayApi = true;
  await page.goto(`${APP_URL}/users-admin`, { waitUntil: 'domcontentloaded' });

  // Wait for React to fire the slow request (the interceptor stamps it).
  const held = await waitFor(() => slowHoldStart > 0, TABLE_TIMEOUT_MS);
  if (!held) {
    delayApi = false; asym = false;
    check(false, 'users-admin fires its parallel /api/users fetch', 'interceptor never saw the slow request');
    return;
  }

  // Sample the danger window: fast siblings landed and rendered (FAST +
  // margin), slow sibling still held (before SLOW - margin). Under the old
  // boolean flag the table mounts ~FAST_MS in; under the ref-count it must
  // not exist, with the skeleton still up, until the slow sibling lands.
  let earlyMount = false, skeletonSeen = false;
  const from = slowHoldStart + ASYM_FAST_MS + 800;
  const to = slowHoldStart + ASYM_SLOW_MS - 300;
  while (Date.now() < to && !earlyMount) {
    if (Date.now() >= from) {
      const state = await page.evaluate(() => ({
        table: !!document.querySelector('main table.glass-table'),
        skeleton: !!document.querySelector('main .animate-pulse'),
      }));
      if (state.table) earlyMount = true;
      if (state.skeleton) skeletonSeen = true;
      if (!earlyMount) await wait(120);
    } else {
      await wait(60);
    }
  }
  check(!earlyMount,
    'users-admin keeps its loading gate up until EVERY parallel response lands',
    earlyMount ? 'DataTable mounted while /api/users was still in flight' : '');
  check(skeletonSeen,
    'users-admin still shows its skeleton during the parallel window',
    'skeleton never visible — page may not have rendered');

  // Stop delaying new requests; the already-held one completes on its own.
  delayApi = false; asym = false;

  const tableUp = await page
    .waitForFunction(() => !!document.querySelector('main table.glass-table'), { timeout: TABLE_TIMEOUT_MS })
    .then(() => true).catch(() => false);
  if (tableUp) {
    await page.waitForFunction(() => {
      const t = document.querySelector('main table.glass-table');
      if (!t) return false;
      const rows = [...t.querySelectorAll('tbody tr')];
      return !(rows.length === 1 && /No records available\./.test(rows[0].innerText));
    }, { timeout: SETTLE_MS, polling: 150 }).catch(() => {});
  }
  const state = tableUp
    ? await page.evaluate(() => {
        const rows = [...document.querySelectorAll('main table.glass-table tbody tr')];
        const empty = rows.length === 1 && /No records available\./.test(rows[0].innerText);
        return { rows: empty ? 0 : rows.length, empty };
      })
    : { rows: -1, empty: false };

  const backing = await probeBacking(page, { backing: '/api/users', mode: 'exact' }, null);
  if (backing < 0) check(false, 'users-admin roster backing API reachable', 'GET /api/users did not answer ok');
  else if (backing === 0) skip('users-admin parallel settle rows', 'backing roster empty');
  else check(state.rows === backing, `users-admin renders all ${backing} rows after the parallel fetch settles`, `table showed ${state.rows}`);
}

/** Ask the app's OWN apiClient (in-page, so auth and base URL are real) how
 *  many rows the page's backing endpoint currently holds. */
async function probeBacking(page, def, selected) {
  const path = def.backing.replace('{selected}', selected ? String(selected.id) : '').replace('{me}', 'me');
  const call = () => page.evaluate(async (p, isMe) => {
    const api = (await import('/src/utils/apiClient.js')).default;
    let target = p;
    if (isMe) {
      const store = await import('/src/utils/appStorage.js');
      const me = store.getStoredUser();
      if (!me?.id) return { ok: false, status: 0, n: -1 };
      target = `/api/users/${me.id}/assets`;
    }
    const r = await api.get(target, { showToast: false });
    if (!r.ok) return { ok: false, status: r.status ?? 0, retryAfter: r.retryAfter ?? 0, n: -1 };
    let n = 0;
    if (Array.isArray(r.data)) n = r.data.length;
    else if (r.data && typeof r.data.count === 'number') n = r.data.count;
    return { ok: true, status: r.status ?? 200, n };
  }, path, def.backing.includes('{me}'));

  let res = await call();
  if (!res.ok && res.status === 429) {
    // Honor the server's own Retry-After (draft-7 RateLimit-Reset) — the read
    // limiter is 60/60s but the GLOBAL limiter is 300/15min, and only the
    // header distinguishes them. One bounded wait, then one retry.
    const waitSec = Math.min(Math.max(res.retryAfter || 60, 30), 900);
    console.log(`      (rate limited — honoring Retry-After, waiting ${waitSec}s)`);
    await wait(waitSec * 1000);
    res = await call();
  }
  return res.ok ? res.n : -1;
}

main().catch((e) => { console.error('DataTable first-load test failed:', e.message); process.exit(1); });
