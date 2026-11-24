#!/usr/bin/env node
/**
 * scripts/testAttachmentOwnership.js — File-ownership hardening contract.
 *
 * Fully isolated: own port :3120, own DB, own uploads tree, own lock/runtime.
 * Boots the real server against a fresh DB, then manufactures basename
 * collisions that the API itself can never produce (IDs unique per row,
 * INSERT-not-REPLACE) to prove the purge/move guards hold:
 *
 *   1. Purge with a basename collision in the ACTIVE tree (an active
 *      conversation's row references the basename our archived row points
 *      at) → 409 refusal; the foreign active file survives.
 *   2. Purge with a basename collision inside the ARCHIVE tree (a foreign
 *      archived conversation shares the basename) → 409 refusal.
 *   3. Clean purge (no collisions) → rows gone, both file copies deleted.
 *   4. Restore with a foreign clobber occupying the destination → refused;
 *      the foreign file is NOT overwritten; retry after clearing succeeds.
 *
 * Run: node scripts/testAttachmentOwnership.js
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { findListenerOwners, stopNodePid } from '../server/utils/appLock.js';

const PORT = 3120;
const BASE = `http://localhost:${PORT}`;
const RUNTIME = path.resolve('scripts/.runtime/attownership');
const LOCK_FILE = path.join(RUNTIME, 'attownership.lock');
const DB_FILE = path.join(RUNTIME, 'attownership.sqlite');
const ARCHIVE_DB_FILE = path.join(RUNTIME, 'attownership-conversations-archive.sqlite');
const UPLOADS = path.join(RUNTIME, 'uploads');
const ACTIVE_DIR = path.join(UPLOADS, 'conversations');
const ARCHIVE_DIR = path.join(UPLOADS, 'archive', 'conversations');

// Isolation is env-only (DB_PATH, UPLOADS_DIR, LOG_DIR, BACKUP_PATH,
// APP_LOCK_FILE) with the PROJECT-ROOT cwd — umzug migrations resolve
// migration files relative to cwd, so a non-root cwd breaks boot. The
// UPLOADS_DIR override keeps uploadsRoot() inside the runtime dir.
const SERVER_CWD = path.resolve('.');

let passed = 0, failed = 0;
function assert(cond, msg, detail = '') {
  if (cond) { console.log(`PASS - ${msg}`); passed++; }
  else { console.log(`FAIL - ${msg}${detail ? ` — ${detail}` : ''}`); failed++; }
}
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

function mkdb() { return new Database(DB_FILE); }

function seedRoot(db) {
  // Password hash is irrelevant for these flows (purge/move are driven
  // directly); a fixed placeholder keeps the users table satisfied.
  db.prepare(`INSERT INTO users (name, email, role, password_hash, requires_password_change)
              VALUES ('root', 'root@attown.test', 'IT Admin', 'x', 0)`).run();
}

function seedConversation(db, { title }) {
  const info = db.prepare(
    `INSERT INTO conversations (title, type, created_by, is_archived) VALUES (?, 'standalone', 1, 0)`
  ).run(title);
  const convId = Number(info.lastInsertRowid);
  db.prepare(`INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, 1, 'member')`).run(convId);
  const msg = db.prepare(`INSERT INTO conversation_messages (conversation_id, user_id, content) VALUES (?, 1, 'seed')`).run(convId);
  return { convId, msgId: Number(msg.lastInsertRowid) };
}

function seedAttachment(db, { msgId, filename, relPath }) {
  const info = db.prepare(
    `INSERT INTO message_attachments (message_id, filename, file_path, file_size, mime_type)
     VALUES (?, ?, ?, 11, 'text/plain')`
  ).run(msgId, filename, relPath);
  return Number(info.lastInsertRowid);
}

function putFile(treeDir, name, bytes = 'attachment') {
  fs.mkdirSync(treeDir, { recursive: true });
  fs.writeFileSync(path.join(treeDir, name), bytes);
}

/**
 * Run an engine call in a fresh node process with the isolated env, from
 * SERVER_CWD so uploadsRoot() lands in the runtime uploads tree.
 * Returns { ok, result } on success, { ok: false, refused, error } on a
 * clean refusal (marker in stderr), and THROWS on infra crashes (import
 * failures, syntax errors) so the suite never mistakes a crash for a
 * refusal.
 */
const REFUSAL_RE = /Refusing purge|clobber refused/;
const INFRA_RE = /ERR_UNSUPPORTED|Cannot find module|SyntaxError|ReferenceError/;
async function runEngine(label, expression) {
  const out = path.join(RUNTIME, `${label}.out.json`);
  const errFile = path.join(RUNTIME, `${label}.err.log`);
  const body = `
    const fs = await import('node:fs');
    const m = await import(${JSON.stringify(pathToFileURL(path.resolve('server/services/conversationArchiveService.js')).href)});
    let r = null;
    try { r = await (${expression}); } catch (e) { console.error((e && e.message) || String(e)); process.exit(1); }
    fs.writeFileSync(${JSON.stringify(out.replace(/\\/g, '/'))}, JSON.stringify(r ?? null));
    process.exit(0);
  `;
  const code = await new Promise((resolve) => {
    const errFd = fs.openSync(errFile, 'w');
    const child = spawn(process.execPath, ['--input-type=module', '-e', body], {
      cwd: SERVER_CWD,
      env: { ...process.env, DB_PATH: DB_FILE, UPLOADS_DIR: UPLOADS, LOG_DIR: path.join(RUNTIME, 'logs') },
      stdio: ['ignore', 'ignore', errFd],
    });
    child.once('exit', () => { fs.closeSync(errFd); resolve(child.exitCode); });
  });
  if (code === 0) {
    try { return { ok: true, result: JSON.parse(fs.readFileSync(out, 'utf8')) }; }
    catch { return { ok: true, result: null }; }
  }
  const stderr = fs.readFileSync(errFile, 'utf8');
  if (INFRA_RE.test(stderr)) throw new Error(`engine infra failure in ${label}:\n${stderr.slice(0, 600)}`);
  const msg = stderr.trim().split(/\r?\n/).pop() || '';
  return { ok: false, refused: REFUSAL_RE.test(stderr), error: msg, stderr };
}

const children = new Set();
function bootServer() {
  const log = fs.openSync(path.join(RUNTIME, 'server.log'), 'a');
  const child = spawn(process.execPath, [path.resolve('server/index.js')], {
    cwd: SERVER_CWD,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: DB_FILE,
      UPLOADS_DIR: UPLOADS,
      LOG_DIR: path.join(RUNTIME, 'logs'),
      BACKUP_PATH: path.join(RUNTIME, 'backups'),
      APP_LOCK_FILE: LOCK_FILE,
    },
    stdio: ['ignore', log, log],
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return waitFor(async () => {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return child; } catch { /* booting */ }
    return null;
  }, 25_000).then((up) => { if (!up) throw new Error('server never became healthy — see scripts/.runtime/attownership/server.log'); return child; });
}

async function janitor() {
  for (const pid of await findListenerOwners(PORT)) await stopNodePid(pid);
  for (const c of children) { try { c.kill(); } catch {} }
  await sleep(800);
  // Windows can hold directory/file handles for a moment after kills — retry.
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(RUNTIME, { recursive: true, force: true }); return; }
    catch (e) { if (i === 4) console.log(`WARN - runtime cleanup failed (locked?): ${e.code || e.message}`); await sleep(600); }
  }
}

/* ───────────────────────── suite ───────────────────────── */

await janitor();
fs.mkdirSync(RUNTIME, { recursive: true });

let db = null;
try {
  await bootServer();
  db = mkdb();

  seedRoot(db);

  // Warm-up: forces the engine (and its archive DB schema) to initialize in
  // the isolated env — also proves the import works before real assertions.
  const warm = await runEngine('warm', 'm.getStorageStats()');
  assert(warm && warm.ok, 'fixture: engine import + archive DB bootstrap');

  // ── Fixture: archived conversation "A" with attachment shared.txt ──
  const A = seedConversation(db, { title: 'victim A' });
  seedAttachment(db, { msgId: A.msgId, filename: 'shared.txt', relPath: 'conversations/shared.txt' });
  putFile(ACTIVE_DIR, 'shared.txt', 'A-bytes');

  const archRes = await runEngine('arch-A', `m.archiveConversation(${A.convId}, { reason: 'fixture' })`);
  assert(archRes.ok && archRes.result?.moved === 1, 'fixture: archive A moves its file', JSON.stringify(archRes.result));
  assert(fs.existsSync(path.join(ARCHIVE_DIR, 'shared.txt')), 'fixture: A file now in archive tree');
  assert(!fs.existsSync(path.join(ACTIVE_DIR, 'shared.txt')), 'fixture: A file gone from active tree');

  // ── Scenario 1: active-tree collision → purge refuses, foreign file survives ──
  {
    // A seeded ACTIVE conversation now references the same basename.
    const S = seedConversation(db, { title: 'active-foreigner' });
    seedAttachment(db, { msgId: S.msgId, filename: 'shared.txt', relPath: 'conversations/shared.txt' });
    putFile(ACTIVE_DIR, 'shared.txt', 'S-bytes');

    const refusal = await runEngine('purge-s1', `m.purgeArchivedConversation(${A.convId}, { actorUser: { id: 1, name: 'root' } })`);
    assert(!refusal.ok && refusal.refused, 'S1: purge refuses with active-tree collision (threw 409)', refusal.error);
    assert(fs.existsSync(path.join(ACTIVE_DIR, 'shared.txt')), 'S1: foreign ACTIVE file survives');
    assert(fs.readFileSync(path.join(ACTIVE_DIR, 'shared.txt'), 'utf8') === 'S-bytes', 'S1: foreign ACTIVE content intact');

    // Cleanup: remove the collision, delete the foreign conversation rows.
    db.prepare(`DELETE FROM message_attachments WHERE message_id = ?`).run(S.msgId);
    db.prepare('DELETE FROM conversation_messages WHERE id = ?').run(S.msgId);
    db.prepare('DELETE FROM conversation_participants WHERE conversation_id = ?').run(S.convId);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(S.convId);
    fs.rmSync(path.join(ACTIVE_DIR, 'shared.txt'));
  }

  // ── Scenario 2: archive-tree collision → purge refuses ──
  {
    // Foreign archived conversation B lives ONLY in the archive DB (a legacy
    // import that never touched the active DB) and shares the basename. Its
    // file is the same physical file A's row points at — one row extra.
    const adb = new Database(ARCHIVE_DB_FILE);
    adb.prepare(
      `INSERT INTO conversations (id, title, type, created_by, is_archived, archived_at)
       VALUES (900001, 'arch-foreigner', 'standalone', 1, 1, datetime('now'))`
    ).run();
    const msgB = adb.prepare(
      `INSERT INTO conversation_messages (conversation_id, user_id, content) VALUES (900001, 1, 'b')`
    ).run();
    adb.prepare(
      `INSERT INTO message_attachments (message_id, filename, file_path, file_size, mime_type)
       VALUES (?, 'shared.txt', 'conversations/shared.txt', 11, 'text/plain')`
    ).run(Number(msgB.lastInsertRowid));
    adb.close();

    const refusal = await runEngine('purge-s2', `m.purgeArchivedConversation(${A.convId}, { actorUser: { id: 1, name: 'root' } })`);
    assert(!refusal.ok && refusal.refused, 'S2: purge refuses with archive-tree collision (threw 409)', refusal.error);
    assert(fs.existsSync(path.join(ARCHIVE_DIR, 'shared.txt')), 'S2: shared ARCHIVE file survives');

    // Remove the collision rows so the next scenario is clean.
    const adb2 = new Database(ARCHIVE_DB_FILE);
    adb2.prepare(`DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM conversation_messages WHERE conversation_id = 900001)`).run();
    adb2.prepare('DELETE FROM conversation_messages WHERE conversation_id = 900001').run();
    adb2.prepare('DELETE FROM conversations WHERE id = 900001').run();
    adb2.close();
  }

  // ── Scenario 3: clean purge → rows gone, both file copies deleted ──
  {
    putFile(ACTIVE_DIR, 'shared.txt', 'stale-copy'); // simulate pre-move residue

    const purge = await runEngine('purge-s3', `m.purgeArchivedConversation(${A.convId}, { actorUser: { id: 1, name: 'root' } })`);
    assert(purge.ok && purge.result?.filesDeleted >= 1, 'S3: purge succeeds and deletes files', JSON.stringify(purge.result));
    assert(!fs.existsSync(path.join(ACTIVE_DIR, 'shared.txt')), 'S3: active copy gone');
    assert(!fs.existsSync(path.join(ARCHIVE_DIR, 'shared.txt')), 'S3: archive copy gone');

    const adb3 = new Database(ARCHIVE_DB_FILE);
    const gone = adb3.prepare('SELECT COUNT(*) AS n FROM conversations WHERE id = ?').get(A.convId);
    adb3.close();
    assert(gone.n === 0, 'S3: archive rows gone');
  }

  // ── Scenario 4: restore with foreign clobber at destination → refused ──
  {
    // Fresh archived conversation C with its file in the archive tree only.
    const C = seedConversation(db, { title: 'restore-victim' });
    seedAttachment(db, { msgId: C.msgId, filename: 'c.txt', relPath: 'conversations/c.txt' });
    putFile(ACTIVE_DIR, 'c.txt', 'C-bytes');
    await runEngine('arch-C', `m.archiveConversation(${C.convId}, { reason: 'fixture' })`);
    assert(fs.existsSync(path.join(ARCHIVE_DIR, 'c.txt')), 'fixture: C archived, file in archive tree');

    // Foreign file occupies the active-tree destination.
    putFile(ACTIVE_DIR, 'c.txt', 'FOREIGN-bytes');

    const restore = await runEngine('restore-s4', `m.restoreConversation(${C.convId}, { actorUser: { id: 1, name: 'root' } })`);
    assert(!restore.ok && restore.refused, 'S4: restore refuses on clobbered destination', restore.error);
    assert(fs.readFileSync(path.join(ACTIVE_DIR, 'c.txt'), 'utf8') === 'FOREIGN-bytes', 'S4: foreign file NOT overwritten');

    // Clear the clobber; retry succeeds and lands C's file.
    fs.rmSync(path.join(ACTIVE_DIR, 'c.txt'));
    const retry = await runEngine('restore-s4b', `m.restoreConversation(${C.convId}, { actorUser: { id: 1, name: 'root' } })`);
    assert(retry.ok && typeof retry.result?.moved === 'number', 'S4: restore retry succeeds after clearing', JSON.stringify(retry.result));
    assert(fs.existsSync(path.join(ACTIVE_DIR, 'c.txt')), 'S4: C file restored to active tree');
    assert(fs.readFileSync(path.join(ACTIVE_DIR, 'c.txt'), 'utf8') === 'C-bytes', 'S4: restored content is C-bytes');
  }
} catch (err) {
  failed++;
  console.log(`FAIL - suite aborted: ${err.message}`);
} finally {
  try { if (db) db.close(); } catch {}
  await janitor();
}

console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
