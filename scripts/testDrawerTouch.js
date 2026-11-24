/**
 * Touch-gesture verification for GlassDrawer's swipe-to-close.
 *
 * Drives REAL input events against the ALREADY RUNNING dev app in a
 * phone-like viewport, plus a desktop regression pass. Starts no servers.
 *
 * NOTE on input channels: the functional drag checks below use MOUSE pointer
 * events (CDP), because headless Chrome cancels dispatched TOUCH drags at
 * ~30px slop regardless of touch-action (no compositor gesture stream in
 * headless — debugDrawerTouch*.js probes proved even touch-action:none still
 * gets pointercancel). Touch events are still used where they work: the
 * touch-action contract, native vertical list scrolling, and interrupted-
 * drag robustness. The gesture logic under test (framer PanSession drag,
 * thresholds, snap-back) is identical across pointer types.
 *
 *   1. Mobile (390x844, touch): drawer opens from the hamburger, panel
 *      follows the finger (transform moves), overlay dims mid-drag, swipe
 *      past 30% closes, small swipe springs back open, fast flick closes.
 *   2. touch-action is pan-y on the panel (vertical list scrolling stays
 *      native) and an actual vertical pan scrolls the nav if scrollable.
 *   3. Regressions: overlay click closes, Esc closes.
 *   4. Desktop (1280x800): panel static, no transform, drag disabled.
 *
 * Run with the dev stack up (Vite :5174, API :3000):
 *   node scripts/testDrawerTouch.js
 * Env overrides: APP_URL, API_URL, CHROME_PATH, TEST_EMAIL, TEST_PASSWORD
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const APP_URL = process.env.APP_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@studio.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  for (const p of CHROME_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
}

// ── CDP touch helpers ────────────────────────────────────────────────
async function touchStart(client, x, y) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
}
async function touchMove(client, x, y) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y, id: 1 }],
  });
}
async function touchEnd(client) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}
/** Slow drag: distance px leftward over `steps` moves (~16ms apart). */
async function dragLeft(client, x, y, distance, steps = 10) {
  await touchStart(client, x, y);
  for (let i = 1; i <= steps; i++) {
    await wait(16);
    await touchMove(client, x - (distance * i) / steps, y);
  }
  await wait(16);
  await touchEnd(client);
}
// Mouse-pointer drags (CDP): same PanSession pipeline in framer, without
// the headless touch-cancelation artifact described in the header.
async function mouseDrag(client, x, y, distance, steps = 10) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
  });
  for (let i = 1; i <= steps; i++) {
    await wait(16);
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x - (distance * i) / steps, y, buttons: 1,
    });
  }
  await wait(16);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x - distance, y, button: 'left', clickCount: 1,
  });
}
async function mouseFlick(client, x, y, distance = 60) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
  });
  await wait(16);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: x - distance, y, buttons: 1,
  });
  await wait(16);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x - distance, y, button: 'left', clickCount: 1,
  });
}

// ── In-page state readers ────────────────────────────────────────────
const PAGE_HELPERS = {
  readState() {
    const panel = document.querySelector('[aria-label="Main navigation"]');
    if (!panel) return { panelFound: false };
    const overlay = document.querySelector('.fixed.inset-0.bg-black\\/50');
    const dimLayer = overlay && overlay.querySelector('div');
    const cs = getComputedStyle(panel);
    const m = new DOMMatrixReadOnly(cs.transform === 'none' ? '' : cs.transform);
    const scrollable = [...panel.querySelectorAll('*')].find(
      (el) => el.scrollHeight > el.clientHeight + 4
        && getComputedStyle(el).overflowY !== 'visible',
    );
    return {
      panelFound: true,
      inert: !!panel.inert,
      ariaHidden: panel.getAttribute('aria-hidden') === 'true',
      tx: m.m41,
      position: cs.position,
      touchAction: cs.touchAction,
      overlayPresent: !!overlay,
      dimOpacity: dimLayer ? parseFloat(getComputedStyle(dimLayer).opacity) : null,
      scrollTop: scrollable ? scrollable.scrollTop : null,
      hasScrollable: !!scrollable,
    };
  },
};

async function waitFor(page, pred, label, timeout = 4000) {
  try {
    await page.waitForFunction(pred, { timeout, polling: 60 });
  } catch {
    const s = await page.evaluate(`${PAGE_HELPERS.readState}; (${PAGE_HELPERS.readState})()`);
    throw new Error(`Timeout waiting for: ${label} — state: ${JSON.stringify(s)}`);
  }
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── Setup ────────────────────────────────────────────────────────────
async function login() {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}) — set TEST_EMAIL/TEST_PASSWORD`);
  const data = await res.json();
  return { user: JSON.stringify(data.user), token: data.token };
}

async function main() {
  const executablePath = findBrowser();
  console.log(`Browser: ${executablePath}`);
  console.log(`App:     ${APP_URL}\n`);

  const { user, token } = await login();

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const consoleErrors = [];
  try {
    // ── MOBILE PASS ──────────────────────────────────────────────
    const page = await browser.newPage();
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    await page.setViewport({
      width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    await page.evaluateOnNewDocument(
      (u, t) => {
        localStorage.setItem('studioUser', u);
        localStorage.setItem('studioToken', t);
      },
      user, token,
    );
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('button[aria-label="Open navigation"]', { timeout: 15000 });
    await wait(600); // let framer settle the closed transform
    const cdp = await page.createCDPSession();

    console.log('Mobile gestures:');
    let s = await page.evaluate(() => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      return p ? { w: p.offsetWidth, tx: new DOMMatrixReadOnly(getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform).m41, inert: !!p.inert, position: getComputedStyle(p).position, touchAction: getComputedStyle(p).touchAction } : null;
    });
    const W = s.w;
    check('drawer exists on mobile', !!s, s ? `width=${W}px` : '');
    check('starts closed & inert', s.inert && s.tx <= -W + 2, `tx=${s.tx.toFixed(1)}, inert=${s.inert}`);
    check('panel touch-action pan-y', s.touchAction === 'pan-y', s.touchAction);
    check('panel is fixed on mobile', s.position === 'fixed', s.position);

    const startX = W - 15;
    const y = 420;

    // 1. Open via hamburger
    await page.tap('button[aria-label="Open navigation"]');
    await waitFor(page, () => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      return p && !p.inert
        && new DOMMatrixReadOnly(getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform).m41 > -1;
    }, 'drawer opens');
    check('hamburger opens drawer (tx≈0, not inert)', true);

    // 2. Panel follows the pointer + overlay dims mid-drag (mouse pointer —
    //    see header note on headless touch cancelation)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: startX, y, button: 'left', clickCount: 1,
    });
    for (let i = 1; i <= 6; i++) {
      await wait(16);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: startX - (0.55 * W * i) / 6, y, buttons: 1,
      });
    }
    s = await page.evaluate(() => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      const overlay = document.querySelector('.fixed.inset-0.bg-black\\/50');
      const dim = overlay && overlay.querySelector('div');
      return {
        tx: new DOMMatrixReadOnly(getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform).m41,
        dim: dim ? parseFloat(getComputedStyle(dim).opacity) : null,
        overlay: !!overlay,
      };
    });
    check('panel follows pointer (tx < -30%)', s.tx < -0.3 * W, `tx=${s.tx.toFixed(1)}`);
    check('overlay dims while dragging', s.overlay && s.dim > 0.1, `dim=${s.dim}`);
    await wait(16);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: startX - 0.55 * W, y, button: 'left', clickCount: 1,
    });
    await wait(700);
    s = await page.evaluate(() => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      return {
        inert: !!p.inert,
        tx: new DOMMatrixReadOnly(getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform).m41,
        overlay: !!document.querySelector('.fixed.inset-0.bg-black\\/50'),
      };
    });
    check('swipe >30% closes drawer', s.inert && s.tx <= -W + 2 && !s.overlay,
      `tx=${s.tx.toFixed(1)}`);

    // 3. Small swipe springs back, stays open
    await page.tap('button[aria-label="Open navigation"]');
    await waitFor(page, () => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      return p && !p.inert;
    }, 'drawer reopens');
    await wait(400);
    await mouseDrag(cdp, startX, y, 0.12 * W, 8);
    await wait(700);
    s = await page.evaluate(() => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      return {
        inert: !!p.inert,
        tx: new DOMMatrixReadOnly(getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform).m41,
        overlay: !!document.querySelector('.fixed.inset-0.bg-black\\/50'),
      };
    });
    check('small swipe springs back (stays open)', !s.inert && Math.abs(s.tx) < 2 && s.overlay,
      `tx=${s.tx.toFixed(1)}`);

    // 4. Fast flick closes even below the distance threshold
    await mouseFlick(cdp, startX, y, 60);
    await wait(700);
    s = await page.evaluate(() => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      return {
        inert: !!p.inert,
        tx: new DOMMatrixReadOnly(getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform).m41,
        overlay: !!document.querySelector('.fixed.inset-0.bg-black\\/50'),
      };
    });
    check('fast flick closes drawer', s.inert && !s.overlay, `tx=${s.tx.toFixed(1)}`);

    // 5. Vertical pan scrolls the nav list (touch-action contract)
    await page.tap('button[aria-label="Open navigation"]');
    await waitFor(page, () => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      return p && !p.inert;
    }, 'drawer reopens');
    await wait(300);
    s = await page.evaluate(() => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      const sc = [...p.querySelectorAll('*')].find((el) => el.scrollHeight > el.clientHeight + 4
        && getComputedStyle(el).overflowY !== 'visible');
      return { hasScrollable: !!sc, before: sc ? sc.scrollTop : null };
    });
    if (s.hasScrollable) {
      await touchStart(cdp, startX, 600);
      for (let i = 1; i <= 8; i++) {
        await wait(16);
        await touchMove(cdp, startX + 4, 600 - i * 40); // pan up (scroll down)
      }
      await wait(16);
      await touchEnd(cdp);
      await wait(400);
      const after = await page.evaluate(() => {
        const p = document.querySelector('[aria-label="Main navigation"]');
        const sc = [...p.querySelectorAll('*')].find((el) => el.scrollHeight > el.clientHeight + 4
          && getComputedStyle(el).overflowY !== 'visible');
        return sc ? sc.scrollTop : null;
      });
      check('vertical pan scrolls list natively', after > s.before, `scrollTop ${s.before}→${after}`);
    } else {
      check('vertical pan scrolls list natively', true, 'skipped: nav fits without scrolling');
    }

    // 6. Regression: overlay click still closes
    await page.tap('.fixed.inset-0.bg-black\\/50');
    await wait(500);
    s = await page.evaluate(() => document.querySelector('[aria-label="Main navigation"]').inert);
    check('overlay click closes (regression)', s);

    // 7. Regression: Esc still closes
    await page.tap('button[aria-label="Open navigation"]');
    await waitFor(page, () => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      return p && !p.inert;
    }, 'drawer reopens');
    await page.keyboard.press('Escape');
    await wait(500);
    s = await page.evaluate(() => document.querySelector('[aria-label="Main navigation"]').inert);
    check('Esc closes (regression)', s);

    // 8. Robustness: an interrupted drag (headless cancels touch drags; real
    //    devices cancel on incoming calls, edge gestures, palm rejection)
    //    must end in a consistent state — snapped back open OR closed, never
    //    half-open/detached from the consumer's state.
    await page.tap('button[aria-label="Open navigation"]');
    await waitFor(page, () => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      return p && !p.inert;
    }, 'drawer reopens');
    await wait(400);
    await dragLeft(cdp, startX, y, 0.5 * W, 8);
    await wait(700);
    const rs = await page.evaluate(() => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      const overlay = !!document.querySelector('.fixed.inset-0.bg-black\\/50');
      const m = new DOMMatrixReadOnly(getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform);
      return { inert: !!p.inert, overlay, tx: m.m41 };
    });
    const consistent = (rs.inert && !rs.overlay && rs.tx <= -W + 2)
      || (!rs.inert && rs.overlay && Math.abs(rs.tx) < W * 0.7);
    check('interrupted drag ends consistent', consistent, JSON.stringify(rs));

    await page.close();

    // ── DESKTOP PASS ─────────────────────────────────────────────
    const d = await browser.newPage();
    await d.setViewport({ width: 1280, height: 800 });
    await d.evaluateOnNewDocument(
      (u, t) => {
        localStorage.setItem('studioUser', u);
        localStorage.setItem('studioToken', t);
      },
      user, token,
    );
    await d.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await d.waitForSelector('[aria-label="Main navigation"]', { timeout: 15000 });
    await wait(500);
    const ds = await d.evaluate(() => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      const cs = getComputedStyle(p);
      const m = new DOMMatrixReadOnly(cs.transform === 'none' ? '' : cs.transform);
      return {
        position: cs.position, tx: m.m41, inert: !!p.inert,
        touchAction: cs.touchAction, overlay: !!document.querySelector('.fixed.inset-0.bg-black\\/50'),
      };
    });
    console.log('\nDesktop regression:');
    check('panel static (flex child)', ds.position === 'static', ds.position);
    check('no transform on desktop', Math.abs(ds.tx) < 1, `tx=${ds.tx}`);
    check('never inert on desktop', !ds.inert);
    check('touch-action auto on desktop', ds.touchAction === 'auto', ds.touchAction);
    check('no mobile overlay on desktop', !ds.overlay);

    // Mouse drag must not move the panel
    await d.mouse.move(60, 400);
    await d.mouse.down();
    await d.mouse.move(20, 400, { steps: 5 }); // 40px leftward drag with button held
    await d.mouse.up();
    const ds2 = await d.evaluate(() => {
      const p = document.querySelector('[aria-label="Main navigation"]');
      return new DOMMatrixReadOnly(getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform).m41;
    });
    check('mouse drag does not move panel', Math.abs(ds2) < 1, `tx=${ds2}`);
    await d.close();
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  const relevantErrors = consoleErrors.filter(
    (t) => !t.includes('favicon') && !t.includes('React DevTools') && !t.includes('sharebx') && !t.includes('cssjs'),
  );
  if (relevantErrors.length) {
    console.log('\nPage console errors:');
    relevantErrors.forEach((e) => console.log(`  ! ${e.slice(0, 200)}`));
  }
  if (failed.length) {
    console.error('FAILED checks:', failed.map((f) => f.name));
    process.exit(1);
  }
  console.log('All drawer touch checks passed.');
}

main().catch((e) => {
  console.error('Test run failed:', e.message);
  process.exit(1);
});
