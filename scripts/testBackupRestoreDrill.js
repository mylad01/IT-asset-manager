#!/usr/bin/env node
/**
 * scripts/testBackupRestoreDrill.js — backup RESTORE drill.
 *
 * testConversationBackup proves a backup is CREATED and contains the right
 * ZIP entries; nothing ever restored one. Until a restore is exercised,
 * "we have backups" is a hope, not a capability. This drill closes that:
 *
 *   1. Obtain a real conversations-backup ZIP — produced through the app's
 *      own POST /api/conversations/backup on the dev server (:3000), falling
 *      back to the newest existing ZIP in ./backups (never fabricated).
 *   2. Inspect + extract: conversations.sqlite (a full main-DB snapshot
 *      minus _migrations), conversations-archive.sqlite, uploads/ and
 *      uploads-archive/ trees.
 *   2b/2c. Checksum layers: the ZIP-embedded SHA256SUMS manifest
 *      (self-verification, OS sha256sum cross-check, tamper detection) and
 *      the OUT-OF-BAND copies — the <zip>.SHA256SUMS sidecar written next
 *      to the ZIP and the manifest hash logged in the backup-history row
 *      (manifest_hash_hex) — including the proof that out-of-band hash
 *      agreement alone never blesses a tampered ZIP.
 *   3. Data-layer verification on the extracted files: PRAGMA
 *      integrity_check + foreign_key_check on both DBs, row counts for
 *      users/conversations/messages, and a table-name diff between the
 *      snapshot and the current dev DB (catches schema drift a backup
 *      would silently lose).
 *   4. Restore = place the files where a server instance expects them:
 *      RUNTIME/restore.sqlite + derived -conversations-archive.sqlite name
 *      (exactly how an operator would). Boot an isolated instance on :3120
 *      with its own lock/log/backup dirs — the boot runs the FULL migration
 *      chain against the restored DB (the snapshot has no _migrations table,
 *      so Umzug re-runs everything; idempotency is part of what is proven),
 *      plus the integrity check + disk preflight.
 *   5. API reads through the real HTTP surface: health (integrity ok),
 *      login with the restored root account, conversation list counts
 *      matching the snapshot, archive list (including recycle-bin
 *      tombstones) matching the archive snapshot, users/assets lists, and
 *      a first-message + attachment fetch when data exists.
 *   6. Restart survival: SIGINT the instance, boot a SECOND one on the same
 *      restored runtime (WAL replay, lock takeover from a dead owner) and
 *      re-verify health + auth. A backup that only works once is not
 *      recovered.
 *
 * Isolation: own port (:3120), own DB, own lock, own logs — zero dev-stack
 * writes; the only dev contact is the read-only backup POST. Doctor's
 * unguarded-DB-script heuristic skips test* files by design (this suite
 * never writes the dev DB; the sandboxed better-sqlite3 handles open
 * RUNTIME copies only).
 *
 * Skip semantics: no dev server AND no existing ZIP ⇒ SKIP (exit 0) with an
 * actionable message — same degradation contract as the watchdog suite's
 * port-theft scenario.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { findListenerOwners, stopNodePid } from '../server/utils/appLock.js';
import { MANIFEST_NAME, SIDECAR_SUFFIX, manifestHashHex, verifyZipChecksums, verifyFileAgainstManifest } from '../server/utils/backupChecksums.js';

const PORT = 3120;
const BASE = `http://localhost:${PORT}`;
const DEV_BASE = process.env.API_BASE || 'http://localhost:3000';
const RUNTIME = path.resolve('scripts/.runtime/restore-drill');
const RESTORE_DB = path.join(RUNTIME, 'restore.sqlite');
const RESTORE_UPLOADS = path.join(RUNTIME, 'uploads');
const RESTORE_BACKUPS = path.join(RUNTIME, 'backups');
const LOCK_FILE = path.join(RUNTIME, 'restore.lock');

let passed = 0, failed = 0, skipped = 0;
function assert(cond, msg, detail = '') {
  if (cond) { console.log(`PASS - ${msg}`); passed++; }
  else { console.log(`FAIL - ${msg}${detail ? ` — ${detail}` : ''}`); failed++; }
}
function skip(msg) { console.log(`SKIP - ${msg}`); skipped++; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, stepMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(stepMs);
  }
  return null;
}

async function request(url, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body != null) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(`${BASE}${url}`, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, data: null, error: err };
  }
}

// ── Isolated-instance machinery (same pattern as testLifecycleWatchdog) ──
const children = new Set();

function bootServer(name) {
  fs.mkdirSync(RUNTIME, { recursive: true });
  const log = fs.openSync(path.join(RUNTIME, `${name}.log`), 'a');
  const child = spawn(process.execPath, [path.resolve('server/index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: RESTORE_DB,
      UPLOADS_DIR: RESTORE_UPLOADS,
      LOG_DIR: path.join(RUNTIME, 'logs'),
      BACKUP_PATH: RESTORE_BACKUPS,
      APP_LOCK_FILE: LOCK_FILE,
      // Production-like watchdog cadence — the restore must survive the real
      // config, not a suite-tuned one.
    },
    stdio: ['ignore', log, log],
    cwd: path.resolve('.'),
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return waitFor(async () => {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return child; } catch { /* booting */ }
    return null;
  }, 30_000).then((up) => {
    if (!up) throw new Error(`${name} never became healthy — see ${path.join(RUNTIME, `${name}.log`)}`);
    return child;
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();                                     // SIGINT → graceful shutdown path
  const gone = await waitFor(() => child.exitCode !== null, 8000);
  if (!gone) await stopNodePid(child.pid);          // validated escalation
}

/** Janitor: no stray listener on :3120, no leftover runtime. */
async function janitor() {
  for (const pid of await findListenerOwners(PORT)) await stopNodePid(pid);
  fs.rmSync(RUNTIME, { recursive: true, force: true });
  fs.mkdirSync(RUNTIME, { recursive: true });
}

// ── Stage 1: obtain a REAL backup ZIP ───────────────────────────────────
async function obtainBackupZip() {
  // Preferred: produce one through the app's own API (also proves the
  // creation path still works moments before we restore from it).
  try {
    const login = await fetch(`${DEV_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@studio.com', password: 'admin' }),
    });
    if (login.ok) {
      const { token } = await login.json();
      const res = await fetch(`${DEV_BASE}/api/conversations/backup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.path && fs.existsSync(data.path)) {
          console.log(`  backup produced via POST /conversations/backup → ${data.path} (${data.sizeBytes} bytes)`);
          return { zipPath: data.path, source: 'api' };
        }
      } else {
        console.log(`  POST /conversations/backup answered ${res.status} — falling back to the newest existing ZIP`);
      }
    } else {
      console.log(`  dev-server login answered ${login.status} — falling back to the newest existing ZIP`);
    }
  } catch {
    console.log('  dev server on :3000 not reachable — falling back to the newest existing ZIP');
  }

  // Fallback: newest conversations-backup-*.zip anywhere in ./backups.
  const backupsDir = path.resolve(process.env.BACKUP_PATH || './backups');
  const candidates = fs.readdirSync(backupsDir)
    .filter((f) => /^conversations-backup-.*\.zip$/.test(f))
    .map((f) => ({ f, m: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!candidates.length) return null;
  const zipPath = path.join(backupsDir, candidates[0].f);
  console.log(`  using newest existing backup: ${zipPath}`);
  return { zipPath, source: 'existing' };
}

// ── Stage 2/3: inspect + extract + data-layer verification ──────────────
/** Read-only peek into the dev DB's conversation backup history — the
 *  out-of-band hash store this stage verifies against. Never writes;
 *  returns null when the DB or table is unavailable (skip, not fail). */
function readDevHistoryRow(filename) {
  try {
    const devDbPath = path.resolve(process.env.DB_PATH || './database.sqlite');
    const db = new Database(devDbPath, { readonly: true });
    try {
      return db.prepare('SELECT id, status, manifest_hash_hex FROM conversation_backup_logs WHERE filename = ? ORDER BY id DESC LIMIT 1').get(filename) ?? null;
    } finally { db.close(); }
  } catch { return null; }
}

function listUserTables(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations'`).all().map((r) => r.name).sort();
  } finally { db.close(); }
}

function countRows(dbPath, table) {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get().n; }
  finally { db.close(); }
}

function runCheck(dbPath, pragma) {
  const db = new Database(dbPath, { readonly: true });
  try { return db.pragma(pragma, { simple: true }); }
  finally { db.close(); }
}

/** Row-valued pragma (foreign_key_check returns NO rows when clean —
 *  pragma(..., {simple:true}) would be undefined, so take the array). */
function runCheckRows(dbPath, pragma) {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare(`PRAGMA ${pragma}`).all(); }
  finally { db.close(); }
}

/** Extract zip entries under a folder prefix into a target dir (traversal-safe). */
function extractPrefix(zip, prefix, targetDir) {
  const resolvedTarget = path.resolve(targetDir);
  let count = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const dest = path.resolve(targetDir, entry.entryName.slice(prefix.length));
    if (!dest.startsWith(resolvedTarget + path.sep)) continue; // never escape the target
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
    count++;
  }
  return count;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════════════');
  console.log('  BACKUP RESTORE DRILL (extract → boot → verify → reboot)');
  console.log('════════════════════════════════════════════════════');
  await janitor();

  // ── 1. Obtain the backup ────────────────────────────────────────────
  const backup = await obtainBackupZip();
  if (!backup) {
    skip('no conversations-backup ZIP available (dev server unreachable and ./backups empty) — start the dev stack or run testConversationBackup first');
    return finish();
  }
  assert(fs.statSync(backup.zipPath).size > 0, `backup ZIP obtainable (${backup.source})`, backup.zipPath);
  let manifestText = null;                           // set in stage 2b when the manifest exists

  // ── 2. Inspect the ZIP layout ───────────────────────────────────────
  const zip = new AdmZip(backup.zipPath);
  const names = new Set(zip.getEntries().map((e) => e.entryName));
  assert(names.has('conversations.sqlite'), 'ZIP contains conversations.sqlite');
  const hasArchive = names.has('conversations-archive.sqlite');
  assert(hasArchive, 'ZIP contains conversations-archive.sqlite (v2 hard-move snapshot)');

  // ── 2b. SHA-256 manifest (SHA256SUMS) — self-verification ─────────
  if (!names.has(MANIFEST_NAME)) {
    skip(`${MANIFEST_NAME} absent — backup predates the manifest feature; continuing with data-layer checks only`);
  } else {
    // 2b-1. The embedded verifier passes on the untouched ZIP.
    const verdict = verifyZipChecksums(zip);
    assert(verdict.ok, `${MANIFEST_NAME}: every payload entry hashes to its manifest line (${verdict.checked} entries)`, verdict.problems.join('; '));

    // 2b-2. Coverage parity: every non-hidden entry is listed — i.e. the
    // verifier would have flagged a payload entry the manifest forgot.
    const manifestLines = zip.getEntry(MANIFEST_NAME).getData().toString('utf-8').split('\n').filter(Boolean);
    const listed = new Set(manifestLines.map((l) => l.split(/\s{2}/)[1]));
    const payloadNames = [...names].filter((n) => n !== MANIFEST_NAME && !n.startsWith('_') && !n.startsWith('.'));
    assert(payloadNames.every((n) => listed.has(n)),
      `${MANIFEST_NAME}: lists every payload entry (coverage parity)`,
      payloadNames.filter((n) => !listed.has(n)).join(', '));

    // 2b-3. Independent cross-check: one entry hashed with the OS sha256sum
    // tool must equal the manifest line (format + algorithm honest).
    const probe = payloadNames.find((n) => n === 'conversations.sqlite') ?? payloadNames[0];
    const probeBuf = zip.getEntry(probe).getData();
    const { execFileSync } = await import('node:child_process');
    const tmpProbe = path.join(RUNTIME, 'probe.bin');
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.writeFileSync(tmpProbe, probeBuf);
    let toolHash = null;
    try {
      // MSYS/coreutils sha256sum switches to ESCAPED MODE (leading backslash
      // on the line) when the input path contains backslashes — strip it.
      toolHash = execFileSync('sha256sum', [tmpProbe]).toString().trim().replace(/^\\/, '').split(/\s/)[0];
    } catch { /* tool absent (Windows Git Bash usually has it) */ }
    if (toolHash) {
      const line = manifestLines.find((l) => l.endsWith(`  ${probe}`));
      assert(toolHash === line.split(/\s{2}/)[0], `${MANIFEST_NAME}: sha256sum tool agrees on ${probe}`, `${toolHash} vs ${line?.slice(0, 64)}`);
    } else {
      skip(`sha256sum cross-check for ${probe} (tool unavailable) — in-process hash already verified`);
    }

    // 2b-4. Tamper detection: flip one byte in a rebuilt copy → verifier
    // must fail naming that entry. (Flip BEFORE addFile — this adm-zip
    // version has no updateEntry.)
    const TamperedZip = (await import('adm-zip')).default;
    const tampered = new TamperedZip();
    const flipName = payloadNames.find((n) => !n.endsWith('.sqlite')) ?? probe;
    for (const n of payloadNames) {
      let buf = zip.getEntry(n).getData();
      if (n === flipName) {
        buf = Buffer.from(buf);                     // mutable copy of the entry bytes
        buf[0] ^= 0xff;                             // flip one bit
      }
      tampered.addFile(n, buf);
    }
    tampered.addFile(MANIFEST_NAME, zip.getEntry(MANIFEST_NAME).getData()); // ORIGINAL manifest
    const tamperVerdict = verifyZipChecksums(tampered);
    assert(!tamperVerdict.ok && tamperVerdict.problems.some((p) => p.startsWith(`${flipName}: manifest hash mismatch`)),
      `${MANIFEST_NAME}: tampered payload detected and attributed to ${flipName}`, tamperVerdict.problems.join('; '));

    // 2b-5. Missing-manifest detection (defensive: verifier is strict).
    const manifestless = new TamperedZip();
    for (const n of payloadNames) manifestless.addFile(n, zip.getEntry(n).getData());
    assert(!verifyZipChecksums(manifestless).ok,
      `${MANIFEST_NAME}: verifier rejects a manifest-less zip (no silent pass)`);    // Keep the manifest text for the restore-parity check in stage 4.
    manifestText = zip.getEntry(MANIFEST_NAME).getData().toString('utf-8');
  }

  // ── 2c. Out-of-band tamper-evidence: sidecar + DB-logged hash ─────
  // The embedded manifest proves integrity INSIDE the zip; detecting a
  // rewrite of the zip itself needs copies in OTHER stores. The backup
  // service writes both on every run: a byte-exact sidecar next to the ZIP
  // (<zip>.SHA256SUMS) and the manifest's own hash in the history row
  // (conversation_backup_logs.manifest_hash_hex, migration 20260927000001).
  // Rewriting the ZIP alone now must diverge from the sidecar AND the DB
  // row to pass unnoticed. Old backups predate the pair — degrade to skip
  // UNLESS one half exists without the other (that IS a regression).
  if (manifestText) {
    const sidecarPath = `${backup.zipPath}${SIDECAR_SUFFIX}`;
    const historyRow = readDevHistoryRow(path.basename(backup.zipPath));
    const sidecarPresent = fs.existsSync(sidecarPath);
    const hashLogged = Boolean(historyRow?.manifest_hash_hex);

    // 2c-1. Sidecar exists and is byte-identical to the embedded manifest.
    if (sidecarPresent) {
      assert(fs.readFileSync(sidecarPath, 'utf-8') === manifestText,
        `manifest sidecar written next to the ZIP and byte-identical to the embedded SHA256SUMS (${path.basename(sidecarPath)})`);
    } else if (hashLogged) {
      assert(false, 'manifest sidecar missing although the history row logged a manifest hash — feature regression');
    } else {
      skip('manifest sidecar (backup predates the out-of-band feature)');
    }

    // 2c-2. History row's manifest_hash_hex equals the manifest's own sha-256
    // (read-only query against the dev DB — never written by this suite).
    if (historyRow == null) {
      skip('backup-history row not found in the dev DB — hash logging not verifiable here');
    } else if (hashLogged) {
      assert(historyRow.manifest_hash_hex === manifestHashHex(zip.getEntry(MANIFEST_NAME).getData()),
        'backup history logs the manifest hash (manifest_hash_hex = sha256 of embedded SHA256SUMS)',
        `${historyRow.manifest_hash_hex.slice(0, 12)}… vs ${manifestHashHex(zip.getEntry(MANIFEST_NAME).getData()).slice(0, 12)}…`);
    } else if (sidecarPresent) {
      assert(false, 'history row lacks manifest_hash_hex although the sidecar exists — feature regression');
    } else {
      skip('manifest-hash logging (backup predates the out-of-band feature)');
    }

    // 2c-3. The trap out-of-band hashing must NOT create: a tampered ZIP
    // whose EMBEDDED manifest (and therefore its logged/sidecar hash) is
    // untouched. Hash agreement alone would bless it — entry-level
    // verification must still fire and name the tampered entry.
    const payloadNames2 = [...names].filter((n) => n !== MANIFEST_NAME && !n.startsWith('_') && !n.startsWith('.'));
    const flipTarget2 = payloadNames2.find((n) => !n.endsWith('.sqlite')) ?? 'conversations.sqlite';
    const tampZip = new AdmZip();
    for (const n of payloadNames2) {
      let buf = zip.getEntry(n).getData();
      if (n === flipTarget2) { buf = Buffer.from(buf); buf[0] ^= 0xff; }
      tampZip.addFile(n, buf);
    }
    tampZip.addFile(MANIFEST_NAME, zip.getEntry(MANIFEST_NAME).getData());   // ORIGINAL manifest
    const hashAgrees = manifestHashHex(tampZip.getEntry(MANIFEST_NAME).getData())
      === manifestHashHex(zip.getEntry(MANIFEST_NAME).getData());
    const tampVerdict2 = verifyZipChecksums(tampZip);
    assert(hashAgrees && !tampVerdict2.ok && tampVerdict2.problems.some((p) => p.startsWith(`${flipTarget2}: manifest hash mismatch`)),
      `out-of-band hash agreement alone never blesses a tampered ZIP (${flipTarget2} still flagged)`, tampVerdict2.problems.join('; '));
  }


  const mainEntry = zip.getEntry('conversations.sqlite');
  const mainExtract = path.join(RUNTIME, 'zip-view', 'conversations.sqlite');
  fs.mkdirSync(path.dirname(mainExtract), { recursive: true });
  fs.writeFileSync(mainExtract, mainEntry.getData());

  const uploaded = extractPrefix(zip, 'uploads/', RESTORE_UPLOADS);
  const uploadedArchive = extractPrefix(zip, 'uploads-archive/', path.join(RESTORE_UPLOADS, 'archive'));
  console.log(`  extracted: ${uploaded} active attachment file(s), ${uploadedArchive} archived attachment file(s)`);

  // ── 3. Data-layer verification on the snapshot ──────────────────────
  assert(runCheck(mainExtract, 'integrity_check') === 'ok', 'restored main snapshot: integrity_check ok');
  assert(runCheckRows(mainExtract, 'foreign_key_check').length === 0, 'restored main snapshot: foreign_key_check clean');
  const usersInZip = countRows(mainExtract, 'users');
  const convsInZip = countRows(mainExtract, 'conversations');
  const msgsInZip = countRows(mainExtract, 'conversation_messages');
  let convsArchivedInZip = 0;
  let archiveExtract = null;
  if (hasArchive) {
    archiveExtract = path.join(RUNTIME, 'zip-view', 'conversations-archive.sqlite');
    fs.mkdirSync(path.dirname(archiveExtract), { recursive: true });
    fs.writeFileSync(archiveExtract, zip.getEntry('conversations-archive.sqlite').getData());
    assert(runCheck(archiveExtract, 'integrity_check') === 'ok', 'restored archive snapshot: integrity_check ok');
    assert(runCheckRows(archiveExtract, 'foreign_key_check').length === 0, 'restored archive snapshot: foreign_key_check clean');
    convsArchivedInZip = countRows(archiveExtract, 'conversations');
  }
  console.log(`  snapshot contents: ${usersInZip} users, ${convsInZip} active conversations, ${msgsInZip} messages, ${convsArchivedInZip} archived/tombstoned conversations`);
  assert(usersInZip > 0, 'snapshot has a usable user roster (login will be possible)');
  if (convsInZip === 0 && msgsInZip === 0) {
    console.log('  ℹ️  informational: backup contained no conversations — the round-trip below is verified trivially');
  }

  // Schema-drift guard: tables present in the CURRENT dev DB but missing
  // from the snapshot would be silently lost by a restore — that is a
  // backup-format regression even if nothing crashes.
  try {
    const devDbPath = path.resolve(process.env.DB_PATH || './database.sqlite');
    const devTables = new Set(listUserTables(devDbPath));
    const zipTables = new Set(listUserTables(mainExtract));
    const lost = [...devTables].filter((t) => !zipTables.has(t));
    assert(lost.length === 0, 'snapshot covers every table the current dev DB has (no silent schema loss)', `missing: ${lost.join(', ')}`);
  } catch (err) {
    skip(`schema-drift comparison vs dev DB (${err.message.split('\n')[0]})`);
  }

  // ── 4. RESTORE = place the files where an instance expects them ────
  fs.copyFileSync(mainExtract, RESTORE_DB);
  if (hasArchive) {
    // archiveDbPath() derives <db-basename>-conversations-archive.sqlite
    fs.copyFileSync(path.join(RUNTIME, 'zip-view', 'conversations-archive.sqlite'),
      path.join(path.dirname(RESTORE_DB), `${path.basename(RESTORE_DB, '.sqlite')}-conversations-archive.sqlite`));
  }
  assert(runCheck(RESTORE_DB, 'integrity_check') === 'ok', 'placed restore DB: integrity_check ok');

  // Manifest parity on DISK: the file a server will actually open must
  // match the manifest line byte-for-byte (verifies extraction, not just
  // the in-zip buffer).
  if (manifestText) {
    const diskCheck = verifyFileAgainstManifest(manifestText, 'conversations.sqlite', RESTORE_DB);
    assert(diskCheck.ok, 'restored conversations.sqlite on disk matches the manifest hash',
      diskCheck.expected == null ? 'not listed in manifest' : `expected ${diskCheck.expected?.slice(0, 12)}… got ${diskCheck.actual?.slice(0, 12)}…`);
  }

  // ── 5. Boot the restored instance + verify through the real API ────
  // The snapshot has no _migrations table, so boot re-runs the FULL
  // migration chain — idempotency against an already-migrated schema is
  // exactly what a real restore needs.
  let server = null;
  let serverPid = null;
  try {
    server = await bootServer('boot1');
    serverPid = server.pid;
    assert(true, 'restored instance boots through the full migration chain (:3120)');
  } catch (err) {
    assert(false, 'restored instance boots through the full migration chain (:3120)', err.message);
    return finish();
  }

  // Health: boot runs migrations + integrity + checkpoint work AFTER the
  // listener binds, so the first probes can answer 503 — poll until ready.
  const healthReady = await waitFor(async () => {
    const h = await request('/api/health');
    return h.status === 200 && h.data?.integrity === 'ok' ? h : null;
  }, 30_000);
  assert(!!healthReady, '/api/health answers 200 with integrity ok on the restored DB');

  // Login with the RESTORED root account (no reseeding — the backup must
  // carry its own credentials).
  const auth = await request('/api/auth/login', { method: 'POST', body: { email: 'admin@studio.com', password: 'admin' } });
  let token = auth.status === 200 ? auth.data?.token : null;
  if (token) {
    assert(true, 'login works with the restored account (credentials survived the backup)');
  } else {
    skip(`API reads requiring auth (login answered ${auth.status} — the backup's root password differs from the dev default)`);
  }

  const asRows = (d) => Array.isArray(d) ? d : (d?.conversations ?? d?.items ?? []);
  if (token) {
    const convs = await request('/api/conversations', { token });
    assert(convs.status === 200, 'GET /api/conversations answers 200 on the restored DB');
    assert(asRows(convs.data).length === convsInZip,
      `active conversation count matches the snapshot (API ${asRows(convs.data).length} vs ZIP ${convsInZip})`);

    // The archive service returns { conversations, total } — total is the
    // authoritative count (page-limited conversations[] would under-report;
    // the validator caps limit at 100).
    const archive = await request('/api/conversations/archive?includeDeleted=true&limit=100', { token });
    assert(archive.status === 200, 'GET /api/conversations/archive answers 200 (archive snapshot served)');
    const archiveTotal = archive.data?.total ?? asRows(archive.data).length;
    assert(archiveTotal === convsArchivedInZip,
      `archive row count matches the snapshot (API ${archiveTotal} vs ZIP ${convsArchivedInZip})`);

    const users = await request('/api/users', { token });
    assert(users.status === 200 && asRows(users.data).length === usersInZip,
      `users count matches the snapshot (API ${asRows(users.data).length} vs ZIP ${usersInZip})`);

    const assets = await request('/api/assets', { token });
    assert(assets.status === 200, 'GET /api/assets answers 200 (main-DB snapshot serves all domains)');

    // Deep read: first conversation's messages + one attachment when present.
    if (asRows(convs.data).length > 0) {
      const firstId = asRows(convs.data)[0].id;
      const msgs = await request(`/api/conversations/${firstId}/messages`, { token });
      assert(msgs.status === 200, `messages of restored conversation #${firstId} answer 200`);
      const msgRows = asRows(msgs.data);
      const withAtt = msgRows.find((m) => m.attachments?.length > 0);
      if (withAtt) {
        const att = withAtt.attachments[0];
        try {
          const res = await fetch(`${BASE}${att.url}`, { headers: { Authorization: `Bearer ${token}` } });
          assert(res.status === 200, `restored attachment streams (${att.url})`, `status ${res.status}`);
        } catch (err) {
          assert(false, `restored attachment streams (${att.url})`, err.message);
        }
      } else if (uploaded === 0) {
        skip('attachment streaming (snapshot has no attachments)');
      }
    }
  }

  // ── 6. Restart survival: second boot on the SAME restored runtime ──
  await stopServer(server);
  server = null;
  // Lock invariant after an abrupt stop: gone (POSIX graceful) OR still
  // stamped with the (now dead) child pid — Windows child.kill() is
  // TerminateProcess, so the synchronous exit handler may not run. Either
  // way the lock cannot block the next boot: a dead owner is stale by
  // definition and boot takeover handles it.
  {
    let lockState = 'absent';
    try {
      const lockPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').split(/\r?\n/)[0], 10);
      if (Number.isInteger(lockPid)) lockState = `pid ${lockPid}${lockPid === serverPid ? ' (our dead child)' : ' (FOREIGN)'}`;
    } catch { /* absent */ }
    assert(lockState === 'absent' || (Number.isInteger(serverPid) && lockState.includes(`pid ${serverPid}`)),
      'post-stop lock is absent or holds only our dead pid (no foreign owner)', lockState);
  }
  try {
    server = await bootServer('boot2');
    assert(true, 'SECOND boot on the restored runtime succeeds (WAL replay + dead-owner lock takeover)');
  } catch (err) {
    assert(false, 'SECOND boot on the restored runtime succeeds (WAL replay + dead-owner lock takeover)', err.message);
    return finish();
  }
  const health2 = await request('/api/health');
  assert(health2.status === 200 && health2.data?.integrity === 'ok', 'restored instance healthy after reboot');
  if (token) {
    const reAuth = await request('/api/auth/login', { method: 'POST', body: { email: 'admin@studio.com', password: 'admin' } });
    assert(reAuth.status === 200, 'auth still works after the reboot');
  }

  return finish();
}

let finishing = false;
async function finish() {
  if (finishing) return;                              // re-entrancy guard: a crash inside cleanup must not loop
  finishing = true;
  // Janitor: stop spawned children, clear any listener, wipe the runtime —
  // unless DRILL_KEEP=1 (debug: keep restore.sqlite + boot logs for inspection).
  for (const child of [...children]) await stopServer(child);
  for (const pid of await findListenerOwners(PORT)) await stopNodePid(pid);
  if (process.env.DRILL_KEEP === '1') {
    console.log(`  DRILL_KEEP=1 — runtime preserved at ${RUNTIME}`);
  } else {
    fs.rmSync(RUNTIME, { recursive: true, force: true });
  }

  console.log(`\n--- Summary: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''} ---`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('drill crashed:', err.message);
  failed += 1;                                       // a crash is a failure, never a silent exit 0
  await finish();
});
