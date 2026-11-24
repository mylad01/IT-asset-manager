import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import env from '../config/env.js';
import * as settingsModel from '../models/settingsModel.js';
import * as backupLogModel from '../models/conversationBackupLogModel.js';
import { pushBackupProgress } from './wsServer.js';
import logger from '../utils/logger.js';
import { buildChecksumsManifest, manifestHashHex, MANIFEST_NAME, SIDECAR_SUFFIX } from '../utils/backupChecksums.js';
// Every backup ZIP carries a SHA256SUMS manifest (sha256sum-compatible) so a
// restored ZIP can be self-verified — see server/utils/backupChecksums.js.
// Out-of-band tamper-evidence: a byte-exact SIDECAR copy of the manifest is
// written next to the ZIP (<zip>.SHA256SUMS) and the manifest's own hash is
// recorded in the backup-history row (manifest_hash_hex). Rewriting the ZIP
// alone no longer hides a tamper: it must diverge from the sidecar AND from
// the DB-logged hash to pass unnoticed.

export async function runConversationBackup(userId) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `conversations-backup-${timestamp}.zip`;

  let backupPath = await settingsModel.getBackupPath();
  if (!backupPath) {
    backupPath = env.BACKUP_PATH || './backups';
  }

  const fullPath = path.join(backupPath, filename);
  const stagingDbPath = path.join(path.dirname(fullPath), `.staging-conv-${timestamp}.sqlite`);
  // Out-of-band manifest sidecar (<zip>.SHA256SUMS); declared out here so
  // the failure path can remove a partially written copy.
  let sidecarPath = null;

  try {
    await fs.mkdir(backupPath, { recursive: true });

    pushBackupProgress(userId, { stage: 'db-backup', progress: 5, type: 'conversation' });

    await backupConversationTables(stagingDbPath);
    pushBackupProgress(userId, { stage: 'db-backup', progress: 30, type: 'conversation' });

    // v2 hard-move: archived + recycle-binned conversations live in a
    // dedicated SQLite file — snapshot it too, so a backup round-trip
    // restores the archive as well.
    const stagingArchivePath = path.join(path.dirname(fullPath), `.staging-arch-${timestamp}.sqlite`);
    await backupArchiveDb(stagingArchivePath);

    await createConversationZip(fullPath, stagingDbPath, stagingArchivePath, userId, (progress) => {
      pushBackupProgress(userId, { stage: 'zip', progress: 30 + Math.floor(progress * 0.6), type: 'conversation' });
    });
    pushBackupProgress(userId, { stage: 'zip', progress: 90, type: 'conversation' });

    await fs.unlink(stagingDbPath).catch(() => {});
    await fs.unlink(stagingArchivePath).catch(() => {});
    pushBackupProgress(userId, { stage: 'complete', progress: 100, type: 'conversation' });

    const stats = await fs.stat(fullPath);

    // Out-of-band tamper-evidence: extract the embedded manifest, hash it,
    // write the byte-exact sidecar next to the ZIP, and record the hash in
    // the history row (migration 20260927000001's manifest_hash_hex).
    // The sidecar write is best-effort: a read-only backup dir must not
    // fail an otherwise complete backup, but a miss is logged loudly.
    const zip = new AdmZip(fullPath);
    const manifestEntry = zip.getEntry(MANIFEST_NAME);
    const manifestBuf = manifestEntry ? manifestEntry.getData() : null;
    const recordedHash = manifestBuf ? manifestHashHex(manifestBuf) : null;
    if (manifestBuf) {
      sidecarPath = `${fullPath}${SIDECAR_SUFFIX}`;
      try {
        await fs.writeFile(sidecarPath, manifestBuf);
      } catch (sidecarErr) {
        logger.warn({ err: sidecarErr, sidecarPath, filename }, 'Backup manifest sidecar could not be written — out-of-band tamper-evidence degraded (ZIP-embedded manifest still present)');
        sidecarPath = null;
      }
    } else {
      logger.warn({ filename }, 'Backup ZIP has no SHA256SUMS entry — manifest hash NOT recorded in history');
    }

    await backupLogModel.logBackup({ filename, sizeBytes: stats.size, status: 'success', manifestHashHex: recordedHash });

    const duration = Date.now() - startTime;
    pushBackupProgress(userId, { stage: 'complete', progress: 100, filename, sizeBytes: stats.size, type: 'conversation' });

    logger.info({ filename, sizeBytes: stats.size, duration, userId }, 'Conversation backup completed');
    return { success: true, filename, sizeBytes: stats.size, path: fullPath };
  } catch (err) {
    await fs.unlink(stagingDbPath).catch(() => {});
    await fs.unlink(stagingArchivePath).catch(() => {});
    await fs.unlink(fullPath).catch(() => {});
    if (sidecarPath) await fs.unlink(sidecarPath).catch(() => {});

    try {
      await backupLogModel.logBackup({ filename, sizeBytes: 0, status: 'failed', errorMessage: err.message });
    } catch (logErr) {
      logger.error({ err: logErr, filename }, 'Failed to log conversation backup failure');
    }

    pushBackupProgress(userId, { stage: 'failed', progress: 0, error: err.message, type: 'conversation' });
    logger.error({ err, filename, userId }, 'Conversation backup failed');
    throw err;
  }
}

async function backupConversationTables(stagingPath) {
  const dbPath = env.DB_PATH || './database.sqlite';
  const sourceDb = new Database(dbPath, { readonly: true });

  try {
    const newDb = new Database(stagingPath);

    newDb.exec('PRAGMA foreign_keys = OFF');

    const allTables = sourceDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations'`).all();

    for (const { name: table } of allTables) {
      const rows = sourceDb.prepare(`SELECT * FROM ${table}`).all();

      const createStmt = sourceDb.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table);
      if (createStmt?.sql) {
        newDb.exec(`DROP TABLE IF EXISTS ${table}`);
        newDb.exec(createStmt.sql);
      }

      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const insert = newDb.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);

      for (const row of rows) {
        insert.run(...columns.map(c => row[c]));
      }
    }

    newDb.exec('PRAGMA foreign_keys = ON');

    newDb.close();
  } finally {
    sourceDb.close();
  }
}

/**
 * Online backup of the archive DB (v2 hard-move). Uses better-sqlite3's
 * backup() API on a read-only source handle — do NOT open the destination
 * with better-sqlite3 first (pre-creating it deadlocks SQLITE_BUSY), and do
 * not copy the live file (WAL tail would be missed).
 */
async function backupArchiveDb(stagingPath) {
  const { archiveDbPath } = await import('../db/archiveDb.js');
  const archivePath = archiveDbPath();
  if (!fsSync.existsSync(archivePath)) return; // nothing archived yet

  const src = new Database(archivePath, { readonly: true });
  try {
    await src.backup(stagingPath);
  } finally {
    src.close();
  }
}

async function createConversationZip(zipPath, stagingDbPath, stagingArchivePath, userId, onProgress) {
  const zip = new AdmZip();

  const dbBuffer = await fs.readFile(stagingDbPath);
  zip.addFile('conversations.sqlite', dbBuffer);
  onProgress?.(0.2);

  // Archive DB snapshot (skipped gracefully when the archive is empty and
  // the staging file was never created).
  if (stagingArchivePath && await fs.stat(stagingArchivePath).then(() => true).catch(() => false)) {
    const archBuffer = await fs.readFile(stagingArchivePath);
    zip.addFile('conversations-archive.sqlite', archBuffer);
  }
  onProgress?.(0.3);

  const convUploadsDir = path.resolve(process.cwd(), 'uploads', 'conversations');
  try {
    const files = await getAllFiles(convUploadsDir);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = path.relative(convUploadsDir, file);
      const fileBuffer = await fs.readFile(file);
      // Forward slashes: manifest entry names must match the stored name
      // byte-for-byte on every OS (sha256sum-compatible manifest).
      zip.addFile(`uploads/${relativePath.split(path.sep).join('/')}`, fileBuffer);
      onProgress?.(0.3 + (i / files.length) * 0.4);
    }
  } catch {}

  // Archived attachment files live in uploads/archive/conversations —
  // include them as uploads-archive/ so a restore can rebuild both trees.
  const archUploadsDir = path.resolve(process.cwd(), 'uploads', 'archive', 'conversations');
  try {
    const files = await getAllFiles(archUploadsDir);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = path.relative(archUploadsDir, file);
      const fileBuffer = await fs.readFile(file);
      zip.addFile(`uploads-archive/${relativePath.split(path.sep).join('/')}`, fileBuffer);
      onProgress?.(0.7 + (i / files.length) * 0.2);
    }
  } catch {}
  onProgress?.(0.9);

  // SHA-256 manifest, added LAST so it covers every payload entry (see
  // server/utils/backupChecksums.js for the format and trust model).
  zip.addFile(MANIFEST_NAME, Buffer.from(buildChecksumsManifest(zip), 'utf-8'));

  await fs.writeFile(zipPath, zip.toBuffer());
  onProgress?.(1.0);
}

async function getAllFiles(dir) {
  const files = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
  } catch {}
  return files;
}

export async function getBackupHistory(limit = 20) {
  return backupLogModel.getBackupHistory(limit);
}

let autoBackupInterval = null;

export function startAutoBackupScheduler() {
  if (autoBackupInterval) clearInterval(autoBackupInterval);

  autoBackupInterval = setInterval(async () => {
    try {
      const { getDb } = await import('../database.js');
      const db = await getDb();
      const setting = await db.get("SELECT value FROM system_settings WHERE key = 'conversation_auto_backup'");
      if (setting?.value !== '1') return;

      const intervalSetting = await db.get("SELECT value FROM system_settings WHERE key = 'conversation_backup_interval'");
      const hours = parseInt(intervalSetting?.value || '24', 10);

      const lastBackup = await db.get(
        "SELECT created_at FROM conversation_backup_logs WHERE status = 'success' ORDER BY created_at DESC LIMIT 1"
      );

      if (lastBackup) {
        const lastTime = new Date(lastBackup.created_at).getTime();
        const now = Date.now();
        const hoursSince = (now - lastTime) / (1000 * 60 * 60);
        if (hoursSince < hours) return;
      }

      const rootAdmin = await db.get('SELECT id FROM users WHERE is_root = 1 LIMIT 1');
      if (rootAdmin) {
        await runConversationBackup(rootAdmin.id);
        logger.info('Auto conversation backup completed');
      }
    } catch (err) {
      logger.error({ err }, 'Auto conversation backup failed');
    }
  }, 60 * 60 * 1000);

  autoBackupInterval.unref();
}

export function stopAutoBackupScheduler() {
  if (autoBackupInterval) {
    clearInterval(autoBackupInterval);
    autoBackupInterval = null;
  }
}
