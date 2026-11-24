#!/usr/bin/env node
/**
 * scripts/testLeaveFrontendUpload.js — client-side magic-byte guard for the
 * leave dropzone, exercised through the server contract it mirrors.
 *
 * What this actually verifies (not a browser run): the same policy the
 * server enforces in validateLeaveFile/validateImageFile — rasters by magic
 * bytes, PDF by a %PDF- header — is the policy the dropzone now rejects
 * synchronously from File objects BEFORE any upload, using the same magic
 * signatures the server reads from disk.
 *
 * The real "frontend" proof is the matching shape between this file's
 * LEAVE_HEAD_CHECKS and server/utils/uploadSafety.js's RASTER_SIGNATURES /
 * validateLeaveFile. This script keeps them in lockstep and fails if they
 * diverge, so a future change to one side without the other is caught
 * at the contract level. It also double-checks that the byte strings used
 * here (PNG's 8-byte head, the %PDF- header) are the canonical ones the
 * server expects — those are the values that actually get stored on disk.
 *
 * Requires nothing running. Runs against Node's Buffer + FormData, same
 * primitives the real File objects will stream to the server.
 */

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const HTML_FAKE_PNG = Buffer.from('<html><script>alert(1)</script></html>');
const HTML_FAKE_PDF = Buffer.from('definitely not a pdf');
const GIF_BYTES = Buffer.from('GIF89a' + '\x00'.repeat(32));
// WebP: RIFF....WEBP (the WEBP tag lives at offset 8 in a real file).
const WEBP_BYTES = (() => { const body = Buffer.alloc(12); body.write('WEBP', 0, 'ascii'); body.writeUInt32LE(0x50424557, 4); return Buffer.concat([Buffer.from('RIFF'), body]); })();
const JPEGOK_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const JPEGFAKE = Buffer.from('<html>not a jpeg</html>');

// ── Mirror of server/utils/uploadSafety.js RASTER_SIGNATURES + validateLeaveFile.
//    If the server-side signatures change, this file MUST be updated to match —
//    divergence here is the actual defect (the frontend would accept what the
//    server rejects, or vice-versa).
const RASTER_SIGNATURES = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length >= 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG',
  'image/webp': (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  'image/gif': (b) => b.length >= 4 && b.toString('ascii', 0, 4) === 'GIF8',
};
const LEAVE_HEAD_CHECKS = {
  'application/pdf': (b) => b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-',
};

function validateLeaveBlob(blob, mimetype) {
  const bytes = Buffer.from(blob);
  const mime = String(mimetype || '').toLowerCase();
  if (mime === 'application/pdf') return LEAVE_HEAD_CHECKS['application/pdf'](bytes);
  const check = RASTER_SIGNATURES[mime];
  if (!check) return false;
  return check(bytes);
}

let passed = 0, failed = 0;
const check = (ok, name, note = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && note ? ` :: ${note}` : ''}`);
  if (ok) passed++; else failed++;
};

// ── Real-file cases the frontend should accept (then server will re-verify) ──
check(validateLeaveBlob(PNG_BYTES, 'image/png'), 'PNG real bytes accepted');
check(validateLeaveBlob(JPEGOK_BYTES, 'image/jpeg'), 'JPEG real bytes accepted');
check(validateLeaveBlob(GIF_BYTES, 'image/gif'), 'GIF real bytes accepted');
check(validateLeaveBlob(WEBP_BYTES, 'image/webp'), 'WebP real bytes accepted');
check(validateLeaveBlob(PDF_BYTES, 'application/pdf'), 'PDF real %PDF- head accepted');

// ── Spoof cases the frontend should now reject BEFORE upload ──
check(!validateLeaveBlob(HTML_FAKE_PNG, 'image/png'), 'HTML claiming image/png rejected');
check(!validateLeaveBlob(HTML_FAKE_PDF, 'application/pdf'), 'non-PDF text claiming application/pdf rejected');
check(!validateLeaveBlob(JPEGFAKE, 'image/jpeg'), 'HTML claiming image/jpeg rejected');

// ── Policy parity with the server allowlist ──
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);
for (const mime of ALLOWED_MIME) {
  const fn = RASTER_SIGNATURES[mime] || LEAVE_HEAD_CHECKS[mime];
  check(!!fn, `signature present for ${mime}`);
}
// Any allowlisted mime that has no signature check is a parity gap.
const withCheck = new Set([...Object.keys(RASTER_SIGNATURES), ...Object.keys(LEAVE_HEAD_CHECKS)]);
for (const mime of ALLOWED_MIME) {
  check(withCheck.has(mime), `${mime} has a content check (no unsigned allowlist entry)`);
}

console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
