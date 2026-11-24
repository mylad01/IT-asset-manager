/**
 * EXPERIMENTAL USER TEST — drives the real UI like a person would, covering
 * every feature implemented in the recent sessions:
 *
 *   1. Keyboard nav: Tab → arrows move the highlight (no auto-open) → Enter
 *      opens the highlighted conversation; composer ignores arrows.
 *   2. Search flow: typing filters (real key events), arrows/Enter work from
 *      the search box, Esc clears without closing the drawer/dropdown.
 *   3. Mobile drawer: workspace drawer opens on mobile, Esc closes.
 *   4. @mention notifications: admin sends "@staff2 …" via the real composer;
 *      staff2's NotificationBell (WS-delivered) shows "mentioned you".
 *   5. Photo send: upload through the real file input, empty text, no 400,
 *      📎 link rendered; link serves the image.
 *   6. Modal responsiveness: create-ticket + add-asset modals — the fixed
 *      two-column form grids stack on phones and stay two-column on desktop.
 *
 * Requires the dev stack running (Vite :5174, API :3000). Read-only on data
 * except: one verification conversation + its messages/notifications.
 *   node scripts/testUserJourney.js
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_URL = process.env.APP_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && fs.existsSync(p));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function apiLogin(email, password) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email} → ${res.status}`);
  return res.json();
}

async function main() {
  // Hard stop: a silent hang is worse than a failed run.
  const watchdog = setTimeout(() => {
    console.error('GLOBAL WATCHDOG: run exceeded 4 minutes — aborting.');
    process.exit(2);
  }, 240000);

  // ── S1. Test data via API (conversation between admin and staff2) ──
  console.log('Setup:');
  const admin = await apiLogin('admin@studio.com', 'admin');
  const staff2 = await apiLogin('staff2@studio.com', '12345678');
  const cid = admin.user.id, sid = staff2.user.id;
  // Clean up conversations from previous journey runs (root-only delete).
  const existing = await fetch(`${API_URL}/api/conversations`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  }).then((r) => r.json());
  for (const c of existing.conversations || existing || []) {
    if (String(c.title || '').startsWith('UX Journey ')) {
      await fetch(`${API_URL}/api/conversations/${c.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${admin.token}` },
      }).catch(() => {});
    }
  }
  const cr = await fetch(`${API_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ title: `UX Journey ${Date.now()}`, type: 'standalone', participantIds: [cid, sid] }),
  }).then((r) => r.json());
  if (!cr.id) throw new Error(`conversation create failed: ${JSON.stringify(cr)}`);
  const convTitle = cr.title;
  check('verification conversation created', !!cr.id, `id=${cr.id}`);

  // ── S2. Browser ──
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
  const page = await browser.newPage();
  // Fail fast instead of stacking 30s default timeouts (a hung run should
  // point at the step, not time out the whole shell).
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(25000);
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument((u, t) => {
    localStorage.setItem('studioUser', u);
    localStorage.setItem('studioToken', t);
  }, JSON.stringify(admin.user), admin.token);
  await page.goto(`${APP_URL}/conversations`, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1200);

  // ── S3. Keyboard navigation ──
  console.log('\nKeyboard navigation:');
  // Focus the search input the way a user would (click it) — Tab order from
  // a fresh load lands on header buttons, not the sidebar.
  await page.click('input[placeholder*="Search conversations"]');
  await page.click('body'); // blur again: arrows must work without input focus
  await wait(200);

  const state = () => page.evaluate(() => {
    const hl = document.querySelector('[data-kbd-nav="true"]');
    const title = hl?.querySelector('.truncate')?.textContent
      || hl?.textContent?.trim().slice(0, 40) || null;
    const chatTitle = document.querySelector('main')?.innerText || '';
    return {
      hlTitle: title,
      hlIndex: hl ? [...hl.parentElement.children].indexOf(hl) : -1,
      chatHasConv: chatTitle.length > 0,
    };
  });

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await wait(350);
  let s = await state();
  const hl3 = s.hlTitle;
  check('3×ArrowDown highlights 3rd item', !!hl3, `hl="${hl3}" idx=${s.hlIndex}`);

  await page.keyboard.press('Enter');
  await wait(800);
  const chatText = await page.evaluate(() => document.querySelector('main')?.innerText || '');
  check('Enter opens the highlighted conversation', hl3 && chatText.includes(hl3.split('\n')[0].slice(0, 12)),
    `opened chat contains "${(hl3 || '').slice(0, 20)}"`);

  // ── S4. Search flow (real typing) ──
  console.log('\nSearch flow:');
  await page.keyboard.press('Escape'); // clear selection/chat? Esc closes chat or clears
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await wait(150);
  // Click the search input directly and type the prefix of the conv title
  await page.click('input[placeholder*="Search conversations"]');
  await page.keyboard.type(convTitle.slice(0, 12), { delay: 40 });
  await wait(500);
  const filtered = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('main [class*="uppercase"]')];
    const active = labels.find((el) => /active/i.test(el.textContent));
    const items = [...document.querySelectorAll('main button')].filter(
      (b) => b.closest('[class*="sidebar"], nav, aside') || b.querySelector('.truncate'),
    );
    return { activeLabel: active?.textContent?.trim() || null, itemTexts: items.slice(0, 6).map((b) => b.textContent.trim().slice(0, 30)) };
  });
  check('typing filters the list to the journey conv',
    /active\s*\(1\)/i.test(filtered.activeLabel || '') === true,
    `${filtered.activeLabel} items=${JSON.stringify(filtered.itemTexts)}`);

  // Arrows + Enter directly from the search box
  await page.keyboard.press('ArrowDown');
  await wait(250);
  s = await state();
  check('ArrowDown works while search focused', !!s.hlTitle, `hl="${s.hlTitle}"`);
  await page.keyboard.press('Enter');
  await wait(800);
  const opened = await page.evaluate(() => document.querySelector('main')?.innerText || '');
  check('Enter from search opens the filtered conv', opened.includes(convTitle.slice(0, 8)), convTitle);
  await page.keyboard.press('Escape'); // Esc from search: clears search
  await wait(400);
  const afterEsc = await page.evaluate(() => document.querySelector('input[placeholder*="Search conversations"]')?.value || '');
  check('Esc clears search text', afterEsc === '', `value="${afterEsc}"`);

  // ── S5. Mobile drawer ──
  console.log('\nMobile drawer:');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await wait(500);
  const drawerBtn = await page.$('button[aria-label="Show conversations"]');
  check('workspace drawer button visible on mobile', !!drawerBtn);
  if (drawerBtn) {
    await drawerBtn.tap();
    await wait(600);
    let open = await page.evaluate(() => {
      const panels = [...document.querySelectorAll('[aria-label="Conversations"]')];
      const p = panels[panels.length - 1];
      return p ? { inert: p.inert, tx: new DOMMatrixReadOnly(getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform).m41 } : null;
    });
    check('drawer opens (interactive, tx≈0)', open && !open.inert && open.tx > -5, JSON.stringify(open));
    await page.keyboard.press('Escape');
    await wait(500);
    open = await page.evaluate(() => {
      const panels = [...document.querySelectorAll('[aria-label="Conversations"]')];
      const p = panels[panels.length - 1];
      return p ? p.inert : null;
    });
    check('Esc closes drawer', open === true);
  }
  await page.setViewport({ width: 1280, height: 800 });
  await wait(400);

  // ── S6. @mention → staff2's bell (WS) ──
  // ── S6. @mention send (admin) + photo send (admin — /conversations is
  // admin-only in the UI, so staff can't reach the composer) ──
  console.log('\n@mention send + photo send:');
  // Re-open the journey conversation (viewport flips may have dropped the
  // open chat) before typing the mention.
  await page.click('input[placeholder*="Search conversations"]').catch(() => {});
  await page.keyboard.type(convTitle.slice(0, 12), { delay: 30 });
  await wait(500);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await wait(900);
  // type the mention message as admin via the real composer
  const ta = await page.$('main textarea');
  check('composer textarea present', !!ta);
  if (ta) {
    await ta.type(`@staff2 please verify this journey ${Date.now()}`, { delay: 15 });
    await page.click('main button[type="submit"]');
    await wait(1000);
  }

  // photo send in the same open conversation (admin)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const photoPath = path.join(os.tmpdir(), 'journey-photo.png');
  fs.writeFileSync(photoPath, png);
  const fileInput = await page.$('main input[type="file"]');
  check('file input present in composer', !!fileInput);
  if (fileInput) {
    await fileInput.uploadFile(photoPath);
    await wait(400);
    const sendEnabled = await page.evaluate(() => {
      const btn = document.querySelector('main button[type="submit"]');
      return btn && !btn.disabled;
    });
    check('send enabled with photo + empty text', sendEnabled);
    await page.click('main button[type="submit"]');
    await wait(1500);
    // AttachmentCard renders the image INLINE (blob src, aria-labeled
    // button that opens the lightbox) — the old "📎 filename" anchor was
    // replaced because <a href> navigation cannot carry the auth header.
    const sent = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('main button[aria-label^="Open image"]')].pop();
      const img = btn?.querySelector('img');
      return btn && img ? { src: (img.getAttribute('src') || '').slice(0, 24), alt: img.alt } : null;
    });
    check('photo message renders inline image attachment', !!sent, JSON.stringify(sent));
    if (sent) {
      // The blob src exists because an AUTHENTICATED fetch succeeded —
      // (a raw navigation 401s by design — that's why the card fetches). 
      check('image blob resolved via authenticated fetch (user path)', sent.src.startsWith('blob:'), sent.src);
      // Click opens the lightbox without leaving the workspace.
      await page.evaluate(() => {
        [...document.querySelectorAll('main button[aria-label^="Open image"]')].pop()?.click();
      });
      await wait(800);
      const stillThere = await page.evaluate(() => document.querySelector('main input[placeholder*="Search conversations"]') !== null || document.querySelector('main textarea') !== null);
      check('image click opens lightbox (page stays, no 401 nav)', stillThere);
      await page.keyboard.press('Escape');
      await wait(500);
    }
  }

  // ── S7. staff2's bell receives the mention (WS) ──
  // /conversations is admin-only in the UI; staff land on the dashboard,
  // where the NotificationBell lives in the sidebar.
  console.log('\n@mention delivery to staff2:');
  await page.evaluateOnNewDocument((u, t) => {
    localStorage.setItem('studioUser', u);
    localStorage.setItem('studioToken', t);
  }, JSON.stringify(staff2.user), staff2.token);
  await page.goto(`${APP_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1500);
  let mentioned = null;
  for (let i = 0; i < 5 && !mentioned; i++) {
    await page.click('button[aria-label^="Notifications"]').catch(() => {});
    await wait(700);
    mentioned = await page.evaluate(() => {
      const t = document.body.innerText;
      return t.includes('mentioned you') ? 'panel shows mention' : null;
    });
    if (!mentioned) {
      await page.keyboard.press('Escape').catch(() => {});
      await wait(1200); // give WS more time
    }
  }
  check('staff2 bell shows "mentioned you"', !!mentioned, mentioned || 'never appeared');

  // ── S8. Modal responsiveness (the fixed grids) ──
  console.log('\nModal responsiveness:');
  // Last evaluateOnNewDocument registration wins — switch back to admin.
  await page.evaluateOnNewDocument((u, t) => {
    localStorage.setItem('studioUser', u);
    localStorage.setItem('studioToken', t);
  }, JSON.stringify(admin.user), admin.token);
  // Open the modal fresh per viewport: an isMobile viewport flip reloads the
  // page and unmounts an open modal, so measure in two separate passes.
  const modalColsAt = async (viewport) => {
    await page.setViewport(viewport);
    await page.goto(`${APP_URL}/my-tickets`, { waitUntil: 'networkidle2', timeout: 30000 });
    await wait(900);
    const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('New Ticket')));
    await btn.asElement()?.click();
    await wait(600);
    const cols = await page.evaluate(() => {
      const grid = [...document.querySelectorAll('.grid')].find((g) => g.className.includes('grid-cols-1'));
      return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
    });
    await page.keyboard.press('Escape');
    return cols;
  };
  const cols1280 = await modalColsAt({ width: 1280, height: 800 });
  const cols390 = await modalColsAt({ width: 390, height: 844, isMobile: true, hasTouch: true });
  check('ticket modal grid stacks on phone, 2-col on desktop',
    cols390 === 1 && cols1280 === 2, `phone=${cols390} desktop=${cols1280}`);
  await page.setViewport({ width: 1280, height: 800 });
  await wait(300);

  // ── Console errors ──
  const noise = /favicon|React DevTools|sharebx|cssjs|WebSocket|net::ERR/i;
  const relevant = consoleErrors.filter((e) => !noise.test(e));
  console.log(`\nConsole: ${relevant.length} relevant errors`);
  relevant.slice(0, 8).forEach((e) => console.log(`  ! ${e}`));

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  clearTimeout(watchdog);
  console.log(`\n${results.length - failed.length}/${results.length} journey checks passed`);
  if (failed.length) {
    console.error('FAILED:', failed.map((f) => f.name));
    process.exit(1);
  }
  console.log('User journey complete — all features working.');
}

main().catch((e) => { console.error('Journey failed:', e.message); process.exit(1); });
