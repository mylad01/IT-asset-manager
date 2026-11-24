#!/usr/bin/env node
/**
 * scripts/testLeaveContract.js — leave-requests schema ⇄ validator contract.
 * No server needed: reads the CHECK literals straight from sqlite_master
 * (repo convention: scripts/testConversationTypeContract.js) and exercises
 * the Zod schemas + role plumbing as pure imports.
 * Run:  node scripts/testLeaveContract.js
 */
import Database from 'better-sqlite3';
import { LEAVE_STATUSES, LEAVE_DECISIONS, createLeaveSchema, onBehalfSchema, decideSchema, coverageQuerySchema, pendingQuerySchema } from '../server/validators/leaveRequestValidator.js';
import { createUserSchema } from '../server/validators/userValidator.js';
import { ROLES } from '../server/utils/helpers.js';
import { requireLeaveSubmitter, requireLeaveApprover, requireLeaveReader } from '../server/middleware/authMiddleware.js';
import { sectionsVisibleToRole, canSeeSection } from '../shared/preferencesRegistry.js';

let passed = 0, failed = 0;
const check = (ok, name, note = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && note ? ` :: ${note}` : ''}`);
  if (ok) passed++; else failed++;
};
const rejects = (schema, value, name) => {
  const r = schema.safeParse(value);
  check(!r.success, name, r.success ? 'unexpectedly accepted' : '');
};
const accepts = (schema, value, name) => {
  const r = schema.safeParse(value);
  check(r.success, name, r.success ? '' : JSON.stringify(r.error.issues));
};

// ── 1. Vocabulary ⇄ DB CHECK literals ──
{
  const db = new Database(process.env.DB_PATH || 'database.sqlite', { readonly: true });
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='leave_requests'`).get();
  db.close();
  if (!row) {
    check(false, 'leave_requests table exists (run `npm run db:migrate` first)');
  } else {
    const m = /CHECK\s*\(\s*status\s+IN\s*\(([^)]+)\)\)/i.exec(row.sql);
    const literals = m ? (m[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)) : [];
    check(JSON.stringify(literals) === JSON.stringify(LEAVE_STATUSES),
      'LEAVE_STATUSES equals the status CHECK literals exactly', JSON.stringify({ literals, LEAVE_STATUSES }));
  }
  check(JSON.stringify(LEAVE_DECISIONS) === JSON.stringify(['Approved', 'Denied']),
    "LEAVE_DECISIONS is ['Approved','Denied']");
  check(JSON.stringify(LEAVE_DECISIONS) === JSON.stringify(LEAVE_STATUSES.filter(s => s !== 'Pending')),
    "LEAVE_DECISIONS === LEAVE_STATUSES − 'Pending'");
}

// ── 2. Date + range schema behaviour ──
accepts(createLeaveSchema, { start_date: '2026-11-02', end_date: '2026-11-04', description: 'Valid description.' }, 'valid create accepted');
accepts(createLeaveSchema, { start_date: '2028-02-29', end_date: '2028-02-29', description: 'Leap day is a real date.' }, 'leap day 2028-02-29 accepted');
rejects(createLeaveSchema, { start_date: '2026-02-30', end_date: '2026-03-01', description: 'Impossible calendar date.' }, '2026-02-30 rejected');
rejects(createLeaveSchema, { start_date: '2026-02-29', end_date: '2026-03-01', description: 'Non-leap Feb 29.' }, 'non-leap 2026-02-29 rejected');
rejects(createLeaveSchema, { start_date: '13-11-2026', end_date: '2026-11-14', description: 'Wrong date format.' }, 'non-ISO format rejected');
rejects(createLeaveSchema, { start_date: '2026-11-05', end_date: '2026-11-04', description: 'End before start.' }, 'end < start rejected');
rejects(createLeaveSchema, { start_date: '2026-11-05', end_date: '2026-11-05', description: 'too short' }, 'description < 10 chars rejected');
rejects(createLeaveSchema, { start_date: '2026-11-05', end_date: '2026-11-05', description: 'x'.repeat(2001) }, 'description > 2000 chars rejected');
accepts(createLeaveSchema, { start_date: '2026-11-05', end_date: '2026-11-05', description: 'x'.repeat(10) }, 'description of exactly 10 chars accepted');

// ── 3. on-behalf / decide / query schemas ──
accepts(onBehalfSchema, { start_date: '2026-11-05', end_date: '2026-11-06', description: 'Filed by an administrator.', user_id: '7' }, 'on-behalf with string user_id coerces');
const coerced = onBehalfSchema.parse({ start_date: '2026-11-05', end_date: '2026-11-06', description: 'Filed by an administrator.', user_id: '7' });
check(coerced.user_id === 7 && typeof coerced.user_id === 'number', 'user_id coerced to number', JSON.stringify(coerced.user_id));
rejects(onBehalfSchema, { start_date: '2026-11-05', end_date: '2026-11-06', description: 'Filed by an administrator.' }, 'on-behalf without user_id rejected');
rejects(onBehalfSchema, { start_date: '2026-11-05', end_date: '2026-11-06', description: 'Filed by an administrator.', user_id: -3 }, 'negative user_id rejected');
accepts(decideSchema, { decision: 'Approved' }, 'decide Approved accepted');
accepts(decideSchema, { decision: 'Denied', decision_note: 'Peak season.' }, 'decide Denied + note accepted');
rejects(decideSchema, { decision: 'Pending' }, "decision 'Pending' rejected");
rejects(decideSchema, { decision: 'Approved', decision_note: 'n'.repeat(501) }, 'decision_note > 500 rejected');
accepts(coverageQuerySchema, { from: '2026-11-01', to: '2026-11-30' }, 'coverage window accepted');
rejects(coverageQuerySchema, { from: '2026-12-01', to: '2026-11-01' }, 'coverage from > to rejected');
accepts(pendingQuerySchema, {}, 'pending default view accepted');
check(pendingQuerySchema.parse({}).view === 'pending', "default view === 'pending'");
rejects(pendingQuerySchema, { view: 'garbage' }, 'view=garbage rejected');

// ── 4. Role plumbing ──
check(ROLES.DEPARTMENT_MANAGER === 'Department Manager', 'ROLES.DEPARTMENT_MANAGER exact string');
accepts(createUserSchema, { name: 'Mia Manager', email: 'm@qa.local', role: 'Department Manager', password: '12345678', dept_id: '3' }, 'createUser accepts Department Manager');
rejects(createUserSchema, { name: 'X', email: 'x@qa.local', role: 'Janitor', password: '12345678' }, 'unknown role still rejected');
const visible = sectionsVisibleToRole('Department Manager');
check(visible.length === 6 && visible.includes('appearance') && visible.includes('accessibility'),
  'manager sees all six user-scope Settings sections', JSON.stringify(visible));
check(canSeeSection('Department Manager', 'branding') === false, 'branding stays admin-only');
check(canSeeSection('Janitor', 'appearance') === false, 'unknown role fails closed');

// ── 5. Route guards (role gate only — dept scoping lives in the service) ──
const callGuard = (guard, user) => {
  let status = 0;
  const res = { status: (s) => { status = s; return res; }, json: () => res };
  guard({ user }, res, () => { status = 200; });
  return status;
};
check(callGuard(requireLeaveSubmitter, { role: 'Staff' }) === 200, 'Staff may submit');
check(callGuard(requireLeaveSubmitter, { role: 'IT Admin' }) === 200, 'IT Admin may submit');
check(callGuard(requireLeaveSubmitter, { isRoot: true, role: 'IT Admin' }) === 200, 'root may submit');
check(callGuard(requireLeaveSubmitter, { role: 'Department Manager' }) === 403, 'manager submit → 403');
check(callGuard(requireLeaveSubmitter, { role: 'Read-Only' }) === 403, 'Read-Only submit → 403');
check(callGuard(requireLeaveApprover, { role: 'Department Manager' }) === 200, 'manager may decide');
check(callGuard(requireLeaveApprover, { role: 'IT Admin' }) === 200, 'IT Admin may decide');
check(callGuard(requireLeaveApprover, { role: 'Read-Only' }) === 403, 'Read-Only decide → 403');
check(callGuard(requireLeaveApprover, { role: 'Staff' }) === 403, 'Staff decide → 403');
check(callGuard(requireLeaveReader, { role: 'Read-Only' }) === 200, 'Read-Only reads the inbox');
check(callGuard(requireLeaveReader, { role: 'Department Manager' }) === 200, 'manager reads the inbox');
check(callGuard(requireLeaveReader, { role: 'Staff' }) === 403, 'Staff inbox → 403');
check(callGuard(requireLeaveApprover, undefined) === 403, 'missing user fails closed');

console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
