// leaveRequestModel.js — pure data access for leave_requests.
// Reads parse the `attachments` JSON once at the boundary; write helpers take
// the transaction handle (one shared connection: getDb() === the txn handle).

import { getDb } from '../database.js';
import { LEAVE_STATUSES } from '../validators/leaveRequestValidator.js';

// Overlap must consider exactly the statuses the spec names: Pending+Approved
// (Denied ranges do not block). Derived from the validator so the two can't drift.
const BLOCKING_STATUSES = LEAVE_STATUSES.filter(s => s !== 'Denied');

function parseRow(row) {
  if (!row) return row;
  let attachments = [];
  try { attachments = row.attachments ? JSON.parse(row.attachments) : []; } catch { attachments = []; }
  return { ...row, attachments };
}

export async function create(db, row) {
  const result = await db.run(
    `INSERT INTO leave_requests
       (user_id, submitted_by, dept_id, start_date, end_date, description, status, attachments)
     VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)`,
    [row.user_id, row.submitted_by, row.dept_id, row.start_date, row.end_date, row.description,
     JSON.stringify(row.attachments || [])]
  );
  return Number(result?.lastID ?? result?.lastInsertRowid ?? 0);
}

export async function getById(id) {
  const db = await getDb();
  const row = await db.get(
    `SELECT lr.*, u.name AS requester_name, d.name AS department_name
     FROM leave_requests lr
     LEFT JOIN users u ON lr.user_id = u.id
     LEFT JOIN departments d ON lr.dept_id = d.id
     WHERE lr.id = ?`, [id]);
  return parseRow(row);
}

export async function findByUser(userId) {
  const db = await getDb();
  const rows = await db.all('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC, id DESC', [userId]);
  return rows.map(parseRow);
}

// Spec §4: runs INSIDE the submit transaction — a same-connection read sees
// uncommitted rows, so two racing submits serialize on the lane and the
// second one hits the first's range.
export async function findOverlap(db, userId, startDate, endDate) {
  const placeholders = BLOCKING_STATUSES.map(() => '?').join(',');
  const row = await db.get(
    `SELECT * FROM leave_requests
     WHERE user_id = ? AND status IN (${placeholders})
       AND start_date <= ? AND end_date >= ?
     LIMIT 1`,
    [userId, ...BLOCKING_STATUSES, endDate, startDate]);
  return parseRow(row);
}

// ── inbox / coverage / decide (spec §4 #4–#7) ──

const LIST_SELECT = `
  SELECT lr.*, u.name AS requester_name, u.email AS requester_email, d.name AS department_name
  FROM leave_requests lr
  LEFT JOIN users u ON lr.user_id = u.id
  LEFT JOIN departments d ON lr.dept_id = d.id`;

// Decided = every status except Pending — derived so the query can't drift
// from the validator vocabulary (contract: scripts/testLeaveContract.js).
const DECIDED_STATUSES = LEAVE_STATUSES.filter(s => s !== 'Pending');

export async function listPending({ deptId = null, all = false } = {}) {
  const db = await getDb();
  const rows = await db.all(
    `${LIST_SELECT}
     WHERE lr.status = 'Pending'${all ? '' : ' AND lr.dept_id = ?'}
     ORDER BY lr.created_at ASC, lr.id ASC`,
    all ? [] : [deptId]);
  return rows.map(parseRow);
}

export async function listDecided({ deptId = null, all = false } = {}) {
  const db = await getDb();
  const statusPh = DECIDED_STATUSES.map(() => '?').join(',');
  const rows = await db.all(
    `${LIST_SELECT}
     WHERE lr.status IN (${statusPh})${all ? '' : ' AND lr.dept_id = ?'}
     ORDER BY lr.decided_at DESC, lr.id DESC`,
    [...DECIDED_STATUSES, ...(all ? [] : [deptId])]);
  return rows.map(parseRow);
}

export async function countPending({ deptId = null, all = false } = {}) {
  const db = await getDb();
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM leave_requests lr
     WHERE lr.status = 'Pending'${all ? '' : ' AND lr.dept_id = ?'}`,
    all ? [] : [deptId]);
  return Number(row?.n || 0);
}

// Pending+Approved ranges intersecting [from, to] — the approvals-page
// availability strip (spec §4 #7).
export async function listCoverage(from, to, { deptId = null, all = false } = {}) {
  const db = await getDb();
  const statuses = LEAVE_STATUSES.filter(s => s !== 'Denied');
  const statusPh = statuses.map(() => '?').join(',');
  const rows = await db.all(
    `${LIST_SELECT}
     WHERE lr.status IN (${statusPh}) AND lr.start_date <= ? AND lr.end_date >= ?${all ? '' : ' AND lr.dept_id = ?'}
     ORDER BY lr.start_date ASC, lr.id ASC`,
    [...statuses, to, from, ...(all ? [] : [deptId])]);
  return rows.map(parseRow);
}

// Conditional: the `AND status = 'Pending'` guard makes a concurrent second
// decision a no-op (changes = 0 → service raises 409).
export async function decide(db, id, { status, decisionNote, decidedBy }) {
  const result = await db.run(
    `UPDATE leave_requests
     SET status = ?, decision_note = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'Pending'`,
    [status, decisionNote ?? null, decidedBy, id]);
  return { changes: Number(result?.changes ?? 0) };
}
