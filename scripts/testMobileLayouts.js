/**
 * Mobile layout sweep: loads every route at phone (390px) and tablet-edge
 * (767px, just below the md: breakpoint) viewports and MEASURES real layout
 * overflow — no guessing from class names:
 *
 *   - page overflow: documentElement.scrollWidth vs viewport
 *   - offenders: visible elements extending past the right/left viewport edge
 *   - wide scroll regions: overflow-x containers whose content exceeds the
 *     viewport (wide tables, kanban boards — scrollable, ranked by severity)
 *
 * Requires the dev stack already running (Vite :5174, API :3000).
 *   node scripts/testMobileLayouts.js            # ranked report
 *   SCORE_ONLY=1 node scripts/testMobileLayouts.js   # exit 1 if any page overflows
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

const ROUTES = [
  '/', '/calendar', '/my-assets', '/my-tickets', '/scan', '/helpdesk',
  '/conversations', '/assets', '/user-assets', '/storage', '/users-admin',
  '/settings', '/kits', '/consumables', '/types', '/activity',
];

const VIEWPORTS = [
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-edge-767', width: 767, height: 1024 },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in-page: finds every visible element poking past the viewport edges
// and every horizontal scroll region wider than the viewport.
const MEASURE = () => {
  const vw = window.innerWidth;
  const out = { vw, pageOverflowX: 0, offenders: [], wideScrollers: [] };
  out.pageOverflowX = Math.max(0, document.documentElement.scrollWidth - vw);

  const desc = (el) => {
    const parts = [];
    let node = el;
    for (let i = 0; node && node !== document.body && i < 4; i++) {
      const tag = node.tagName.toLowerCase();
      const cls = (node.className && node.className.toString
        ? node.className.toString() : '').split(/\s+/).filter(Boolean);
      parts.unshift(cls.length ? `${tag}.${cls[0]}` : tag);
      node = node.parentElement;
    }
    return parts.join(' > ').slice(0, 110);
  };

  const isHiddenSubtree = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.inert) return true;
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return true;
      const c = getComputedStyle(n);
      if (c.display === 'none' || c.visibility === 'hidden'
        || c.pointerEvents === 'none') return true;
    }
    return false;
  };

  // Returns true if el is inside an ancestor that already handles horizontal
  // overflow (overflow-x: auto/scroll).  Elements inside such containers are
  // *intentionally* wider than the viewport — they are scrollable content, not
  // page-level layout bugs.
  const insideScrollContainer = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.overflowX === 'auto' || c.overflowX === 'scroll') return true;
    }
    return false;
  };

  const all = document.querySelectorAll('*');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    // Off-screen BY DESIGN (closed drawer panels etc.) is not a layout bug.
    if (isHiddenSubtree(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 4) continue;

    // Elements poking past the viewport (right edge is the common one)
    // Skip elements inside a scroll container — those are intentional.
    const past = Math.max(r.right - vw, -r.left);
    if (past > 2 && r.width <= vw * 1.05 && !insideScrollContainer(el)) {
      out.offenders.push({
        desc: desc(el), past: Math.round(past),
        right: Math.round(r.right), left: Math.round(r.left),
        w: Math.round(r.width),
      });
    }

    // Horizontal scroll regions whose content is wider than the viewport
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll')
      && el.scrollWidth > vw + 4 && r.width > 40) {
      out.wideScrollers.push({
        desc: desc(el),
        contentW: el.scrollWidth,
        overByPct: Math.round(((el.scrollWidth - vw) / vw) * 100),
      });
    }
  }
  // Worst offenders first, deduped by descriptor
  out.offenders.sort((a, b) => b.past - a.past);
  const seen = new Set();
  out.offenders = out.offenders.filter((o) => {
    const k = `${o.desc}|${o.past}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);
  out.wideScrollers.sort((a, b) => b.contentW - a.contentW);
  const seen2 = new Set();
  out.wideScrollers = out.wideScrollers.filter((o) => {
    if (seen2.has(o.desc)) return false;
    seen2.add(o.desc);
    return true;
  }).slice(0, 5);
  return out;
};

const results = [];

async function sweepPage(page, route, vp) {
  await page.goto(`${APP_URL}${route}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(900); // charts/animations settle
  let m;
  try {
    m = await page.evaluate(`(${MEASURE})()`);
  } catch {
    m = { vw: vp.width, pageOverflowX: -1, offenders: [], wideScrollers: [], error: true };
  }
  const worstPast = m.offenders[0]?.past || 0;
  const score = m.pageOverflowX + worstPast + m.wideScrollers.reduce(
    (s, w) => s + w.overByPct * 2, 0,
  );
  results.push({ route, vp: vp.name, score, ...m });
  return m;
}

function printReport() {
  console.log('\n=== Mobile layout sweep — ranked worst first ===\n');
  const ranked = [...results].sort((a, b) => b.score - a.score);
  for (const r of ranked) {
    if (r.score <= 0) continue;
    console.log(`[${r.score}] ${r.route}  (${r.vp})`
      + `${r.pageOverflowX > 0 ? `  pageOverflowX=+${r.pageOverflowX}px` : ''}`);
    for (const o of r.offenders) {
      console.log(`     ↳ past edge by ${o.past}px: ${o.desc}  [left=${o.left} w=${o.w}]`);
    }
    for (const w of r.wideScrollers) {
      console.log(`     ↳ h-scroll region: content ${w.contentW}px (+${w.overByPct}%): ${w.desc}`);
    }
  }
  const clean = results.filter((r) => r.score <= 0).length;
  console.log(`\n${results.length - clean}/${results.length} page-viewport combos have issues; `
    + `${clean} clean.`);
}

async function main() {
  const { user, token } = await (async () => {
    // The login endpoint is rate-limited; sweep reruns can exhaust the quota,
    // so back off and retry instead of hard-failing (or worse, storing a
    // literal "undefined" token that crashes AuthContext in-page).
    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      if (res.ok) {
        const d = await res.json();
        if (!d.user || !d.token) throw new Error('Login response missing user/token');
        return { user: JSON.stringify(d.user), token: d.token }; // store as JSON strings
      }
      console.log(`login ${res.status} — retry ${attempt}/10 in 20s`);
      await wait(20000);
    }
    throw new Error('Login kept failing (rate limit?)');
  })();

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-first-run'],
  });
  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ ...vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.evaluateOnNewDocument((u, t) => {
        localStorage.setItem('studioUser', u);
        localStorage.setItem('studioToken', t);
      }, user, token);
      await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      for (const route of ROUTES) {
        await sweepPage(page, route, vp);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  printReport();
  if (process.env.SCORE_ONLY) {
    const bad = results.filter((r) => r.score > 0);
    process.exit(bad.length ? 1 : 0);
  }
}

main().catch((e) => { console.error('Sweep failed:', e.message); process.exit(1); });
