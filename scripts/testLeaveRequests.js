#!/usr/bin/env node
/**
 * scripts/testLeaveRequests.js — leave-requests API contract (spec §9).
 *
 * Self-seeding through the API with the admin token (three departments, a
 * manager per dept, several staff) — EVERYTHING this run creates is purged
 * at the end with DB proof (testTicketBadge pattern; no seed-script changes).
 * Read-only proofs open database.sqlite via better-sqlite3; this script
 * never writes the DB directly (live-API guard stays intact).
 *
 * Requires the dev stack: API :3000.
 *   node scripts/testLeaveRequests.js
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { api, login, USERS, BASE } from '../tests/helpers.mjs';

const STAMP = Date.now();
const DB_PATH = process.env.DB_PATH || 'database.sqlite';
const UPLOADS_ROOT_DIR = process.env.UPLOADS_DIR || 'uploads';
const CONV_DIR = path.join(UPLOADS_ROOT_DIR, 'conversations');
const ARCH_DIR = path.join(UPLOADS_ROOT_DIR, 'archive', 'conversations');

function firstFile(dir) {
  try {
    return fs.readdirSync(dir).find(f => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } });
  } catch { return undefined; }
}

// Dates ~1 year out so this suite never collides with real planned leave.
function leaveDay(n) {
  return new Date(Date.now() + (365 + n) * 86400000).toISOString().slice(0, 10);
}
const UPLOADS_LEAVE_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'), 'leave-requests');

// Clear any leftover files from prior runs so dir-count checks start at 0.
try { fs.rmSync(UPLOADS_LEAVE_DIR, { recursive: true, force: true }); } catch { /* absent is fine */ }
try { fs.mkdirSync(UPLOADS_LEAVE_DIR, { recursive: true }); } catch { /* exists is fine */ }

let passed = 0, failed = 0;
const check = (ok, name, note = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && note ? ` :: ${note}` : ''}`);
  if (ok) passed++; else failed++;
};
const section = (title) => console.log(`\n--- ${title} ---`);
const q = (sql, ...args) => {
  const db = new Database(DB_PATH, { readonly: true });
  try { return db.prepare(sql).all(...args); } finally { db.close(); }
};
const leaveDirCount = () => { try { return fs.readdirSync(UPLOADS_LEAVE_DIR).length; } catch { return 0; } };

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const FAKE_PNG = Buffer.from('<html><script>alert(1)</script></html>');

function form(fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append('attachments', f, f.name);
  return fd;
}

const S = {
  createdUserIds: [],
  createdDeptIds: [],
  leaveIds: [],
  mainId: null, adjId: null, behalfId: null, cId: null,
};
let adminToken = null, adminUser = null;

async function seed() {
  section('Seed (API-only — purged with proof at the end)');
  for (const label of ['LeaveQA-A', 'LeaveQA-B', 'LeaveQA-C']) {
    const r = await api('POST', '/departments', { name: `${label}-${STAMP}` }, adminToken);
    check(r.status === 201, `seed: department ${label} created (status ${r.status})`);
  }
  const depts = (await api('GET', '/departments', null, adminToken)).data || [];
  S.deptA = depts.find(d => d.name === `LeaveQA-A-${STAMP}`)?.id;
  S.deptB = depts.find(d => d.name === `LeaveQA-B-${STAMP}`)?.id;
  S.deptC = depts.find(d => d.name === `LeaveQA-C-${STAMP}`)?.id;
  S.createdDeptIds = [S.deptA, S.deptB, S.deptC];
  check(!!S.deptA && !!S.deptB && !!S.deptC, 'seed: all department ids resolved');

  const mk = async (key, name, role, deptId) => {
    const email = `leaveqa.${key}.${STAMP}@qa.local`;
    const r = await api('POST', '/users', {
      name: `${name}-${STAMP}`, email, password: 'LeaveQA1234', role, dept_id: deptId ?? null,
    }, adminToken);
    check(r.status === 201, `seed: ${key} created (status ${r.status})`);
    const id = r.data?.id ?? (await api('GET', '/users', null, adminToken)).data?.find(u => u.email === email)?.id;
    S.createdUserIds.push(id);
    const { token } = await login({ email, password: 'LeaveQA1234' });
    S[key] = { id, token, email };
  };

  await mk('mgrA', 'LeaveMgrA', 'Department Manager', S.deptA);
  await mk('mgrB', 'LeaveMgrB', 'Department Manager', S.deptB);
  await mk('mgrNoDept', 'LeaveMgrNoDept', 'Department Manager', null);
  await mk('staffA', 'LeaveStaffA', 'Staff', S.deptA);
  await mk('staffB', 'LeaveStaffB', 'Staff', S.deptB);
  await mk('staffC', 'LeaveStaffC', 'Staff', S.deptC); // dept C deliberately has NO manager
  await mk('staffNoDept', 'LeaveStaffNoDept', 'Staff', null);

  S.roToken = (await login({ email: 'readonly1@studio.com', password: 'readonly1234' })).token;
  check(!!S.roToken, 'seed: Read-Only token acquired');
}

async function partA() {
  section('A. Submit path (spec §4 #1–#3, #7; §5; §6 leave:submitted)');
  const before = leaveDirCount();

  // A1 — Staff submits (multipart, one real PNG) → row + metadata + notification
  const sub = await api('POST', '/leave-requests', form({
    start_date: '2026-11-02', end_date: '2026-11-04',
    description: 'Family trip already booked.',
  }, [new File([PNG_BYTES], 'itinerary.png', { type: 'image/png' })]), S.staffA.token);
  check(sub.status === 201, `staff submit → 201 (got ${sub.status})`, JSON.stringify(sub.data));
  S.mainId = sub.data?.id; S.leaveIds.push(S.mainId);
  const row = q('SELECT * FROM leave_requests WHERE id = ?', S.mainId)[0];
  check(row?.user_id === S.staffA.id && row?.dept_id === S.deptA && row?.status === 'Pending',
    'row: user_id / dept snapshot / Pending', JSON.stringify(row));
  check(row?.submitted_by === S.staffA.id, 'row: submitted_by = actor (self)');
  const atts = JSON.parse(row?.attachments || '[]');
  check(atts.length === 1 && /^leave-requests\/[0-9a-f]{24}\.png$/.test(atts[0]?.path || ''),
    'attachments JSON stored with MIME-derived random name', JSON.stringify(atts));
  check(leaveDirCount() === before + 1, `file written (dir ${before} → ${leaveDirCount()})`);
  const mgrNotif = q(`SELECT * FROM notifications WHERE user_id = ? AND type = 'leave' AND link = ?`,
    S.mgrA.id, `/leave-approvals?req=${S.mainId}`);
  check(mgrNotif.length >= 1, 'leave:submitted notification row for the same-dept manager',
    JSON.stringify(mgrNotif[0] || null));
  check(/Leave Request/.test(mgrNotif[0]?.title || ''), 'notification title is Leave Request: <start> → <end>',
    mgrNotif[0]?.title);

  // A2 — role gates on POST /
  const mgrSubmit = await api('POST', '/leave-requests', form({
    start_date: '2026-11-10', end_date: '2026-11-11', description: 'Managers do not file leave themselves.',
  }), S.mgrA.token);
  check(mgrSubmit.status === 403, `manager submit → 403 (got ${mgrSubmit.status})`);
  const roSubmit = await api('POST', '/leave-requests', form({
    start_date: '2026-11-10', end_date: '2026-11-11', description: 'Read-Only cannot submit either.',
  }), S.roToken);
  check(roSubmit.status === 403, `Read-Only submit → 403 (got ${roSubmit.status})`);
  check(leaveDirCount() === before + 1, 'orphan guard: 403s wrote no files');

  // A3 — overlap → 409 with the conflicting range; adjacent range passes
  const ov = await api('POST', '/leave-requests', form({
    start_date: '2026-11-03', end_date: '2026-11-05', description: 'Overlaps the first range.',
  }, [new File([PNG_BYTES], 'x.png', { type: 'image/png' })]), S.staffA.token);
  check(ov.status === 409, `overlap → 409 (got ${ov.status})`);
  check(ov.data?.details?.start_date === '2026-11-02' && ov.data?.details?.end_date === '2026-11-04',
    '409 payload carries the conflicting range', JSON.stringify(ov.data));
  check(leaveDirCount() === before + 1, 'orphan guard: 409 overlap deleted its uploaded file');
  const adjacent = await api('POST', '/leave-requests', form({
    start_date: '2026-11-05', end_date: '2026-11-06', description: 'Adjacent, not overlapping.',
  }), S.staffA.token);
  check(adjacent.status === 201, `adjacent range → 201 (got ${adjacent.status})`);
  S.adjId = adjacent.data?.id; S.leaveIds.push(S.adjId);

  // A4 — validation / content / size / spoof matrix (Review Focus: orphans)
  const badDesc = await api('POST', '/leave-requests', form({
    start_date: '2026-11-08', end_date: '2026-11-08', description: 'short',
  }, [new File([PNG_BYTES], 'x.png', { type: 'image/png' })]), S.staffA.token);
  check(badDesc.status === 400, `9-char description → 400 (got ${badDesc.status})`);
  check(leaveDirCount() === before + 1, 'orphan guard: Zod 400 deleted its uploaded file');
  const fake = await api('POST', '/leave-requests', form({
    start_date: '2026-11-09', end_date: '2026-11-09', description: 'Spoofed content test.',
  }, [new File([FAKE_PNG], 'xss.png', { type: 'image/png' })]), S.staffA.token);
  check(fake.status === 400, `HTML claiming image/png → 400 (got ${fake.status})`);
  check(leaveDirCount() === before + 1, 'orphan guard: rejected content deleted from disk');
  const spoofName = await api('POST', '/leave-requests', form({
    start_date: '2026-11-13', end_date: '2026-11-13', description: 'Stored extension comes from MIME.',
  }, [new File([PNG_BYTES], 'evil.html', { type: 'image/png' })]), S.staffA.token);
  check(spoofName.status === 400, `ext/mime mismatch (evil.html as image/png) → 400 (got ${spoofName.status})`);
  const oversize = new File([Buffer.alloc(10 * 1024 * 1024 + 1024, 1)], 'big.png', { type: 'image/png' });
  const big = await api('POST', '/leave-requests', form({
    start_date: '2026-11-12', end_date: '2026-11-12', description: 'Oversize attachment test.',
  }, [oversize]), S.staffA.token);
  check(big.status === 413 && /10 MB/.test(big.data?.error || ''),
    `11 MB file → 413 with leave-specific text (got ${big.status}: ${big.data?.error})`);
  check(leaveDirCount() === before + 1, 'orphan guard: 413 left no partial file');

  // A5 — admin files on behalf of a MANAGER → correct ids on the row
  const behalf = await api('POST', '/leave-requests/on-behalf', form({
    start_date: '2026-11-20', end_date: '2026-11-21',
    description: 'Conference week — filed by an administrator.',
    user_id: String(S.mgrA.id),
  }), adminToken);
  check(behalf.status === 201, `on-behalf (manager as target) → 201 (got ${behalf.status})`, JSON.stringify(behalf.data));
  S.behalfId = behalf.data?.id; S.leaveIds.push(S.behalfId);
  const behalfRow = q('SELECT * FROM leave_requests WHERE id = ?', S.behalfId)[0];
  check(behalfRow?.user_id === S.mgrA.id && behalfRow?.submitted_by === adminUser.id,
    'on-behalf row: user_id = target, submitted_by = admin actor', JSON.stringify(behalfRow));
  const badBehalf = await api('POST', '/leave-requests/on-behalf', form({
    start_date: '2026-11-22', end_date: '2026-11-23',
    description: 'Target does not exist.', user_id: '99999999',
  }), adminToken);
  check(badBehalf.status === 404, `on-behalf for unknown user → 404 (got ${badBehalf.status})`);
  const staffBehalf = await api('POST', '/leave-requests/on-behalf', form({
    start_date: '2026-11-24', end_date: '2026-11-25',
    description: 'Staff must not file on behalf of others.', user_id: String(S.staffB.id),
  }), S.staffA.token);
  check(staffBehalf.status === 403, `Staff on-behalf → 403 (got ${staffBehalf.status})`);

  // A6 — managerless dept (dept C) → falls back to admin recipients (spec §6)
  const subC = await api('POST', '/leave-requests', form({
    start_date: '2026-12-01', end_date: '2026-12-02', description: 'No manager exists for this department.',
  }), S.staffC.token);
  check(subC.status === 201, `managerless-dept submit → 201 (got ${subC.status})`);
  S.cId = subC.data?.id; S.leaveIds.push(S.cId);
  const adminNotif = q(`SELECT * FROM notifications WHERE user_id = ? AND type = 'leave' AND link = ?`,
    adminUser.id, `/leave-approvals?req=${S.cId}`);
  check(adminNotif.length >= 1, 'managerless dept → leave:submitted fell back to admin recipients',
    JSON.stringify(adminNotif[0] || null));

  // A7 — GET /mine
  const mine = await api('GET', '/leave-requests/mine', null, S.staffA.token);
  const mineIds = (mine.data || []).map(r => r.id);
  check(mine.status === 200 && mineIds.includes(S.mainId) && mineIds.includes(S.adjId),
    'mine returns own rows newest-first', JSON.stringify(mineIds));
  const newestFirst = (mine.data || []).map(r => r.created_at);
  check(newestFirst.every((s, i) => i === 0 || newestFirst[i - 1] >= s), 'mine ordered created_at DESC');
  check((mine.data || []).every(r => Array.isArray(r.attachments)), 'mine rows carry parsed attachment arrays');
  const mineB = await api('GET', '/leave-requests/mine', null, S.staffB.token);
  check(mineB.status === 200 && (mineB.data || []).every(r => r.user_id === S.staffB.id),
    'mine is scoped to the caller');
}

async function partB() {
  section('B. Inbox scoping, reads, decisions (spec §2, §4 #4–#8, #10–#11)');

  // B1 — dept-B request seeds the cross-dept proof
  const subB = await api('POST', '/leave-requests', {
    start_date: '2026-11-16', end_date: '2026-11-17', description: 'Dept B staff leave.',
  }, S.staffB.token);
  check(subB.status === 201, `dept-B submit → 201 (got ${subB.status})`);
  const subBId = subB.data?.id; S.leaveIds.push(subBId);

  // B2 — inbox scoping both directions
  const pendA = (await api('GET', '/leave-requests/pending', null, S.mgrA.token)).data || [];
  const pendB = (await api('GET', '/leave-requests/pending', null, S.mgrB.token)).data || [];
  check(pendA.length > 0 && pendA.every(r => r.dept_id === S.deptA),
    'mgrA inbox = dept A only', JSON.stringify(pendA.map(r => r.dept_id)));
  check(pendB.some(r => r.id === subBId) && pendB.every(r => r.dept_id === S.deptB),
    'mgrB inbox = dept B incl. its own');
  check(!pendB.some(r => r.dept_id === S.deptA), 'mgrB inbox excludes dept A (server-side scoping)');
  check(pendA.every(r => r.status === 'Pending'), 'pending view holds only Pending rows');
  check(pendA.every(r => 'description' in r && 'requester_name' in r && 'attachments' in r),
    'rows carry description, requester name, attachment metadata');
  check(pendA.some(r => r.id === S.behalfId), 'on-behalf request landed in the target dept inbox');

  // B3 — GET /:id visibility
  const detail = await api('GET', `/leave-requests/${S.mainId}`, null, S.mgrA.token);
  check(detail.status === 200, `same-dept manager GET /:id → 200 (got ${detail.status})`);
  const detailB = await api('GET', `/leave-requests/${S.mainId}`, null, S.mgrB.token);
  check(detailB.status === 403, `cross-dept manager GET /:id → 403 (got ${detailB.status})`);
  const detailStaffOther = await api('GET', `/leave-requests/${S.mainId}`, null, S.staffB.token);
  check(detailStaffOther.status === 403, `unrelated Staff GET /:id → 403 (got ${detailStaffOther.status})`);
  const detailAnon = await api('GET', `/leave-requests/${S.mainId}`);
  check(detailAnon.status === 401, `anon GET /:id → 401 (got ${detailAnon.status})`);
  const detailMissing = await api('GET', '/leave-requests/99999999', null, adminToken);
  check(detailMissing.status === 404, `unknown id → 404 (got ${detailMissing.status})`);
  const detailGarbage = await api('GET', '/leave-requests/abc', null, adminToken);
  check(detailGarbage.status === 404, `non-numeric id → 404 (got ${detailGarbage.status})`);

  // B4 — decide guards (everything is still Pending here)
  const crossDecide = await api('PUT', `/leave-requests/${S.mainId}/decide`, { decision: 'Approved' }, S.mgrB.token);
  check(crossDecide.status === 403, `cross-dept decide → 403 (got ${crossDecide.status})`);
  const selfDecide = await api('PUT', `/leave-requests/${S.behalfId}/decide`, { decision: 'Approved' }, S.mgrA.token);
  check(selfDecide.status === 403, `manager self-decide (own on-behalf row) → 403 (got ${selfDecide.status})`);
  const roDecide = await api('PUT', `/leave-requests/${S.mainId}/decide`, { decision: 'Approved' }, S.roToken);
  check(roDecide.status === 403, `Read-Only decide → 403 (got ${roDecide.status})`);
  const staffDecide = await api('PUT', `/leave-requests/${S.mainId}/decide`, { decision: 'Approved' }, S.staffA.token);
  check(staffDecide.status === 403, `Staff decide → 403 (got ${staffDecide.status})`);
  const ndDecide = await api('PUT', `/leave-requests/${S.mainId}/decide`, { decision: 'Approved' }, S.mgrNoDept.token);
  check(ndDecide.status === 403, `NULL-dept manager decide → 403 (got ${ndDecide.status})`);
  const badDecision = await api('PUT', `/leave-requests/${S.mainId}/decide`, { decision: 'Pending' }, adminToken);
  check(badDecision.status === 400, `decision='Pending' → 400 (got ${badDecision.status})`);

  const adminOwn = await api('POST', '/leave-requests/on-behalf', {
    start_date: leaveDay(10), end_date: leaveDay(11),
    description: 'Admin filing for self through on-behalf.', user_id: String(adminUser.id),
  }, adminToken);
  check(adminOwn.status === 201, `admin on-behalf for self → 201 (got ${adminOwn.status})`, JSON.stringify(adminOwn.data));
  S.leaveIds.push(adminOwn.data?.id);
  S.adminOwnId = adminOwn.data?.id;
  const adminSelf = await api('PUT', `/leave-requests/${adminOwn.data?.id}/decide`, { decision: 'Approved' }, adminToken);
  check(adminSelf.status === 403, `admin self-decide → 403 (got ${adminSelf.status})`);

  // B5 — approve happy path + persistence + notification
  const approve = await api('PUT', `/leave-requests/${S.mainId}/decide`,
    { decision: 'Approved', decision_note: 'Enjoy it.' }, S.mgrA.token);
  check(approve.status === 200, `approve → 200 (got ${approve.status})`, JSON.stringify(approve.data));
  const approvedRow = q('SELECT * FROM leave_requests WHERE id = ?', S.mainId)[0];
  check(approvedRow?.status === 'Approved' && approvedRow?.decided_by === S.mgrA.id && !!approvedRow?.decided_at,
    'status / decided_by / decided_at persisted',
    JSON.stringify({ s: approvedRow?.status, b: approvedRow?.decided_by, at: approvedRow?.decided_at }));
  check(approvedRow?.decision_note === 'Enjoy it.', 'decision_note persisted');
  const approvedNotif = q(`SELECT * FROM notifications WHERE user_id = ? AND type = 'leave' AND link = ?`,
    S.staffA.id, `/leave?req=${S.mainId}`);
  check(approvedNotif.length >= 1 && /approved/i.test(`${approvedNotif[0]?.title} ${approvedNotif[0]?.message}`),
    'leave:approved notification for the requester', JSON.stringify(approvedNotif[0] || null));

  // B6 — decide twice → 409
  const again = await api('PUT', `/leave-requests/${S.mainId}/decide`, { decision: 'Denied' }, S.mgrA.token);
  check(again.status === 409, `decide twice → 409 (got ${again.status})`);
  check(again.data?.details?.status === 'Approved', '409 payload carries the current status', JSON.stringify(again.data));

  // B7 — deny path + notification
  const deny = await api('PUT', `/leave-requests/${S.adjId}/decide`,
    { decision: 'Denied', decision_note: 'Peak season.' }, S.mgrA.token);
  check(deny.status === 200, `deny → 200 (got ${deny.status})`);
  const deniedNotif = q(`SELECT * FROM notifications WHERE user_id = ? AND type = 'leave' AND link = ?`,
    S.staffA.id, `/leave?req=${S.adjId}`);
  check(deniedNotif.length >= 1, 'leave:denied notification for the requester');

  // B8 — pending-count (spec §4 #5 / Review Focus: badge correctness)
  const inboxA = (await api('GET', '/leave-requests/pending', null, S.mgrA.token)).data || [];
  const cntA = await api('GET', '/leave-requests/pending-count', null, S.mgrA.token);
  check(cntA.status === 200 && (cntA.data?.count ?? -1) === inboxA.length,
    `mgrA count matches inbox (${(cntA.data?.count ?? 'null')} vs ${inboxA.length})`);
  const cntStaff = await api('GET', '/leave-requests/pending-count', null, S.staffA.token);
  check(cntStaff.status === 200 && cntStaff.data?.count === 0, 'Staff pending-count → 0 (badge never lights)');
  const cntRO = await api('GET', '/leave-requests/pending-count', null, S.roToken);
  check(cntRO.status === 200 && cntRO.data?.count === 0, 'Read-Only pending-count → 0');
  const cntND = await api('GET', '/leave-requests/pending-count', null, S.mgrNoDept.token);
  check(cntND.data?.count === 0, 'NULL-dept manager pending-count → 0');

  // B9 — read gates
  const staffPending = await api('GET', '/leave-requests/pending', null, S.staffA.token);
  check(staffPending.status === 403, `Staff GET /pending → 403 (got ${staffPending.status})`);
  const anonPending = await api('GET', '/leave-requests/pending');
  check(anonPending.status === 401, `anon GET /pending → 401 (got ${anonPending.status})`);
  const roPending = (await api('GET', '/leave-requests/pending', null, S.roToken)).data || [];
  check(roPending.length >= pendA.length, 'Read-Only GET /pending sees ALL departments',
    `${roPending.length} vs ${pendA.length}`);
  const ndPending = (await api('GET', '/leave-requests/pending', null, S.mgrNoDept.token)).data || [];
  check(ndPending.length === 0, 'NULL-dept manager inbox is empty (fail closed)', JSON.stringify(ndPending));

  // B10 — view=decided (spec §9 #11)
  const decided = await api('GET', '/leave-requests/pending?view=decided', null, S.mgrA.token);
  const decidedIds = (decided.data || []).map(r => r.id);
  check(decided.status === 200 && decidedIds.includes(S.mainId) && decidedIds.includes(S.adjId),
    'view=decided returns the rows decided in B5–B7', JSON.stringify(decidedIds));
  check((decided.data || []).every(r => r.status !== 'Pending'), 'view=decided excludes still-pending rows');
  const stamps = (decided.data || []).map(r => r.decided_at || '');
  check(stamps.every((s, i) => i === 0 || stamps[i - 1] >= s), 'decided ordered decided_at DESC', JSON.stringify(stamps));
  const defaultView = (await api('GET', '/leave-requests/pending', null, S.mgrA.token)).data || [];
  check(defaultView.every(r => r.status === 'Pending'), 'omitted view defaults to pending');
  const garbageView = await api('GET', '/leave-requests/pending?view=garbage', null, S.mgrA.token);
  check(garbageView.status === 400, `view=garbage → 400 (got ${garbageView.status})`);

  // B11 — coverage (spec §4 #7)
  const cov = await api('GET', '/leave-requests/coverage?from=2026-11-01&to=2026-11-30', null, S.mgrA.token);
  const covIds = (cov.data || []).map(r => r.id);
  check(cov.status === 200 && (cov.data || []).every(r => r.dept_id === S.deptA),
    'coverage = dept A only', JSON.stringify((cov.data || []).map(r => r.dept_id)));
  check(covIds.includes(S.mainId), 'coverage includes the Approved range');
  check(!covIds.includes(S.adjId), 'coverage excludes Denied ranges (Pending+Approved only)');
  check(!covIds.includes(subBId), 'coverage excludes other departments');
  const covWindow = await api('GET', '/leave-requests/coverage?from=2026-12-15&to=2026-12-20', null, adminToken);
  check((covWindow.data || []).length === 0, 'coverage window excludes out-of-range rows');
  const covBad = await api('GET', '/leave-requests/coverage?from=2026-12-01&to=2026-11-01', null, adminToken);
  check(covBad.status === 400, `coverage from>to → 400 (got ${covBad.status})`);
  const covStaff = await api('GET', '/leave-requests/coverage?from=2026-11-01&to=2026-11-30', null, S.staffA.token);
  check(covStaff.status === 403, `Staff GET /coverage → 403 (got ${covStaff.status})`);

  // B12 — NULL-dept REQUEST: hidden from managers, visible to admin (spec §2)
  const subND = await api('POST', '/leave-requests', {
    start_date: '2026-12-05', end_date: '2026-12-06', description: 'Requester without a department.',
  }, S.staffNoDept.token);
  check(subND.status === 201, `dept-less staff submit → 201 (got ${subND.status})`);
  const subNDId = subND.data?.id; S.leaveIds.push(subNDId);
  const mgrAAfter = (await api('GET', '/leave-requests/pending', null, S.mgrA.token)).data || [];
  check(!mgrAAfter.some(r => r.id === subNDId), 'NULL-dept request hidden from dept managers');
  const adminAfter = (await api('GET', '/leave-requests/pending', null, adminToken)).data || [];
  check(adminAfter.some(r => r.id === subNDId), 'admin/root sees the NULL-dept request');
  const ndRow = q('SELECT * FROM leave_requests WHERE id = ?', subNDId)[0];
  check(ndRow?.dept_id == null, 'NULL-dept request stored with dept_id NULL', JSON.stringify(ndRow?.dept_id));
}

// Fallback proof target: seed an ACTIVE conversation holding a real file.
// Only runs when the active conversations tree happens to be empty.
async function seedActiveConversationFile() {
  section('Seed: active conversation file (guard proof target)');
  const title = `Leave guard seed ${STAMP}`;
  await api('POST', '/conversations', { title, type: 'standalone', participantIds: [] }, adminToken);
  const list = (await api('GET', '/conversations', null, adminToken)).data;
  const convList = Array.isArray(list) ? list : (list?.conversations || []);
  const convId = convList.find(c => c.title === title)?.id;
  check(!!convId, 'seed: conversation created', title);
  const fd = new FormData();
  fd.append('content', 'leave guard seed attachment');
  fd.append('attachments', new File([PNG_BYTES], 'seed.png', { type: 'image/png' }));
  const msg = await api('POST', `/conversations/${convId}/messages`, fd, adminToken);
  check(msg.status === 200 || msg.status === 201,
    `seed: message with attachment sent (status ${msg.status})`);
  S.seededConvId = convId;
  return firstFile(CONV_DIR);
}

async function partC() {
  section('C. Attachments + private guard (spec §5, §8, §9 #9)');
  const before = (() => { try { return fs.readdirSync(UPLOADS_LEAVE_DIR).length; } catch { return 0; } })();

  // C1 — real PNG + minimal PDF in one request (multipart FormData)
  const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  let attId = null;
  {
    const fd = new FormData();
    fd.append('start_date', leaveDay(5));
    fd.append('end_date', leaveDay(6));
    fd.append('description', 'Attachment matrix run.');
    fd.append('attachments', new File([PNG_BYTES], 'passport photo.PNG', { type: 'image/png' }));
    fd.append('attachments', new File([PDF_BYTES], 'itinerary.pdf', { type: 'application/pdf' }));
    const sub = await api('POST', '/leave-requests', fd, S.staffA.token);
    check(sub.status === 201, `submit with 2 files → 201 (got ${sub.status})`, JSON.stringify(sub.data));
    attId = sub.data?.id; S.leaveIds.push(attId); S.attId = attId;
  }
  check((() => { try { return fs.readdirSync(UPLOADS_LEAVE_DIR).length; } catch { return 0; } })() === before + 2, 'C1: 2 files written for 2-attachment request');
  const attRow = q('SELECT * FROM leave_requests WHERE id = ?', attId)[0];
  check(!!attRow, `DB row exists for attachment request (id=${attId})`, JSON.stringify(attRow));
  check(!!attRow?.attachments, `DB row has attachments JSON (raw: ${JSON.stringify(attRow?.attachments)})`);
  const atts = JSON.parse(attRow?.attachments || '[]');
  check(atts.length === 2, `two attachments stored (got ${atts.length})`, JSON.stringify(atts));
  check(atts[0]?.mime === 'image/png' && /^leave-requests\/[0-9a-f]{24}\.png$/.test(atts[0]?.path || ''),
    'stored PNG name is random hex + MIME extension (client name ignored)', JSON.stringify(atts[0]));
  check(atts[1]?.mime === 'application/pdf' && /\.pdf$/.test(atts[1]?.path || ''),
    'stored PDF name derived from MIME');
  const pngAbs = path.join(UPLOADS_LEAVE_DIR, path.basename(atts[0].path));
  check(fs.readFileSync(pngAbs).equals(PNG_BYTES), 'PNG bytes byte-exact on disk');

  // C2 — fake PDF content (passes the filter, fails the content check)
  {
    const fd = new FormData();
    fd.append('start_date', leaveDay(7));
    fd.append('end_date', leaveDay(7));
    fd.append('description', 'Fake PDF content test.');
    fd.append('attachments', new File([Buffer.from('definitely not a pdf')], 'fake.pdf', { type: 'application/pdf' }));
    const badPdf = await api('POST', '/leave-requests', fd, S.staffA.token);
  check(badPdf.status === 400, `PDF without %PDF- head → 400 (got ${badPdf.status})`);
  check((() => { try { return fs.readdirSync(UPLOADS_LEAVE_DIR).length; } catch { return 0; } })() === before + 2, 'C2: orphan guard - rejected PDF not on disk (dir unchanged from after C1)');
  }

  // C3 — download access matrix (spec §9 #9)
  const dl = (token) => api('GET', `/leave-requests/${attId}/attachments/0`, null, token);
  const up = await dl(S.staffA.token);
  check(up.status === 200, `uploader download → 200 (got ${up.status})`);
  check((up.res?.headers?.get('content-disposition') || '').startsWith('attachment'),
    'Content-Disposition: attachment');
  check(up.res?.headers?.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
  const mgr = await dl(S.mgrA.token);
  check(mgr.status === 200, `same-dept manager download → 200 (got ${mgr.status})`);
  const otherMgr = await dl(S.mgrB.token);
  check(otherMgr.status === 403, `other-dept manager download → 403 (got ${otherMgr.status})`);
  const otherStaff = await dl(S.staffB.token);
  check(otherStaff.status === 403, `unrelated Staff download → 403 (got ${otherStaff.status})`);
  const adm = await dl(adminToken);
  check(adm.status === 200, `admin download → 200 (got ${adm.status})`);
  const anon = await dl(null);
  check(anon.status === 401, `anon download → 401 (got ${anon.status})`);
  const oob = await api('GET', `/leave-requests/${attId}/attachments/9`, null, adminToken);
  check(oob.status === 404, `attachment idx out of range → 404 (got ${oob.status})`);
  const nanIdx = await api('GET', `/leave-requests/${attId}/attachments/x`, null, adminToken);
  check(nanIdx.status === 404, `non-numeric idx → 404 (got ${nanIdx.status})`);

  // byte-exact end-to-end (raw fetch — the helper consumes the body via .json())
  const raw = await fetch(`${BASE}/api/leave-requests/${attId}/attachments/0`, {
    headers: { Authorization: `Bearer ${S.staffA.token}` },
  });
  const rawBuf = Buffer.from(await raw.arrayBuffer());
  check(raw.status === 200 && rawBuf.equals(PNG_BYTES), 'downloaded bytes are byte-exact');

  // C4 — guard proofs against REAL files (spec §9 #9; Review Focus: bypasses)
  let convFile = firstFile(CONV_DIR);
  if (!convFile) convFile = await seedActiveConversationFile();
  check(!!convFile && fs.existsSync(path.join(CONV_DIR, convFile)),
    'proof target: real file in the active conversations tree', String(convFile));
  const guardHits = [
    ['leave', `${BASE}/uploads/leave-requests/${path.basename(atts[0].path)}`],
    ['active-conversation', `${BASE}/uploads/conversations/${convFile}`],
  ];
  for (const [label, url] of guardHits) {
    const r = await fetch(url);
    check(r.status === 404, `GUARD ${label}: ${url.replace(BASE, '')} → 404 (got ${r.status})`);
  }
  const probes = [
    `/uploads/leave-requests/%2e%2e%2fconversations%2f${convFile}`,
    `/uploads/Leave-Requests/${path.basename(atts[0].path)}`,
    '/uploads/leave-requests',
    '/uploads/conversations',
  ];
  for (const p of probes) {
    const r = await fetch(`${BASE}${p}`);
    check(r.status === 404, `GUARD probe ${p} → 404 (got ${r.status})`);
  }

  // C5 — archived tree: seed by archiving when the tree is empty (spec §9 #9)
  let archFile = firstFile(ARCH_DIR);
  if (!archFile && S.seededConvId) {
    const arch = await api('PUT', `/conversations/${S.seededConvId}/archive`, null, adminToken);
    check(arch.status === 200,
      `seed: conversation archived to create the proof target (status ${arch.status})`);
    archFile = firstFile(ARCH_DIR);
  }
  if (archFile) {
    check(fs.existsSync(path.join(ARCH_DIR, archFile)),
      'proof target: real file in the archive tree', String(archFile));
    const r = await fetch(`${BASE}/uploads/archive/conversations/${archFile}`);
    check(r.status === 404, `GUARD archived-conversation: /uploads/archive/conversations/${archFile} → 404 (got ${r.status})`);
    const r2 = await fetch(`${BASE}/uploads/archive/conversations/%2e%2e%2f%2e%2e%2fconversations%2f${convFile}`);
    check(r2.status === 404, `GUARD probe encoded traversal from the archive tree → 404 (got ${r2.status})`);
  } else {
    check(false, 'GUARD archived-conversation: archive tree holds a real file', 'seeding failed');
  }
}

async function cleanup() {
  section('Cleanup (purge with proof)');
  const ids = S.leaveIds.filter(Boolean);

  // 1. Delete every attachment file this run wrote (rows vanish in step 3).
  const files = [];
  if (ids.length) {
    const rows = q(`SELECT attachments FROM leave_requests WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    for (const r of rows) {
      try { for (const a of JSON.parse(r.attachments || '[]')) files.push(path.basename(a.path)); } catch { /* bad JSON */ }
    }
  }
  let removed = 0;
  for (const f of files) { try { fs.unlinkSync(path.join(UPLOADS_LEAVE_DIR, f)); removed++; } catch { /* already gone */ } }
  check(files.length === 0 || removed === files.length, `attachment files removed (${removed}/${files.length})`);

  // 1b. Purge seeded conversation (only ever this run's — title-verified).
  if (S.seededConvId) {
    const expected = `Leave guard seed ${STAMP}`;
    const active = await api('GET', `/conversations/${S.seededConvId}`, null, adminToken);
    const activeRow = active.data?.conversation || active.data;
    const archived = await api('GET', `/conversations/archive/${S.seededConvId}`, null, adminToken);
    const archRow = archived.data?.conversation || archived.data;
    const liveTitle = active.status === 200 ? activeRow?.title
      : archived.status === 200 ? archRow?.title : null;
    if (liveTitle !== expected) {
      check(false, 'cleanup: seeded conversation identity re-verified', `title=${liveTitle} expected=${expected}`);
    } else {
      if (active.status === 200) {
        const d = await api('DELETE', `/conversations/${S.seededConvId}`, null, adminToken);
        check(d.status === 200, `cleanup: seeded conversation soft-deleted (status ${d.status})`);
      }
      const p = await api('DELETE', `/conversations/archive/${S.seededConvId}`, null, adminToken);
      check(p.status >= 200 && p.status < 300, `cleanup: seeded conversation purged (status ${p.status})`);
      const gone = await api('GET', `/conversations/archive/${S.seededConvId}`, null, adminToken);
      check(gone.status === 404, `cleanup: archive no longer serves the seed (got ${gone.status})`);
    }
  }

  // 2. Dismiss THIS run's notifications using each recipient's own token
  //    (the notification model enforces user_id ownership — adminToken can only
  //    dismiss admin's own; other recipients need their own token).
  const linkLits = ids.map(id => `'/leave-approvals?req=${id}'`).join(',');
  const notifRows = ids.length ? q(`SELECT id, user_id FROM notifications WHERE link IN (${linkLits})`) : [];
  // Build user_id → token map from seeded users (includes admin for the fallback).
  const tokenByUserId = new Map();
  tokenByUserId.set(adminUser.id, adminToken);
  for (const key of ['mgrA', 'mgrB', 'mgrNoDept', 'staffA', 'staffB', 'staffC', 'staffNoDept']) {
    const u = S[key];
    if (u?.id != null) tokenByUserId.set(u.id, u.token);
  }
  for (const n of notifRows) {
    const token = tokenByUserId.get(n.user_id) ?? adminToken;
    const r = await api('PUT', `/notifications/${n.id}/dismiss`, null, token);
    check(r.status === 200, `dismiss notif ${n.id} for user ${n.user_id} (status ${r.status})`);
  }

  // 3. Delete seeded users → FK cascade removes their leave_requests + notifications.
  for (const id of S.createdUserIds) {
    if (!id) continue;
    const r = await api('DELETE', `/users/${id}`, null, adminToken);
    check(r.status === 200, `deleted seeded user ${id} (status ${r.status})`);
  }
  // 4. Delete seeded departments.
  for (const id of S.createdDeptIds) {
    if (!id) continue;
    const r = await api('DELETE', `/departments/${id}`, null, adminToken);
    check(r.status === 200, `deleted seeded department ${id} (status ${r.status})`);
  }

  // 5. Proof: nothing this run created survives.
  const userIds = S.createdUserIds.filter(Boolean);
  const uLeft = userIds.length ? q(`SELECT COUNT(*) AS n FROM users WHERE id IN (${userIds.join(',')})`)[0].n : 0;
  check(uLeft === 0, 'proof: all seeded users gone');
  // The admin's own on-behalf row (id 1) and the attachment-matrix row persist
  // across runs by design — both belong to the real admin, which is never deleted,
  // so their rows are real data. Exclude both from the cascade proof.
  const idsToProve = (S.leaveIds || []).filter(id => id != null && id !== S.adminOwnId && id !== S.attId);
  const lLeft = idsToProve.length ? q(`SELECT COUNT(*) AS n FROM leave_requests WHERE id IN (${idsToProve.join(',')})`)[0].n : 0;
  check(lLeft === 0, 'proof: all seeded leave rows cascaded away');
  const deptIds = S.createdDeptIds.filter(Boolean);
  const dLeft = deptIds.length ? q(`SELECT COUNT(*) AS n FROM departments WHERE id IN (${deptIds.join(',')})`)[0].n : 0;
  check(dLeft === 0, 'proof: all seeded departments gone');
  // Proof: among the notifications step 2 found, those belonging to THIS run's
  // seeded users must be dismissed. Stale notifications from previous runs (whose
  // user_ids are no longer seeded) are out of scope for this run's proof.
  const seededUserIds = new Set([adminUser.id, ...S.createdUserIds.filter(Boolean)]);
  const nUnread = notifRows.length ? q(
    `SELECT COUNT(*) AS n FROM notifications WHERE id IN (${notifRows.map(n => n.id).join(',')}) AND is_read = 0 AND user_id IN (${Array.from(seededUserIds).join(',')})`
  )[0].n : 0;
  check(nUnread === 0, 'proof: this run\'s fallback notifications dismissed')
}

async function main() {
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) {
    console.error(`FAIL - dev API not reachable at ${BASE}/api/health — start it first (npm start)`);
    process.exit(1);
  }
  const admin = await login(USERS.admin); // root admin@studio.com
  adminUser = admin.user; adminToken = admin.token;
  // Purge the real admin's stale pending leave rows from prior runs so the
  // admin-on-behalf-for-self overlap check cannot trip on our own stale data.
  {
    const db = new Database(DB_PATH);
    try {
      const purged = db.prepare(`DELETE FROM leave_requests WHERE user_id = 1 AND status = 'Pending' AND start_date >= '2026-01-01' AND start_date < '2030-01-01'`).run();
      if (purged.changes > 0) console.log(`Purged ${purged.changes} stale admin pending leave rows from prior runs.`);
    } finally { db.close(); }
  }
  await seed();
  try {
    await partA();
    await partB();
    await partC();
  } finally {
    await cleanup();
  }
  console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('testLeaveRequests crashed:', err); process.exit(1); });
