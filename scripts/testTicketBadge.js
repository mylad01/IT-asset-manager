#!/usr/bin/env node
/**
 * scripts/testTicketBadge.js — ticket-linked badge E2E (browser QA).
 *
 * Seeds a REAL ticket-linked conversation through the API against a ticket
 * that has no chat yet, then drives the real UI (Vite :5174) and asserts:
 *   1. the sidebar item carries the amber Ticket badge (the
 *      --status-warning-strong icon box + warning glyph) and NOT the violet
 *      standalone styling; colors are semantic tokens since the 2026-10-07
 *      palette sweep — assertions match the var()-based class strings;
 *   2. opening it shows the amber "Ticket" chip beside the title in the
 *      chat header;
 *   3. no stray "0" text nodes on either surface — numeric-falsy regression
 *      (ChatHeader's is_archived guard used to render a literal 0, and the
 *      sidebar item is the other ticket_id `&&` surface);
 *   4. zero unexpected browser console errors.
 *
 * Cleanup ALWAYS runs (finally) and is itself asserted: identity re-check →
 * soft-delete (recycle bin) → permanent purge → proof the row is gone from
 * the ACTIVE DB and the archive, so repeated runs never accumulate seeds or
 * collide with the one-chat-per-ticket unique index.
 *
 * Seed safety: only a conversation created by THIS run (id absent from the
 * pre-seed list AND title matching this run's unique title) is ever deleted —
 * a dedupe hit that returns a pre-existing chat is never touched.
 *
 * Requires the dev stack: API :3000 (seeding) + Vite :5174 (UI).
 *   node scripts/testTicketBadge.js
 * Env: APP_URL, CHROME_PATH — credentials via tests/helpers.mjs
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { api, login, USERS } from '../tests/helpers.mjs';

const APP_URL = process.env.APP_URL || 'http://localhost:5174';
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && fs.existsSync(p));

let passed = 0;
let failed = 0;
const check = (ok, name, note = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && note ? ` :: ${note}` : ''}`);
  if (ok) passed++;
  else failed++;
};

const list = (d, key) => (Array.isArray(d) ? d : (d?.[key] || []));

// What this run created — cleanup touches ONLY this.
let createdId = null;
let createdTitle = null;
let token = null;

async function seed() {
  const { data: cData } = await api('GET', '/conversations', null, token);
  const beforeIds = new Set(list(cData, 'conversations').map((c) => c.id));
  const { status: tStatus, data: tData } = await api('GET', '/tickets', null, token);
  if (tStatus !== 200) throw new Error(`ticket list failed (status ${tStatus})`);
  const tickets = list(tData, 'tickets');
  if (!tickets.length) throw new Error('no tickets to seed against');

  // Walk candidates until one is genuinely NEW (dedupe would hand back a
  // pre-existing chat for a ticket that already has one — never adopt it).
  let dedupeHits = 0;
  for (const t of tickets.slice(0, 10)) {
    createdTitle = `Ticket badge QA seed ${Date.now()}`;
    const { status, data } = await api('POST', '/conversations', {
      title: createdTitle, type: 'ticket-linked', ticketId: t.id, participantIds: [],
    }, token);
    const conv = data?.conversation || data;
    if (status === 200 || status === 201) {
      if (!beforeIds.has(conv.id) && conv?.title === createdTitle) {
        createdId = conv.id;
        check(true, `seed: conversation ${conv.id} created for ticket ${t.id} (status ${status})`);
        // DB proof: the strict CHECK accepted the real app vocabulary.
        const db = new Database('database.sqlite', { readonly: true });
        const row = db.prepare('SELECT type, ticket_id FROM conversations WHERE id = ?').get(createdId);
        db.close();
        check(row?.type === 'ticket-linked' && row?.ticket_id === t.id,
          'seed: live DB row is type=ticket-linked with ticket_id', JSON.stringify(row));
        return t.id;
      }
      dedupeHits++; // pre-existing chat returned — try a different ticket
    }
  }
  throw new Error(`no seedable ticket (dedupe hits: ${dedupeHits})`);
}

async function verifyUi(user) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-first-run'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      // favicon noise + a PRE-EXISTING app warning unrelated to this surface
      // (ThemeContext set-state-during-render — observed on every page load).
      if (/favicon|Cannot update a component/.test(t)) return;
      consoleErrors.push(t.slice(0, 150));
    });

    await page.evaluateOnNewDocument((u, t) => {
      localStorage.setItem('studioUser', u);
      localStorage.setItem('studioToken', t);
    }, JSON.stringify(user), token);

    await page.goto(`${APP_URL}/conversations`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      (title) => [...document.querySelectorAll('main button')]
        .some((b) => (b.textContent || '').includes(title)),
      { timeout: 15000 }, createdTitle,
    );

    // ── sidebar badge ──
    const side = await page.evaluate((title) => {
      const btn = [...document.querySelectorAll('main button')]
        .find((b) => (b.textContent || '').includes(title));
      if (!btn) return { found: false };
      return {
        found: true,
        amberBox: !!btn.querySelector('[class*="bg-[color:var(--status-warning-strong)]/15"]'),
        amberIcon: !!btn.querySelector('svg[class*="text-[color:var(--status-warning)]"]'),
        violet: !!btn.querySelector('[class*="bg-[color:var(--ui-violet-strong)]"]'),
        strayZero: btn.innerText.split('\n').some((l) => l.trim() === '0'),
      };
    }, createdTitle);
    check(side.found, 'sidebar: seeded conversation is listed');
    check(side.amberBox && side.amberIcon, 'sidebar: amber Ticket badge (icon box + glyph)', JSON.stringify(side));
    check(!side.violet, 'sidebar: NOT standalone violet styling', JSON.stringify(side));
    check(!side.strayZero, 'sidebar: no stray 0 text');

    // ── open it → header chip ──
    await page.evaluate((title) => {
      const btn = [...document.querySelectorAll('main button')]
        .find((b) => (b.textContent || '').includes(title));
      btn?.click();
    }, createdTitle);
    await page.waitForFunction(
      (title) => [...document.querySelectorAll('main h3')]
        .some((h) => (h.textContent || '').includes(title)),
      { timeout: 15000 }, createdTitle,
    );

    const head = await page.evaluate((title) => {
      const h3 = [...document.querySelectorAll('main h3')]
        .find((h) => (h.textContent || '').includes(title));
      const row = h3?.parentElement;
      const pill = row ? [...row.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Ticket') : null;
      const box = h3 ? (h3.closest('div.px-4') || row) : null;
      return {
        found: !!h3,
        pill: !!pill,
        pillAmber: pill
          ? pill.className.includes('bg-[color:var(--status-warning-strong)]/15')
            && pill.className.includes('text-[color:var(--status-warning)]')
          : false,
        strayZero: box ? box.innerText.split('\n').some((l) => l.trim() === '0') : true,
      };
    }, createdTitle);
    check(head.found, 'header: conversation opened');
    check(head.pill && head.pillAmber, 'header: amber "Ticket" chip beside the title', JSON.stringify(head));
    check(!head.strayZero, 'header: no stray 0 text (is_archived guard regression)', JSON.stringify(head));

    check(consoleErrors.length === 0, 'browser console clean', consoleErrors.join(' | '));
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Always runs; every step asserted. Touches only this run's conversation. */
async function cleanup() {
  if (createdId == null || token == null) return;

  // Identity re-check: refuse to delete anything we didn't create.
  const { status: gStatus, data: gData } = await api('GET', `/conversations/${createdId}`, null, token);
  const live = gData?.conversation || gData;
  if (gStatus !== 200 || live?.title !== createdTitle) {
    check(false, 'cleanup: seed identity re-verified (title match before delete)',
      `status=${gStatus} title=${live?.title} expected=${createdTitle}`);
    return;
  }

  const { status: dStatus } = await api('DELETE', `/conversations/${createdId}`, null, token);
  check(dStatus === 200, 'cleanup: soft-delete (moved to recycle bin)', `status=${dStatus}`);

  const { status: pStatus } = await api('DELETE', `/conversations/archive/${createdId}`, null, token);
  check(pStatus >= 200 && pStatus < 300, 'cleanup: permanent purge', `status=${pStatus}`);

  const db = new Database('database.sqlite', { readonly: true });
  const row = db.prepare('SELECT id FROM conversations WHERE id = ?').get(createdId);
  db.close();
  check(!row, 'cleanup: no row left in the ACTIVE database');

  const { status: aStatus } = await api('GET', `/conversations/archive/${createdId}`, null, token);
  check(aStatus === 404, 'cleanup: archive no longer serves the conversation', `status=${aStatus}`);
}

async function main() {
  if (!CHROME) throw new Error('no Chrome/Edge found — set CHROME_PATH');
  const loginResult = await login(USERS.admin);
  token = loginResult.token;
  await seed();
  await verifyUi(loginResult.user);
}

try {
  await main();
} finally {
  await cleanup();
}

console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
process.exitCode = failed > 0 ? 1 : 0;
