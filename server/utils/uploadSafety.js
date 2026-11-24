// uploadSafety.js — shared upload hardening helpers.
//
// Fixes the stored-XSS family found in the 2026-10-12 security review:
// multer derived the STORED file extension from the client's originalname
// while the fileFilter checked only the claimed Content-Type, so a file
// named `xss.html` claiming `image/png` was stored as `<uuid>.html` and
// served by the public /uploads mount as text/html — attacker-controlled
// script executing on the app's own origin (session theft via localStorage).
//
// Rules enforced here:
//   1. The stored extension ALWAYS comes from the validated MIME allowlist,
//      never from originalname.
//   2. Raster images must match their magic bytes (no HTML/EXE payload
//      wearing an `image/png` claim); SVG must contain actual <svg> markup.
//   3. Static serving of /uploads force-downloads anything that is not a
//      script-free raster type and puts SVG (branding logos) behind a
//      script-blocking CSP — belt and braces for files already on disk
//      from before this fix.

import { open, unlink } from 'node:fs/promises';

// MIME allowlist → canonical stored extension. Keys are lowercase.
const IMAGE_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

/** Canonical extension for a validated image MIME, or null when not allowlisted. */
export function extForImageMime(mimetype) {
  return IMAGE_MIME_EXT[String(mimetype || '').toLowerCase()] || null;
}

// Raster magic-byte signatures — first bytes of the file must match the
// CLAIMED type. Minimal sniffing (not a full parser); its job is to stop
// text/HTML/executables that only lie about Content-Type.
const RASTER_SIGNATURES = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length >= 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG',
  'image/webp': (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  'image/gif': (b) => b.length >= 4 && (b.toString('ascii', 0, 4) === 'GIF8'),
};

/**
 * Validate an on-disk upload against its DECLARED mimetype.
 * Rasters: magic bytes. SVG: must contain <svg markup in the head (blocks
 * HTML polyglots claiming image/svg+xml; scriptability of real SVG is
 * neutralized at serve time by uploadsStaticHeaders' CSP sandbox).
 * Returns true only when the file passes; throws on I/O errors.
 */
export async function validateImageFile(filePath, mimetype, { allowSvg = false } = {}) {
  const mime = String(mimetype || '').toLowerCase();
  const ext = IMAGE_MIME_EXT[mime];
  if (!ext) return false;                                  // not in the image allowlist at all
  if (mime === 'image/svg+xml' && !allowSvg) return false; // SVG only where explicitly permitted
  if (mime === 'image/svg+xml') {
    const head = await readHead(filePath, 1024);
    return /<svg[\s>]/i.test(head.toString('utf8'));
  }
  const check = RASTER_SIGNATURES[mime];
  if (!check) return false;
  return check(await readHead(filePath, 16));
}

async function readHead(filePath, bytes) {
  let fh;
  try {
    fh = await open(filePath, 'r');
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh?.close();
  }
}

/** Best-effort removal of a rejected upload (never throws at the caller). */
export async function discardUploaded(filePath) {
  if (!filePath) return;
  try { await unlink(filePath); } catch { /* already gone */ }
}

/**
 * Express middleware for routes that use multer's `.single('image')`.
 * Place it AFTER the upload middleware and BEFORE validation/controllers:
 * a rejected file is deleted from disk and the request answered 400, so a
 * bad upload never reaches persistence. Pass { allowSvg: true } only where
 * SVG is an intentionally supported format (branding logos).
 */
export function verifyUploadedImage({ allowSvg = false } = {}) {
  return async (req, res, next) => {
    if (!req.file) return next(); // create controllers enforce their own presence check
    let ok = false;
    try {
      ok = await validateImageFile(req.file.path, req.file.mimetype, { allowSvg });
    } catch {
      ok = false;
    }
    if (!ok) {
      await discardUploaded(req.file.path);
      return res.status(400).json({ error: 'File content does not match its declared image type. Allowed: JPG, PNG, WebP.' });
    }
    next();
  };
}

const RASTER_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;

/**
 * setHeaders callback for `express.static('uploads')` — serve-time hardening
 * for EVERY file under /uploads (including ones written before this fix, and
 * the SVG branding logo):
 *   - nosniff always;
 *   - .svg: script-blocking CSP + sandbox (renders in <img>, inert on direct
 *     navigation — the standard mitigation for scriptable image formats);
 *   - anything else that is not a known-safe raster extension:
 *     Content-Disposition: attachment (downloads instead of rendering).
 */
export function uploadsStaticHeaders(res, filePath) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (String(filePath).toLowerCase().endsWith('.svg')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', 'inline');
  } else if (!RASTER_EXT_RE.test(String(filePath))) {
    res.setHeader('Content-Disposition', 'attachment');
  }
}

// ── leave-requests (spec: 2026-10-13 design §5) ──
const LEAVE_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

/** Canonical extension for a validated leave MIME, or null when not allowlisted. */
export function extForLeaveMime(mimetype) {
  return LEAVE_MIME_EXT[String(mimetype || '').toLowerCase()] || null;
}

/**
 * Content verification for a leave upload: rasters via the existing magic-
 * byte checks, PDF via a `%PDF-` header (the minimal check that stops text/
 * HTML wearing an application/pdf claim).
 */
export async function validateLeaveFile(filePath, mimetype) {
  const mime = String(mimetype || '').toLowerCase();
  if (mime === 'application/pdf') {
    const head = await readHead(filePath, 5);
    return head.toString('latin1') === '%PDF-';
  }
  return validateImageFile(filePath, mime, { allowSvg: false });
}

// Private upload subtrees — these must NEVER be served by the public
// /uploads static mount. Conversations + their archives are the pre-
// existing hole (verified live 2026-10-13: 200, byte-exact, no auth);
// leave-requests is the new tree this spec adds.
const PRIVATE_UPLOAD_PREFIXES = ['/conversations/', '/archive/conversations/', '/leave-requests/'];

/**
 * Decode + normalize a request path BEFORE prefix matching: percent-encodes
 * resolve, backslashes become slashes, `.`/`..` segments collapse, runs of
 * slashes merge, and a trailing slash is forced so bare directories match
 * too. Case-insensitive (Windows FS is; Express mounts are too).
 */
function normalizePrivatePath(rawPath) {
  let p = String(rawPath || '');
  try { p = decodeURIComponent(p); } catch { /* malformed encoding — keep raw */ }
  p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return `/${out.join('/')}/`;
}

/** 404 for any path under a private subtree; otherwise pass through. */
export function privateUploadsGuard(req, res, next) {
  const normalized = normalizePrivatePath(req.path).toLowerCase();
  if (PRIVATE_UPLOAD_PREFIXES.some(pre => normalized.startsWith(pre))) {
    return res.status(404).json({ error: 'Not found.' });
  }
  return next();
}
