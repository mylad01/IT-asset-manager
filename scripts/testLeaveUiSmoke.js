#!/usr/bin/env node
/**
 * scripts/testLeaveUiSmoke.js — leave-requests UI regression (browser QA).
 *
 * Seeds through the API (dept + manager + staff, purged with proof at the
 * end), then drives the real UI (Vite :5174) with puppeteer-core and asserts
 * the role plumbing, both pages, the sidebar badge and the deep links.
 * Console noise is filtered like testTicketBadge (favicon + the known
 * ThemeContext pre-warning are ignored).
 *
 * Assembled from the retired leave-requests implementation plan (Tasks 6/8/9
 * Step 1) with adaptations where the as-built DOM differs from the plan's
 * sketch — every adaptation preserves the spec behavior it asserts
 * (spec: docs/superpowers/specs/2026-10-13-leave-requests-design.md).
 *
 * Requires the dev stack: API :3000 + Vite :5174.
 *   node scripts/testLeaveUiSmoke.js
 * Env: APP_URL, CHROME_PATH — credentials via tests/helpers.mjs
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { api, login, USERS, BASE } from '../tests/helpers.mjs';

const APP_URL = process.env.APP_URL || 'http://localhost:5174';
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && fs.existsSync(p));

const STAMP = Date.now();
const DB_PATH = process.env.DB_PATH || 'database.sqlite';
const UPLOADS_LEAVE_DIR = path.join(process.env.UPLOADS_DIR || 'uploads', 'leave-requests');

let passed = 0, failed = 0;
const check = (ok, name, note = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && note ? ` :: ${note}` : ''}`);
  if (ok) passed++; else failed++;
};
const section = (title) => console.log(`\n--- ${title} ---`);

/**
 * Serialized into page.waitForFunction (so: no closures) — resolves the
 * SETTLED sidebar leave badge text:
 *   false    → the hook is still loading (the pill shows a spinner, no text)
 *   'none'   → settled at zero (the pill unmounts, so the wrapper is empty)
 *   '1','2'… → settled at a non-zero count
 * The zero case has to persist for a beat: before the effect flips
 * isLoading on there is one genuinely-empty frame that would otherwise be
 * mistaken for a settled zero.
 */
function settledLeaveBadge() {
  const link = [...document.querySelectorAll('aside a')]
    .find(a => (a.textContent || '').includes('Leave Approvals'));
  const badge = link ? link.querySelector('span.ml-auto') : null;
  if (!badge) return false;
  if (badge.querySelector('span.animate-spin')) { window.__lbEmptySince = 0; return false; } // loading
  const t = badge.textContent.trim();
  if (t) { window.__lbEmptySince = 0; return t; }
  const now = Date.now();
  if (!window.__lbEmptySince) { window.__lbEmptySince = now; return false; }
  return now - window.__lbEmptySince >= 1000 ? 'none' : false;
}

const S = { createdUserIds: [], createdDeptIds: [], leaveIds: [] };
let adminToken = null;
let browser = null;

/** Launch a page logged in as `user`, collect filtered console errors. */
async function openAs(user, token) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|Cannot update a component/.test(t)) return;
    consoleErrors.push(t.slice(0, 150));
  });
  // Seeded users are created via the real API, which sets
  // requires_password_change=1 — App.jsx would park them on ForcePasswordChange
  // for EVERY route. The forced-change gate is out of scope for this leave-UI
  // suite, so the stored session clears the flag (the app-side check reads only
  // this localStorage object); everything else is the real login's payload.
  await page.evaluateOnNewDocument((u, t) => {
    localStorage.setItem('studioUser', u);
    localStorage.setItem('studioToken', t);
  }, JSON.stringify({ ...user, requires_password_change: 0 }), token);
  return { page, consoleErrors };
}

function countRows(sql) {
  const db = new Database(DB_PATH, { readonly: true });
  try { return db.prepare(sql).get().n; } finally { db.close(); }
}

async function seed() {
  section('Seed (API-only — purged with proof)');
  for (const label of ['LeaveUI-A', 'LeaveUI-B']) {
    const r = await api('POST', '/departments', { name: `${label}-${STAMP}` }, adminToken);
    check(r.status === 201, `seed: department ${label} (status ${r.status})`);
  }
  const depts = (await api('GET', '/departments', null, adminToken)).data || [];
  S.deptA = depts.find(d => d.name === `LeaveUI-A-${STAMP}`)?.id;
  S.deptB = depts.find(d => d.name === `LeaveUI-B-${STAMP}`)?.id;
  S.createdDeptIds = [S.deptA, S.deptB];
  check(!!S.deptA && !!S.deptB, 'seed: both department ids resolved');

  const mk = async (key, name, role, deptId) => {
    const email = `leaveui.${key}.${STAMP}@qa.local`;
    const r = await api('POST', '/users', {
      name: `${name}-${STAMP}`, email, password: 'LeaveQA1234', role, dept_id: deptId ?? null,
    }, adminToken);
    check(r.status === 201, `seed: ${key} (status ${r.status})`);
    const id = r.data?.id ?? (await api('GET', '/users', null, adminToken)).data?.find(u => u.email === email)?.id;
    S.createdUserIds.push(id);
    const { token, user } = await login({ email, password: 'LeaveQA1234' });
    S[key] = { id, token, user, email };
  };

  await mk('mgrA', 'LeaveUiMgrA', 'Department Manager', S.deptA);
  await mk('mgrB', 'LeaveUiMgrB', 'Department Manager', S.deptB);
  await mk('staffA', 'LeaveUiStaffA', 'Staff', S.deptA);
  await mk('staffB', 'LeaveUiStaffB', 'Staff', S.deptB);
  S.roUser = (await login({ email: 'readonly1@studio.com', password: 'readonly1234' }));
  S.roToken = S.roUser.token;
  check(!!S.roToken, 'seed: Read-Only token acquired');
}

// ── Phase: role plumbing (spec §7 inventory) ──
async function phaseRolePlumbing() {
  section('Role plumbing (AddUserModal, UserManagement badge/edit)');
  const { page, consoleErrors } = await openAs(S.admin, adminToken);
  await page.goto(`${APP_URL}/users-admin`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 1. Add-user modal offers the new role
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('Add New User')),
    { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => (b.textContent || '').includes('Add New User')).click());
  await page.waitForFunction(
    () => [...document.querySelectorAll('select')]
      .some(s => [...s.options].some(o => /Standard Staff/.test(o.textContent))),
    { timeout: 10000 });
  const addHasRole = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')]
      .find(s => [...s.options].some(o => /Standard Staff/.test(o.textContent)));
    return !!(sel && [...sel.options].some(o => o.value === 'Department Manager'));
  });
  check(addHasRole, 'Add-user modal offers "Department Manager"');

  // 2. The seeded manager's row wears a DISTINCT badge
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (name) => [...document.querySelectorAll('tbody tr')].some(tr => (tr.innerText || '').includes(name)),
    { timeout: 15000 }, `LeaveUiMgrA-${STAMP}`);
  const badgeOk = await page.evaluate((name) => {
    const row = [...document.querySelectorAll('tbody tr')]
      .find(tr => (tr.innerText || '').includes(name));
    if (!row) return null;
    return row.innerText.includes('Department Manager')
      && row.innerHTML.includes('glass-badge-amber');
  }, `LeaveUiMgrA-${STAMP}`);
  check(!!badgeOk, 'users table: manager row wears the amber badge', String(badgeOk));

  // 3. Edit modal's role select also offers the new role
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll('tbody tr')]
      .find(tr => (tr.innerText || '').includes(name));
    const edit = row && [...row.querySelectorAll('button')]
      .find(b => b.querySelector('svg') && b.getAttribute('aria-label') !== 'x');
    (edit || row?.querySelector('button'))?.click();
  }, `LeaveUiMgrA-${STAMP}`);
  const editHasRole = await page.waitForFunction(
    () => [...document.querySelectorAll('select')]
      .some(s => [...s.options].some(o => o.value === 'Department Manager')),
    { timeout: 8000 }).then(() => true).catch(() => false);
  check(editHasRole, 'Edit-user modal offers "Department Manager"');

  check(consoleErrors.length === 0, 'browser console clean on /users-admin', consoleErrors.join(' | '));
  await page.close();
}

// ── Phase: /leave page (spec §7.1) ──
async function phaseMyLeave() {
  section('/leave page (form, table, manager note, Read-Only hidden)');

  // Seed one request through the API so the table has data to render.
  const sub = await api('POST', '/leave-requests', {
    start_date: '2026-11-02', end_date: '2026-11-04',
    description: 'Seeded by the UI smoke suite.',
  }, S.staffA.token);
  check(sub.status === 201, `seed: staff leave request (status ${sub.status})`);
  S.mainId = sub.data?.id; S.leaveIds.push(S.mainId);

  // 1. Staff sees the table + status chip; the submit form opens from
  //    "New Request" (as-built: the form lives in LeaveSubmitModal).
  {
    const { page, consoleErrors } = await openAs(S.staffA.user, S.staffA.token);
    await page.goto(`${APP_URL}/leave`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll('button')]
        .some(b => /New (Leave )?Request/.test(b.textContent || '')),
      { timeout: 15000 });
    const rowOk = await page.waitForFunction(
      () => (document.body.innerText || '').includes('Seeded by the UI smoke suite.'),
      { timeout: 15000 }).then(() => true).catch(() => false);
    check(rowOk, 'Staff table shows the seeded request');
    const chipOk = await page.evaluate(() =>
      (document.body.innerText || '').includes('Pending')
      && !!document.querySelector('.glass-badge-amber'));
    check(chipOk, 'Pending status chip renders (amber)');
    const sidebarOk = await page.evaluate(() =>
      [...document.querySelectorAll('aside a')].some(a => (a.textContent || '').includes('My Leave')));
    check(sidebarOk, 'Staff sidebar carries the "My Leave" entry');

    // Open the submit modal and assert the description textarea renders.
    await page.evaluate(() => [...document.querySelectorAll('button')]
      .find(b => /New (Leave )?Request/.test(b.textContent || '')).click());
    const formOk = await page.waitForFunction(() => !!document.querySelector('textarea'),
      { timeout: 8000 }).then(() => true).catch(() => false);
    check(formOk, 'Staff /leave renders the submit form (textarea present)');

    check(consoleErrors.length === 0, 'browser console clean (Staff /leave)', consoleErrors.join(' | '));
    await page.close();
  }

  // 2. Manager: form REPLACED by the info note (spec §7.1)
  {
    const { page, consoleErrors } = await openAs(S.mgrA.user, S.mgrA.token);
    await page.goto(`${APP_URL}/leave`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const noteOk = await page.waitForFunction(
      () => (document.body.innerText || '').includes('Requests are filed by your administrator'),
      { timeout: 15000 }).then(() => true).catch(() => false);
    check(noteOk, 'Manager /leave shows the info note');
    const noForm = await page.evaluate(() => !document.querySelector('textarea'));
    check(noForm, 'Manager /leave has NO submit form');
    check(consoleErrors.length === 0, 'browser console clean (Manager /leave)', consoleErrors.join(' | '));
    await page.close();
  }

  // 3. Read-Only: route hidden — navigating lands elsewhere (spec §2)
  {
    const { page, consoleErrors } = await openAs(S.roUser.user, S.roToken);
    await page.goto(`${APP_URL}/leave`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800)); // let the redirect settle
    const url = page.url();
    check(!url.endsWith('/leave'), 'Read-Only /leave redirects away (route hidden)', url);
    const sidebarGone = await page.evaluate(() =>
      ![...document.querySelectorAll('aside a')].some(a => (a.textContent || '').includes('My Leave')));
    check(sidebarGone, 'Read-Only sidebar has NO "My Leave" entry');
    check(consoleErrors.length === 0, 'browser console clean (Read-Only)', consoleErrors.join(' | '));
    await page.close();
  }
}

// ── Phase: /leave-approvals page (spec §7.2 + §6 badge) ──
async function phaseApprovals() {
  section('/leave-approvals page (deep link, approve, deny, badge, Read-Only)');

  // Second request from the same staff user — disjoint range (2026-11-16..17)
  // so the overlap rule lets it through; used by the deny flow below.
  const denySub = await api('POST', '/leave-requests', {
    start_date: '2026-11-16', end_date: '2026-11-17',
    description: 'Seeded by the UI smoke suite (deny flow).',
  }, S.staffA.token);
  check(denySub.status === 201, `seed: second staff request (status ${denySub.status})`);
  const denyId = denySub.data?.id; S.leaveIds.push(denyId);

  // 1. Manager: deep link preselects, badge counts, approve works
  {
    const { page, consoleErrors } = await openAs(S.mgrA.user, S.mgrA.token);
    await page.goto(`${APP_URL}/leave-approvals?req=${S.mainId}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Badge: 2 pending in dept A (mainId + denyId), title says "pending requests".
    const badgeVal = await page.waitForFunction(settledLeaveBadge, { timeout: 15000 })
      .then(h => h.jsonValue()).catch(() => null);
    check(badgeVal === '2', 'sidebar badge shows the pending count (2)', String(badgeVal));
    // Title lives on the inner NotificationLeaveIcon span, not the Sidebar
    // wrapper — and the loading pill carries a "Loading…" title instead.
    const badgeTitle = await page.waitForFunction(() => {
      const link = [...document.querySelectorAll('aside a')]
        .find(a => (a.textContent || '').includes('Leave Approvals'));
      const t = link?.querySelector('span.ml-auto span[title]')?.getAttribute('title') || '';
      return /^0 pending|^Loading/.test(t) ? false : (t || false);
    }, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);
    check(badgeTitle === '2 pending leave requests', 'badge title says "pending leave requests"', String(badgeTitle));

    // Deep link ?req= preselects the row → the detail pane opens (spec §7.2).
    const preselected = await page.waitForFunction(
      () => (document.body.innerText || '').includes('Leave Request Details'),
      { timeout: 15000 }).then(() => true).catch(() => false);
    check(preselected, 'deep link ?req= preselects the row (detail pane open)');
    // innerText reflects CSS text-transform — the heading renders uppercased.
    const covOk = await page.evaluate(() => /coverage/i.test(document.body.innerText || ''));
    check(covOk, 'page renders the coverage strip');

    // Dismiss the detail pane (param is already stripped — a reload lands clean).
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Approve flow: row's Approve → confirm modal → "Approve Request".
    const approveVisible = await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Approve'),
      { timeout: 15000 }).then(() => true).catch(() => false);
    check(approveVisible, 'pending row shows Approve without toggling');
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Approve')?.click();
    });
    const confirmBtn = await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Approve Request'),
      { timeout: 8000 }).then(() => true).catch(() => false);
    check(confirmBtn, 'Approve opens the confirm modal');
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Approve Request')?.click();
    });
    // The approved row leaves the Pending tab: its count badge drops to 1
    // (the deny-flow row legitimately still shows Approve/Deny).
    const cleared = await page.waitForFunction(() => {
      const tab = [...document.querySelectorAll('button')]
        .find(b => (b.textContent || '').trim().startsWith('Pending'));
      return !!tab && /1/.test(tab.textContent);
    }, { timeout: 15000 }).then(() => true).catch(() => false);
    check(cleared, 'approved row leaves the pending tab (count → 1)');
    const dec = await api('GET', '/leave-requests/pending?view=decided', null, S.mgrA.token);
    const decRows = Array.isArray(dec.data) ? dec.data : [];
    check(decRows.some(r => r.id === S.mainId && r.status === 'Approved'),
      'API: approved row is in the Decided view', decRows.length ? '' : `status ${dec.status}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const badgeAfter = await page.waitForFunction(settledLeaveBadge, { timeout: 15000 })
      .then(h => h.jsonValue()).catch(() => 'err');
    check(badgeAfter === '1', 'badge drops to 1 after the decide (reload)', String(badgeAfter));

    // Deny flow: the row's Deny button opens the modal with a note field.
    // Wait for the PENDING LIST to render first — the sidebar badge resolves
    // from its own /pending-count fetch and lands well before the inbox's
    // Promise.all, so clicking blind is a no-op (the detail/approve steps
    // above wait the same way).
    const denyVisible = await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Deny'),
      { timeout: 15000 }).then(() => true).catch(() => false);
    check(denyVisible, 'pending row shows Deny after the reload');
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Deny')?.click();
    });
    const modalOk = await page.waitForFunction(() => !!document.querySelector('textarea'),
      { timeout: 8000 }).then(() => true).catch(() => false);
    check(modalOk, 'Deny opens the confirm modal (note textarea present)');
    if (modalOk) {
      await page.type('textarea', 'Peak season coverage needed.');
      await page.evaluate(() => {
        [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Deny Request'))?.click();
      });
    }
    const emptied = await page.waitForFunction(() =>
      (document.body.innerText || '').includes('No pending leave requests'),
      { timeout: 15000 }).then(() => true).catch(() => false);
    check(emptied, 'denied row leaves the pending tab (empty state text)');
    const dec2 = await api('GET', '/leave-requests/pending?view=decided', null, S.mgrA.token);
    const dec2Rows = Array.isArray(dec2.data) ? dec2.data : [];
    const deniedRow = dec2Rows.find(r => r.id === denyId);
    check(deniedRow?.status === 'Denied' && deniedRow?.decision_note === 'Peak season coverage needed.',
      'API: denial stored with the note', JSON.stringify(deniedRow));

    check(consoleErrors.length === 0, 'browser console clean (Manager /leave-approvals)', consoleErrors.join(' | '));
    await page.close();
  }

  // 2. Read-Only: full data, NO action controls, entry but no badge
  {
    const { page, consoleErrors } = await openAs(S.roUser.user, S.roToken);
    await page.goto(`${APP_URL}/leave-approvals`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for the tab bar itself before clicking — the page's first paint can
    // land after the sidebar, and a blind click is a no-op.
    const decidedTabReady = await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim().startsWith('Decided')),
      { timeout: 15000 }).then(() => true).catch(() => false);
    check(decidedTabReady, 'Read-Only: the Decided tab renders');
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim().startsWith('Decided'))?.click();
    });
    const rowSeen = await page.waitForFunction((name) =>
      (document.body.innerText || '').includes(name),
      { timeout: 15000 }, `LeaveUiStaffA-${STAMP}`).then(() => true).catch(() => false);
    check(rowSeen, 'Read-Only sees the Decided rows');
    const noActions = await page.evaluate(() =>
      ![...document.querySelectorAll('button')]
        .some(b => ['Approve', 'Deny', 'Deny Request'].includes((b.textContent || '').trim())));
    check(noActions, 'Read-Only sees NO approve/deny controls');
    const sidebarOk = await page.evaluate(() =>
      [...document.querySelectorAll('aside a')].some(a => (a.textContent || '').includes('Leave Approvals')));
    check(sidebarOk, 'Read-Only sidebar carries the "Leave Approvals" entry');
    // Wait for the hook to settle first: a one-shot evaluate can catch the
    // loading pill and report a badge that would never render.
    const roBadge = await page.waitForFunction(settledLeaveBadge, { timeout: 15000 })
      .then(h => h.jsonValue()).catch(() => 'err');
    check(roBadge === 'none', 'Read-Only badge never lights (pending-count is 0)', String(roBadge));
    check(consoleErrors.length === 0, 'browser console clean (Read-Only)', consoleErrors.join(' | '));
    await page.close();
  }

  // 3. Staff: route hidden — navigating lands elsewhere, no sidebar entry
  {
    const { page, consoleErrors } = await openAs(S.staffA.user, S.staffA.token);
    await page.goto(`${APP_URL}/leave-approvals`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800)); // let the redirect settle
    check(!page.url().includes('/leave-approvals'), 'Staff /leave-approvals redirects away', page.url());
    const sidebarGone = await page.evaluate(() =>
      ![...document.querySelectorAll('aside a')].some(a => (a.textContent || '').includes('Leave Approvals')));
    check(sidebarGone, 'Staff sidebar has NO "Leave Approvals" entry');
    check(consoleErrors.length === 0, 'browser console clean (Staff)', consoleErrors.join(' | '));
    await page.close();
  }

  // 4. Cross-department manager: empty inbox (server-side scoping, spec §2)
  {
    const { page, consoleErrors } = await openAs(S.mgrB.user, S.mgrB.token);
    await page.goto(`${APP_URL}/leave-approvals`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const emptyOk = await page.waitForFunction(() =>
      (document.body.innerText || '').includes('No pending leave requests'),
      { timeout: 15000 }).then(() => true).catch(() => false);
    check(emptyOk, 'cross-department manager sees an empty inbox');
    check(consoleErrors.length === 0, 'browser console clean (MgrB)', consoleErrors.join(' | '));
    await page.close();
  }
}

async function cleanup() {
  section('Cleanup (purge with proof)');

  // Remove any attachment files this run wrote FIRST (rows cascade in the
  // user deletes below — the file lookup needs the rows to still exist).
  const ids = S.leaveIds.filter(Boolean);
  if (ids.length) {
    const db = new Database(DB_PATH, { readonly: true });
    let files = [];
    try {
      const rows = db.prepare(`SELECT attachments FROM leave_requests WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
      for (const r of rows) {
        try { for (const a of JSON.parse(r.attachments || '[]')) files.push(path.basename(a.path)); } catch { /* bad JSON */ }
      }
    } finally { db.close(); }
    let removed = 0;
    for (const f of files) { try { fs.unlinkSync(path.join(UPLOADS_LEAVE_DIR, f)); removed++; } catch { /* already gone */ } }
    check(files.length === 0 || removed === files.length,
      `attachment files removed (${removed}/${files.length})`);
  }

  for (const id of S.createdUserIds) {
    if (!id) continue;
    const r = await api('DELETE', `/users/${id}`, null, adminToken);
    check(r.status === 200, `deleted seeded user ${id} (status ${r.status})`);
  }
  for (const id of S.createdDeptIds) {
    if (!id) continue;
    const r = await api('DELETE', `/departments/${id}`, null, adminToken);
    check(r.status === 200, `deleted seeded department ${id} (status ${r.status})`);
  }
  const userIds = S.createdUserIds.filter(Boolean);
  const uLeft = userIds.length ? countRows(`SELECT COUNT(*) AS n FROM users WHERE id IN (${userIds.join(',')})`) : 0;
  check(uLeft === 0, 'proof: all seeded users gone');
  const deptIds = S.createdDeptIds.filter(Boolean);
  const dLeft = deptIds.length ? countRows(`SELECT COUNT(*) AS n FROM departments WHERE id IN (${deptIds.join(',')})`) : 0;
  check(dLeft === 0, 'proof: all seeded departments gone');
  if (ids.length) {
    const left = countRows(`SELECT COUNT(*) AS n FROM leave_requests WHERE id IN (${ids.join(',')})`);
    check(left === 0, 'proof: all seeded leave rows cascaded away');
  }
}

async function main() {
  if (!CHROME) throw new Error('no Chrome/Edge found — set CHROME_PATH');
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`dev API not reachable at ${BASE}/api/health`);
  const vite = await fetch(APP_URL).then(r => r.ok).catch(() => false);
  if (!vite) throw new Error(`Vite dev server not reachable at ${APP_URL}`);

  const admin = await login(USERS.admin);
  adminToken = admin.token;
  S.admin = admin.user;
  await seed();

  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-first-run'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  try {
    await phaseRolePlumbing();
    await phaseMyLeave();
    await phaseApprovals();
  } finally {
    await browser.close().catch(() => {});
    await cleanup();
  }
  console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('testLeaveUiSmoke crashed:', err); process.exit(1); });
