#!/usr/bin/env node
/**
 * scripts/verifyBackup.js — `npm run verify:backup <zip>` — standalone
 * tamper-evidence check for a conversation backup ZIP.
 *
 * Works WITHOUT the QA stack — no dev server, no suites. One command an
 * operator runs against a ZIP on the backup volume before trusting a
 * restore. The three stores of backupChecksums.js' trust model are checked
 * independently, and the report says WHICH store disagrees:
 *
 *   1. ZIP self-verification — the embedded SHA256SUMS vs every payload
 *      entry (verifyZipChecksums). Catches accidental corruption (truncated
 *      download, bad sector) and any entry rewrite that kept the OLD
 *      manifest.
 *   2. Sidecar — <zip>.SHA256SUMS next to the ZIP must be byte-identical to
 *      the embedded manifest. Missing ⇒ [warn] (backup predates the feature
 *      or the sidecar was lost — out-of-band evidence degraded, not proven
 *      false). Present-but-different ⇒ [fail].
 *   3. History DB — conversation_backup_logs.manifest_hash_hex for this
 *      filename must equal sha256(embedded manifest). Read-only
 *      better-sqlite3 peek (WAL allows one extra reader next to a live
 *      server — never a writer here). Row absent or hash null ⇒ [warn]
 *      (pre-feature row, or a ZIP copied in from elsewhere); a PRESENT hash
 *      that disagrees ⇒ [fail].
 *
 * A rewritten ZIP+manifest pair passes store 1 by construction — exactly
 * why stores 2 and 3 exist; the verdict is only TRUSTED when every store
 * that is PRESENT agrees (and at least the ZIP self-check ran).
 *
 * Exit codes:
 *   0 — every present store agrees (pre-feature backups with only the
 *       embedded manifest verify and exit 0, with the degradation shown)
 *   1 — verification failed: unreadable/manifest-less ZIP, sidecar
 *       divergence, or DB-logged hash divergence. DO NOT TRUST the backup.
 *   2 — usage error (no argument given)
 *
 * The <zip> argument accepts an absolute/relative path, or a bare filename
 * which is resolved against the configured backup directory (system_settings
 * 'backup_path' read from the history DB → BACKUP_PATH from the environment
 * /.env → ./backups) — the same chain conversationBackupService.js uses.
 *
 * DB resolution mirrors testBackupRestoreDrill.js' readDevHistoryRow:
 * DB_PATH from the environment/.env or ./database.sqlite. server/config/env.js
 * is deliberately NOT imported (it throws in production without JWT_SECRET);
 * the handful of keys this tool needs are read from the environment and the
 * repo .env directly, process environment winning.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { MANIFEST_NAME, SIDECAR_SUFFIX, manifestHashHex, verifyZipChecksums } from '../server/utils/backupChecksums.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read one key from the repo .env — process environment wins. Inline
 *  comments and surrounding quotes stripped (same rules as doctor's envGet,
 *  minus the caching complexity — this CLI reads at most three keys). */
function envGet(key) {
  if (process.env[key] !== undefined) return process.env[key];
  try {
    const body = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
    const m = body.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'));
    if (!m) return null;
    return m[1].trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
  } catch {
    return null;
  }
}

/** Read-only peek into the backup-history DB. Unlike the drill (which
 *  degrades every problem to a silent skip), an operator tool must say WHY
 *  a store is unverifiable — so failure kinds are reported, never swallowed.
 *  Also returns system_settings.backup_path (null when unreadable) so the
 *  ZIP-argument search can use the same directory the app itself uses. */
function peekHistoryRow(dbPath, filename) {
  if (!fs.existsSync(dbPath)) return { kind: 'no-db', message: `${dbPath} not found — no history DB at the resolved DB_PATH`, settingsPath: null };
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    return { kind: 'error', message: `could not open ${dbPath} read-only: ${err.message}`, settingsPath: null };
  }
  try {
    const settingsPath = db.prepare("SELECT value FROM system_settings WHERE key = 'backup_path'").get()?.value ?? null;
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_backup_logs'").get();
    if (!table) return { kind: 'no-table', message: 'conversation_backup_logs table absent (database predates the backup-history schema)', settingsPath };
    const row = db.prepare('SELECT id, status, manifest_hash_hex FROM conversation_backup_logs WHERE filename = ? ORDER BY id DESC LIMIT 1').get(filename) ?? null;
    return { kind: 'row', row, settingsPath };
  } catch (err) {
    return { kind: 'error', message: `history query failed: ${err.message}`, settingsPath: null };
  } finally {
    db.close();
  }
}

/** Resolve the ZIP argument: as-given path, or a bare filename searched in
 *  the configured backup directory chain. Returns { zipPath, candidates } —
 *  zipPath null when nothing exists (candidates listed in the error). */
function resolveZipArg(arg, settingsBackupPath) {
  const asGiven = path.resolve(process.cwd(), arg);
  if (fs.existsSync(asGiven)) return { zipPath: asGiven, candidates: [asGiven] };
  if (path.isAbsolute(arg) || /[\\/]/.test(arg)) {
    return { zipPath: null, candidates: [asGiven] };   // explicit path that does not exist — no guessing
  }
  const dirs = [settingsBackupPath, envGet('BACKUP_PATH') || './backups'].filter(Boolean);
  const candidates = [...new Set(dirs.map((d) => path.resolve(ROOT, d, arg)))];
  const found = candidates.find((c) => fs.existsSync(c));
  return { zipPath: found ?? null, candidates };
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npm run verify:backup <conversations-backup-<timestamp>.zip | path/to/backup.zip>');
    process.exit(2);
  }

  const dbPath = path.resolve(ROOT, envGet('DB_PATH') || './database.sqlite');
  const historyPeek = peekHistoryRow(dbPath, path.basename(arg));
  const { zipPath, candidates } = resolveZipArg(arg, historyPeek.settingsPath);
  if (!zipPath) {
    console.error(`[fail]  ZIP not found — searched: ${candidates.join(', ')}`);
    process.exit(1);
  }

  console.log(`Verifying: ${path.basename(zipPath)}`);
  console.log(`  zip      ${zipPath}`);
  console.log(`  history  ${dbPath}`);
  console.log('');

  // ── 1. ZIP self-verification (embedded manifest vs payload) ─────────
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (err) {
    console.error(`[fail]  not a readable ZIP: ${err.message}`);
    console.error('VERDICT: FAILED — the file is not a valid backup archive');
    process.exit(1);
  }
  const verdict1 = verifyZipChecksums(zip);
  const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(0);
  if (verdict1.ok) {
    console.log(`[ok]    ${MANIFEST_NAME}: ${verdict1.checked} entr${verdict1.checked === 1 ? 'y' : 'ies'} hashed and verified (${sizeKb} KB zip)`);
  } else {
    for (const p of verdict1.problems) console.error(`[fail]  ${p}`);
    console.error('VERDICT: FAILED — ZIP content does not match its embedded manifest. Do not restore from this file.');
    process.exit(1);
  }
  const manifestBuf = zip.getEntry(MANIFEST_NAME).getData();   // verifyZipChecksums just demanded it
  const embeddedHash = manifestHashHex(manifestBuf);
  let storesAgreeing = 1;                                      // the ZIP self-check just passed
  let storesPresent = 1;
  let partial = false;

  // ── 2. Sidecar (<zip>.SHA256SUMS next to the ZIP) ───────────────────
  const sidecarPath = `${zipPath}${SIDECAR_SUFFIX}`;
  if (!fs.existsSync(sidecarPath)) {
    console.warn(`[warn]  sidecar missing: ${path.basename(sidecarPath)} — out-of-band tamper-evidence degraded (backup predates the feature, or the sidecar was lost/deleted)`);
    partial = true;
  } else {
    storesPresent += 1;
    const sidecar = fs.readFileSync(sidecarPath);
    if (sidecar.equals(manifestBuf)) {
      console.log(`[ok]    sidecar ${path.basename(sidecarPath)} is byte-identical to the embedded ${MANIFEST_NAME}`);
      storesAgreeing += 1;
    } else {
      console.error(`[fail]  sidecar ${path.basename(sidecarPath)} DIVERGES from the embedded ${MANIFEST_NAME}`);
      console.error(`        sidecar hashes to ${manifestHashHex(sidecar).slice(0, 16)}…, embedded manifest to ${embeddedHash.slice(0, 16)}…`);
      console.error('        The ZIP or the sidecar was modified after the backup ran — sidecars are never rewritten.');
      console.error('VERDICT: FAILED — do not trust this backup');
      process.exit(1);
    }
  }

  // ── 3. History DB (manifest_hash_hex) ───────────────────────────────
  if (historyPeek.kind === 'row') {
    const { row } = historyPeek;
    if (!row) {
      console.warn('[warn]  no history row for this filename — the backup was not logged by this checkout\'s database (moved/copied in from elsewhere?)');
      partial = true;
    } else if (!row.manifest_hash_hex) {
      console.warn(`[warn]  history row #${row.id} predates hash logging (migration 20260927000001) — no manifest_hash_hex recorded`);
      partial = true;
    } else if (row.manifest_hash_hex === embeddedHash) {
      console.log(`[ok]    history row #${row.id}: manifest_hash_hex matches (${embeddedHash.slice(0, 16)}…)`);
      storesAgreeing += 1;
      storesPresent += 1;
    } else {
      console.error(`[fail]  history row #${row.id} logs a DIFFERENT manifest hash: ${row.manifest_hash_hex.slice(0, 16)}… vs embedded ${embeddedHash.slice(0, 16)}…`);
      console.error('        The ZIP\'s manifest was rewritten after the backup ran — the history DB is never rewritten by backups.');
      console.error('VERDICT: FAILED — do not trust this backup');
      process.exit(1);
    }
  } else {
    console.warn(`[warn]  history DB unverifiable: ${historyPeek.message}`);
    partial = true;
  }

  // ── Verdict ─────────────────────────────────────────────────────────
  console.log('');
  if (partial) {
    console.log(`VERDICT: OK (${storesAgreeing}/${storesPresent} present stores agree) — embedded manifest verified, out-of-band evidence incomplete (see [warn] rows)`);
  } else {
    console.log(`VERDICT: TRUSTED — all ${storesAgreeing} stores agree (ZIP manifest, sidecar, history DB hash)`);
  }
}

main();
