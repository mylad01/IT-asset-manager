// conversationUpload.js — multer config for conversation attachments.
//
// Replaces the old route-local config whose `allowed` regex wasn't anchored,
// accepted any image/* mime, and had a single 10MB cap for all kinds.
// New policy (mime AND extension must both pass, anchored tests):
//   images: jpeg/png/gif/webp           ≤ 25 MB
//   video:  mp4/webm/quicktime(.mov)    ≤ 50 MB
//   docs:   pdf, txt                    ≤ 10 MB
// doc/docx were dropped: browsers can't preview them inline (the core UX
// problem being fixed) and PDF covers the need. Over-limit files are
// rejected inside the filter so the sender gets a precise error naming the
// file instead of a generic 413.

import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fsSync from 'fs';
import { activeConversationsDir, ensureConversationDirs } from '../utils/uploadPaths.js';

// ── Allowlist: mime families with per-kind caps ──
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const DOC_MIMES = new Set(['application/pdf', 'text/plain']);

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const DOC_EXT = new Set(['.pdf', '.txt']);

export const CAPS = {
  image: 25 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  doc: 10 * 1024 * 1024,
};

function classify(mimetype, ext) {
  if (IMAGE_MIMES.has(mimetype) && IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_MIMES.has(mimetype) && VIDEO_EXT.has(ext)) return 'video';
  if (DOC_MIMES.has(mimetype) && DOC_EXT.has(ext)) return 'doc';
  return null;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureConversationDirs();
      cb(null, activeConversationsDir());
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    // Random hex name — unlike Date.now()+Math.random it can't collide under
    // concurrency, and the original extension is preserved for mime sniffing.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomBytes(12).toString('hex')}${ext}`);
  },
});

// Must be declared BEFORE the multer instance below — limits.files reads it
// at module-evaluation time (TDZ ReferenceError otherwise).
export const MAX_FILES = 5;

/**
 * Multer instance for conversation attachments. `MAX_FILES` attachments per
 * message. The fileFilter enforces the allowlist (multer streams the body
 * before sizes are known, so per-kind size caps can't be checked here —
 * they are enforced AFTER upload in the service, which stats each written
 * file and rejects + cleans up over-cap files).
 */
export const conversationUpload = multer({
  storage,
  limits: {
    files: MAX_FILES,
    // Hard ceiling = video cap; per-kind caps enforced post-upload.
    fileSize: CAPS.video,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const kind = classify(file.mimetype, ext);
    if (!kind) {
      return cb(new multer.MulterError('LIMIT_UNACCEPTABLE_TYPE', file));
    }
    cb(null, true);
  },
});

/**
 * Post-upload per-kind size enforcement. Returns the list of over-cap files
 * (caller deletes them from disk and rejects the request). Stats the file
 * because `file.size` is not reliably populated by multer 2.x in all paths.
 */
export function findOverCapFiles(files) {
  const over = [];
  for (const file of files || []) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const kind = classify(file.mimetype, ext) || 'doc';
    let size = file.size;
    if (size == null) {
      try { size = fsSync.statSync(file.path).size; } catch { size = 0; }
    }
    if (size > CAPS[kind]) over.push({ file, kind, size });
  }
  return over;
}

/** Map MulterError codes to user-friendly messages (used by the API client). */
export function multerErrorMessage(code, fieldName) {
  switch (code) {
    case 'LIMIT_FILE_SIZE': return 'File too large — videos up to 50 MB, images up to 25 MB, documents up to 10 MB.';
    case 'LIMIT_FILE_COUNT': return `Too many attachments (max ${MAX_FILES} per message).`;
    case 'LIMIT_UNACCEPTABLE_TYPE': return 'Unsupported file type. Allowed: JPG, PNG, GIF, WebP, MP4, WebM, MOV, PDF, TXT.';
    default: return `Upload failed${fieldName ? ` (${fieldName})` : ''}.`;
  }
}
