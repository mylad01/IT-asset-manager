#!/usr/bin/env node
/**
 * scripts/testLeaveUploads.js — leave upload policy + private guard units.
 * No server, no DB: pure imports + temp files under an isolated UPLOADS_DIR.
 * Run:  node scripts/testLeaveUploads.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate every write this script makes from the real uploads tree.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-uploads-'));
process.env.UPLOADS_DIR = path.join(TMP, 'uploads');

const { isAllowedLeaveUpload, findOverCapLeaveFiles, leaveMulterMessage, MAX_FILES, MAX_FILE_BYTES } = await import('../server/config/leaveUpload.js');
const { extForLeaveMime, validateLeaveFile, privateUploadsGuard } = await import('../server/utils/uploadSafety.js');
const { leaveRequestsDir, ensureLeaveRequestsDir } = await import('../server/utils/uploadPaths.js');

let passed = 0, failed = 0;
const check = (ok, name, note = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && note ? ` :: ${note}` : ''}`);
  if (ok) passed++; else failed++;
};

// ── 1. allowlist: mime AND anchored extension must both match ──
check(isAllowedLeaveUpload('image/png', 'x.png'), 'png accepted');
check(isAllowedLeaveUpload('image/jpeg', 'holiday photo.JPEG'), 'jpeg with uppercase ext accepted');
check(isAllowedLeaveUpload('application/pdf', 'invoice.pdf'), 'pdf accepted');
check(!isAllowedLeaveUpload('image/png', 'xss.html'), 'png mime with .html name rejected');
check(!isAllowedLeaveUpload('image/png', 'x.png.exe'), 'double extension rejected');
check(!isAllowedLeaveUpload('application/pdf', 'a.exe'), 'pdf mime with .exe rejected');
check(!isAllowedLeaveUpload('text/html', 'a.html'), 'html rejected');
check(!isAllowedLeaveUpload('image/svg+xml', 'a.svg'), 'svg rejected');
check(!isAllowedLeaveUpload('image/png', 'noext'), 'extensionless rejected');
check(!isAllowedLeaveUpload('image/png', 'a.jfif'), 'non-allowlisted png extension rejected');

// ── 2. MIME-derived stored extension ──
check(extForLeaveMime('application/pdf') === '.pdf', 'pdf ext');
check(extForLeaveMime('image/jpeg') === '.jpg', 'jpeg ext');
check(extForLeaveMime('text/html') === null, 'html has no leave ext');

// ── 3. content verification (magic bytes / %PDF- head) ──
ensureLeaveRequestsDir();
const write = (name, buf) => { const p = path.join(leaveRequestsDir(), name); fs.writeFileSync(p, buf); return p; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pngPath = write('ok.png', PNG);
const htmlPath = write('fake.png', Buffer.from('<html><script>alert(1)</script>'));
const pdfPath = write('ok.pdf', Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'));
const fakePdfPath = write('fake.pdf', Buffer.from('definitely not a pdf'));
check(await validateLeaveFile(pngPath, 'image/png'), 'real PNG magic bytes pass');
check(!(await validateLeaveFile(htmlPath, 'image/png')), 'HTML claiming image/png fails');
check(await validateLeaveFile(pdfPath, 'application/pdf'), '%PDF- head passes');
check(!(await validateLeaveFile(fakePdfPath, 'application/pdf')), 'PDF without %PDF- head fails');
check(!(await validateLeaveFile(pngPath, 'application/pdf')), 'PNG claimed as pdf fails');

// ── 4. size/count caps + friendly messages ──
const big = write('big.png', Buffer.alloc(MAX_FILE_BYTES + 1024, 1));
const small = write('small.png', Buffer.alloc(1024, 1));
check(findOverCapLeaveFiles([{ path: big }]).length === 1, 'over-cap file detected via stat');
check(findOverCapLeaveFiles([{ path: small }]).length === 0, 'under-cap file passes');
check(MAX_FILES === 3 && MAX_FILE_BYTES === 10 * 1024 * 1024, 'caps are 3 files / 10 MB');
check(leaveMulterMessage('LIMIT_FILE_SIZE').includes('10 MB'), 'size message states the 10 MB leave cap');
check(leaveMulterMessage('LIMIT_FILE_COUNT').includes('3'), 'count message names 3 files');

// ── 5. private guard path matrix ──
const guard = (p) => {
  let status = null, nexted = false;
  const res = { status: (s) => { status = s; return res; }, json: () => res };
  privateUploadsGuard({ path: p }, res, () => { nexted = true; });
  return status === 404 ? 404 : nexted ? 'next' : 'unknown';
};
check(guard('/conversations/a.png') === 404, 'active conversation tree → 404');
check(guard('/archive/conversations/a.png') === 404, 'archived conversation tree → 404');
check(guard('/leave-requests/a.png') === 404, 'leave tree → 404');
check(guard('/conversations') === 404, 'bare /conversations → 404');
check(guard('/leave-requests') === 404, 'bare /leave-requests → 404');
check(guard('/Conversations/a.png') === 404, 'case variant → 404');
check(guard('/LEAVE-REQUESTS/a.png') === 404, 'uppercase leave tree → 404');
check(guard('/archive/../conversations/a.png') === 404, 'dot-dot traversal → 404');
check(guard('/leave-requests/%2e%2e/%2e%2e/conversations/a.png') === 404, 'percent-encoded traversal → 404');
check(guard('/leave-requests%2f..%2fconversations%2fa.png') === 404, 'encoded-slash traversal → 404');
check(guard('/leave-requests\\a.png') === 404, 'backslash variant → 404');
check(guard('/conversations//a.png') === 404, 'duplicate slashes → 404');
check(guard('/asset-images/a.png') === 'next', 'public asset images pass through');
check(guard('/branding/logo.png') === 'next', 'branding logo passes through');
check(guard('/') === 'next', 'uploads root passes through');

// ── 6. path helper honours UPLOADS_DIR (isolated QA instances) ──
check(leaveRequestsDir().startsWith(TMP), 'leaveRequestsDir honours UPLOADS_DIR', leaveRequestsDir());

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
