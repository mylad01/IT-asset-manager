// leaveRequestService.js — business logic for the leave-requests subsystem.

import fsSync from 'fs';
import path from 'path';
import { getDb } from '../database.js';
import { withTransaction } from '../db/transactions.js';
import * as leaveRequestModel from '../models/leaveRequestModel.js';
import * as userModel from '../models/userModel.js';
import { emit } from './notificationEvents.js';
import { logChange } from './activityLogService.js';
import AppError from '../utils/AppError.js';
import { discardUploaded, validateLeaveFile } from '../utils/uploadSafety.js';
import { findOverCapLeaveFiles } from '../config/leaveUpload.js';

async function cleanupFiles(files) {
  await Promise.all((files || []).map(f => discardUploaded(f?.path)));
}

// multer 2.x does not reliably populate file.size — stat as fallback.
function fileMeta(file) {
  let size = file.size;
  if (size == null) {
    try { size = fsSync.statSync(file.path).size; } catch { size = 0; }
  }
  return {
    // Display name: basename only, bounded — the STORED name is already
    // MIME-derived (leaveUpload.filename), this is what humans see.
    name: path.basename(String(file.originalname || 'file')).slice(0, 120) || 'file',
    path: `leave-requests/${path.basename(file.path)}`,
    mime: file.mimetype,
    size,
  };
}

export async function submit({ actor, targetUserId, body, files, logger, req }) {
  const requester = await userModel.getById(targetUserId);
  if (!requester) {
    await cleanupFiles(files); // multer already wrote them — no orphans
    throw new AppError('The requester does not exist.', 404);
  }

  // Content + size verification BEFORE the transaction (spec §5): magic bytes
  // for rasters, %PDF- head for PDFs. Any failure discards EVERY uploaded file.
  if (findOverCapLeaveFiles(files).length) {
    await cleanupFiles(files);
    throw new AppError('File too large — leave attachments are limited to 10 MB each.', 413);
  }
  for (const file of files || []) {
    let ok = false;
    try { ok = await validateLeaveFile(file.path, file.mimetype); } catch { ok = false; }
    if (!ok) {
      await cleanupFiles(files);
      throw new AppError('File content does not match its declared type. Allowed: JPG, PNG, WebP, GIF, PDF.', 400);
    }
  }
  const attachments = (files || []).map(fileMeta);

  const db = await getDb();
  let createdId;
  try {
    createdId = await withTransaction(db, async (txn) => {
      const overlap = await leaveRequestModel.findOverlap(txn, requester.id, body.start_date, body.end_date);
      if (overlap) {
        throw new AppError(
          `Overlaps your existing ${overlap.status.toLowerCase()} leave (${overlap.start_date} → ${overlap.end_date}).`,
          409,
          { start_date: overlap.start_date, end_date: overlap.end_date, status: overlap.status }
        );
      }
      const id = await leaveRequestModel.create(txn, {
        user_id: requester.id,
        // Always the actor: self, or the admin who filed on-behalf (spec §3).
        submitted_by: actor.id,
        dept_id: requester.dept_id ?? null, // SNAPSHOT at submit time (spec §3)
        start_date: body.start_date,
        end_date: body.end_date,
        description: body.description,
        attachments,
      });
      await emit('leave:submitted', {
        requestId: id,
        deptId: requester.dept_id ?? null,
        requesterName: requester.name,
        start: body.start_date,
        end: body.end_date,
      }, txn);
      return id;
    }, { logger });
  } catch (err) {
    // Transaction failed (incl. the 409 overlap) → nothing references these files.
    await cleanupFiles(files);
    throw err;
  }

  await logChange({
    entityType: 'leave_request',
    entityId: String(createdId),
    action: 'create',
    userId: actor.id,
    userName: actor.name,
    ipAddress: req?.ip,
    changes: {
      start_date: { old: null, new: body.start_date },
      end_date: { old: null, new: body.end_date },
      status: { old: null, new: 'Pending' },
      ...(targetUserId !== actor.id ? { user_id: { old: null, new: targetUserId } } : {}),
    },
  }, { logger });

  return { id: createdId };
}

export async function listMine(userId) {
  return leaveRequestModel.findByUser(userId);
}

// ── scoping (spec §2 + §5: server-side, fail-closed) ──

/**
 * What an actor may READ in the inbox/coverage routes:
 *   { all: true }          admin/root/Read-Only — every department
 *   { deptId }             manager of that department
 *   { none: true }         everyone else, incl. NULL-dept managers (fail closed)
 */
async function readerScope(actor) {
  if (actor.isRoot || actor.role === 'IT Admin' || actor.role === 'Read-Only') return { all: true };
  if (actor.role === 'Department Manager') {
    const row = await userModel.getById(actor.id);
    if (!row || row.dept_id == null) return { none: true }; // spec §2
    return { deptId: row.dept_id };
  }
  return { none: true };
}

export async function listPending(actor, view) {
  const scope = await readerScope(actor);
  if (scope.none) return [];
  return view === 'decided'
    ? leaveRequestModel.listDecided(scope)
    : leaveRequestModel.listPending(scope);
}

// Spec §4 #5: an ACTION-QUEUE count — Staff and Read-Only always get 0 so
// their badge never lights; a NULL-dept manager counts nothing (fail closed).
export async function pendingCount(actor) {
  if (actor.isRoot || actor.role === 'IT Admin') return leaveRequestModel.countPending({ all: true });
  if (actor.role === 'Department Manager') {
    const row = await userModel.getById(actor.id);
    if (!row || row.dept_id == null) return 0;
    return leaveRequestModel.countPending({ deptId: row.dept_id });
  }
  return 0;
}

export async function listCoverage(actor, from, to) {
  const scope = await readerScope(actor);
  if (scope.none) return [];
  return leaveRequestModel.listCoverage(from, to, scope);
}

// Spec §4 #8/#9 visibility: requester / same-dept manager / admin+root /
// Read-Only. Everyone else gets 403 (actionable — matches §8's "403
// cross-dept manager" wording; 404 only for missing/non-numeric ids).
export async function getVisible(id, actor) {
  if (!Number.isInteger(id)) throw new AppError('Leave request not found.', 404);
  const row = await leaveRequestModel.getById(id);
  if (!row) throw new AppError('Leave request not found.', 404);
  if (actor.isRoot || actor.role === 'IT Admin' || actor.role === 'Read-Only') return row;
  if (row.user_id === actor.id) return row;
  if (actor.role === 'Department Manager') {
    const actorRow = await userModel.getById(actor.id);
    if (actorRow?.dept_id != null && row.dept_id != null && row.dept_id === actorRow.dept_id) return row;
    throw new AppError('This leave request belongs to another department.', 403);
  }
  throw new AppError('You do not have access to this leave request.', 403);
}

export async function decide(id, decision, decisionNote, actor, logger, req) {
  if (!Number.isInteger(id)) throw new AppError('Leave request not found.', 404);
  const row = await leaveRequestModel.getById(id);
  if (!row) throw new AppError('Leave request not found.', 404);

  // Order matters: self-decide is checked BEFORE role/dept so an admin who
  // filed their own on-behalf row gets the same 403 as a manager (spec §2).
  if (row.user_id === actor.id) {
    throw new AppError('You cannot decide your own leave request.', 403);
  }
  const isAdmin = actor.isRoot || actor.role === 'IT Admin';
  if (!isAdmin) {
    if (actor.role !== 'Department Manager') {
      throw new AppError('Forbidden: leave approvals require Department Manager or IT Admin privileges.', 403);
    }
    const actorRow = await userModel.getById(actor.id);
    if (actorRow?.dept_id == null || row.dept_id == null || row.dept_id !== actorRow.dept_id) {
      throw new AppError('This leave request belongs to another department.', 403);
    }
  }
  if (row.status !== 'Pending') {
    throw new AppError(`Request already decided (${row.status}).`, 409,
      { status: row.status, start_date: row.start_date, end_date: row.end_date });
  }

  const db = await getDb();
  await withTransaction(db, async (txn) => {
    const { changes } = await leaveRequestModel.decide(txn, id, {
      status: decision, decisionNote, decidedBy: actor.id,
    });
    if (!changes) {
      // Lost a race against a concurrent decision between read and write.
      throw new AppError('Request already decided.', 409, { status: 'Approved or Denied' });
    }
    await emit(decision === 'Approved' ? 'leave:approved' : 'leave:denied', {
      userId: row.user_id,
      requestId: id,
      start: row.start_date,
      end: row.end_date,
    }, txn);
  }, { logger });

  await logChange({
    entityType: 'leave_request',
    entityId: String(id),
    action: 'decide',
    userId: actor.id,
    userName: actor.name,
    ipAddress: req?.ip,
    changes: {
      status: { old: 'Pending', new: decision },
      decided_by: { old: null, new: actor.id },
    },
    ...(decisionNote ? { metadata: { decision_note: decisionNote } } : {}),
  }, { logger });

  return { message: decision === 'Approved' ? 'Request approved.' : 'Request denied.' };
}
