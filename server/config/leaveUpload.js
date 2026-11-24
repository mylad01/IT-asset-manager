// leaveUpload.js — multer config for leave-request attachments (spec §5).
// Policy: mime AND extension must both pass (anchored), ≤3 files, 10 MB each.
// The stored extension comes from the VALIDATED mime — never originalname
// (uploadSafety rule, security review 2026-10-12).

import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fsSync from 'fs';
import { leaveRequestsDir, ensureLeaveRequestsDir } from '../utils/uploadPaths.js';

const ALLOWED = {
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/png': new Set(['.png']),
  'image/webp': new Set(['.webp']),
  'image/gif': new Set(['.gif']),
  'application/pdf': new Set(['.pdf']),
};

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

// Must be declared BEFORE the multer instance — limits.files reads it at
// module-evaluation time (TDZ ReferenceError otherwise).
export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Pure policy check (unit-tested by scripts/testLeaveUploads.js). */
export function isAllowedLeaveUpload(mimetype, originalname) {
  const mime = String(mimetype || '').toLowerCase();
  const ext = path.extname(String(originalname || '')).toLowerCase();
  const allowedExts = ALLOWED[mime];
  return !!allowedExts && allowedExts.has(ext);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureLeaveRequestsDir();
      cb(null, leaveRequestsDir());
    } catch (err) {
      cb(err);
    }
  },
  // Random hex name + MIME-derived extension — collision-free under
  // concurrency and immune to spoofed client filenames.
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[String(file.mimetype).toLowerCase()] || '';
    cb(null, `${crypto.randomBytes(12).toString('hex')}${ext}`);
  },
});

export const leaveUpload = multer({
  storage,
  limits: {
    files: MAX_FILES,
    fileSize: MAX_FILE_BYTES, // hard ceiling; post-upload stat below re-checks
  },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedLeaveUpload(file.mimetype, file.originalname)) {
      return cb(new multer.MulterError('LIMIT_UNACCEPTABLE_TYPE', 'attachments'));
    }
    cb(null, true);
  },
});

/**
 * Post-upload size enforcement. Stats the file because `file.size` is not
 * reliably populated by multer 2.x in all paths (conversationUpload precedent).
 */
export function findOverCapLeaveFiles(files) {
  const over = [];
  for (const file of files || []) {
    let size = file.size;
    if (size == null) {
      try { size = fsSync.statSync(file.path).size; } catch { size = 0; }
    }
    if (size > MAX_FILE_BYTES) over.push({ file, size });
  }
  return over;
}

/** Leave-specific multer messages (the leave routes answer locally — spec §8). */
export function leaveMulterMessage(code) {
  switch (code) {
    case 'LIMIT_FILE_SIZE': return 'File too large — leave attachments are limited to 10 MB each.';
    case 'LIMIT_FILE_COUNT': return `Too many attachments (max ${MAX_FILES}).`;
    case 'LIMIT_UNACCEPTABLE_TYPE': return 'Unsupported file type. Allowed: JPG, PNG, WebP, GIF, PDF.';
    case 'LIMIT_UNEXPECTED_FILE': return 'Unexpected file field — use the "attachments" field.';
    default: return 'Upload failed.';
  }
}
