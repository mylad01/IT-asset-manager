// uploadPaths.js — canonical storage-path helpers for conversation attachments.
//
// History: file_path used to store ABSOLUTE paths in the DB, which broke any
// folder move (archiving, restores, relocated uploads). The v2 migration
// normalized every row to an uploads-relative form:
//     conversations/<multer-basename>
// Files physically live in one of two locations, resolved at read time:
//     uploads/conversations/<basename>            (active)
//     uploads/archive/conversations/<basename>    (archived / recycle bin)
// The stored relative path is location-agnostic — the resolver checks both,
// so archiving never has to rewrite attachment rows and restoring is a pure
// file move.

import path from 'path';
import fs from 'fs';

export function uploadsRoot() {
  // UPLOADS_DIR override keeps isolated QA instances (test:server, suites)
  // from ever touching the dev uploads tree — mirrors DB_PATH/LOG_DIR.
  return path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'));
}

export function activeConversationsDir() {
  return path.join(uploadsRoot(), 'conversations');
}

export function archiveConversationsDir() {
  return path.join(uploadsRoot(), 'archive', 'conversations');
}

/**
 * Normalize any stored/known path (absolute legacy, Windows or POSIX, or
 * already-relative) to the canonical uploads-relative form
 * `conversations/<basename>`. Any path that doesn't contain the
 * conversations directory marker falls back to basename-only.
 */
export function toRelativeUploadPath(p) {
  if (!p) return p;
  const norm = String(p).replace(/\\/g, '/');
  const marker = norm.lastIndexOf('conversations/');
  if (marker === -1) return `conversations/${path.basename(norm)}`;
  return norm.slice(marker);
}

/**
 * Resolve a stored relative path to an absolute location on disk, checking
 * the active folder first, then the archive folder. Returns the first
 * existing candidate (falls back to the active candidate so callers can
 * produce a sensible ENOENT).
 */
export function resolveAttachmentPath(relativePath) {
  const base = path.basename(String(relativePath || '').replace(/\\/g, '/'));
  const candidates = [
    path.join(activeConversationsDir(), base),
    path.join(archiveConversationsDir(), base),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

/**
 * Cross-conversation collision audit for hard-moves. Under the one-tree
 * invariant (a row's file lives in exactly one tree at a time), each
 * attachment's basename must exist ONLY in the source tree — or in neither
 * (row moved, file lost: reported, non-fatal). A basename already present
 * in the DESTINATION tree is foreign: renaming would clobber it, so refuse
 * the whole operation BEFORE any DB mutation, leaving everything intact
 * for a clean retry after the collision is resolved.
 *
 * Throws an Error with status 409 on the first collision.
 */
export function assertNoFileCollisions(attachments, direction) {
  const fromDir = direction === 'archive' ? activeConversationsDir() : archiveConversationsDir();
  const toDir = direction === 'archive' ? archiveConversationsDir() : activeConversationsDir();
  for (const att of attachments || []) {
    const rel = String(att.file_path || '').replace(/\\/g, '/');
    const base = path.basename(rel);
    if (!base) continue;
    const sourcePresent = fs.existsSync(path.join(fromDir, base));
    const destinationPresent = fs.existsSync(path.join(toDir, base));
    if (sourcePresent && destinationPresent) {
      const err = new Error(
        `clobber refused: file "${base}" exists in both storage trees — the destination belongs to another conversation; resolve the collision and retry`
      );
      err.status = 409;
      throw err;
    }
  }
}

/** Ensure both storage trees exist (idempotent, cheap). */
export function ensureConversationDirs() {
  for (const dir of [activeConversationsDir(), archiveConversationsDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── leave-requests storage (spec: 2026-10-13 design §5) ──
// Lives INSIDE uploads/ so backupService's uploads zip picks it up whole.
export function leaveRequestsDir() {
  return path.join(uploadsRoot(), 'leave-requests');
}

export function ensureLeaveRequestsDir() {
  fs.mkdirSync(leaveRequestsDir(), { recursive: true });
}
