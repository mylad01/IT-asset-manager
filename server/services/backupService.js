import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import env from '../config/env.js';
import * as settingsModel from '../models/settingsModel.js';
import * as backupModel from '../models/backupModel.js';
import { emit } from './notificationEvents.js';
import { pushBackupProgress } from './wsServer.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runBackup(userId) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `itame-backup-${timestamp}.zip`;
  
  let backupPath = await settingsModel.getBackupPath();
  if (!backupPath) {
    backupPath = env.BACKUP_PATH || './backups';
  }

  const fullPath = path.join(backupPath, filename);
  const stagingDbPath = path.join(path.dirname(fullPath), `.staging-${timestamp}.sqlite`);

  try {
    // Ensure backup directory exists (inside try so unreachable UNC fails cleanly)
    await fs.mkdir(backupPath, { recursive: true });

    // Step 1: Notify backup started
    await emit('backup:started', { filename, userId });
    pushBackupProgress(userId, { stage: 'db-backup', progress: 5 });

    // Step 2: Online backup of SQLite database
    await backupDatabase(stagingDbPath);
    pushBackupProgress(userId, { stage: 'db-backup', progress: 30 });

    // Step 3: Create ZIP with DB + uploads + config
    await createBackupZip(fullPath, stagingDbPath, (progress) => {
      pushBackupProgress(userId, { stage: 'zip', progress: 30 + Math.floor(progress * 0.6) });
    });
    pushBackupProgress(userId, { stage: 'zip', progress: 90 });

    // Step 4: Clean up staging file
    await fs.unlink(stagingDbPath).catch(() => {});
    pushBackupProgress(userId, { stage: 'complete', progress: 100 });

    // Step 5: Get file size and log success
    const stats = await fs.stat(fullPath);
    await backupModel.logBackup({ filename, sizeBytes: stats.size, status: 'success' });
    
    const duration = Date.now() - startTime;
    await emit('backup:complete', { filename, sizeBytes: stats.size, duration, userId });
    pushBackupProgress(userId, { stage: 'complete', progress: 100, filename, sizeBytes: stats.size });

    logger.info({ filename, sizeBytes: stats.size, duration, userId }, 'Backup completed successfully');
    return { success: true, filename, sizeBytes: stats.size, path: fullPath };
  } catch (err) {
    // Clean up staging file on error
    await fs.unlink(stagingDbPath).catch(() => {});

    // Remove partial zip if exists
    await fs.unlink(fullPath).catch(() => {});

    // Log the failure, but never let a logging error mask the critical alert
    try {
      await backupModel.logBackup({ filename, sizeBytes: 0, status: 'failed', errorMessage: err.message });
    } catch (logErr) {
      logger.error({ err: logErr, filename }, 'Failed to log backup failure');
    }

    await emit('backup:failed', { filename, error: err.message, userId });
    pushBackupProgress(userId, { stage: 'failed', progress: 0, error: err.message });

    logger.error({ err, filename, userId }, 'Backup failed');
    throw err;
  }
}

async function backupDatabase(stagingPath) {
  const dbPath = env.DB_PATH || './database.sqlite';

  const sourceDb = new Database(dbPath, { readonly: true });
  try {
    // better-sqlite3 v13: db.backup(filename, options) returns a Promise.
    await sourceDb.backup(stagingPath);
  } finally {
    sourceDb.close();
  }
}

async function createBackupZip(zipPath, stagingDbPath, onProgress) {
  const zip = new AdmZip();
  
  // Add database
  const dbBuffer = await fs.readFile(stagingDbPath);
  zip.addFile('database.sqlite', dbBuffer);
  onProgress?.(0.2);

  // Add uploads directory
  const uploadsDir = path.resolve(__dirname, '../../uploads');
  try {
    const uploadFiles = await getAllFiles(uploadsDir);
    for (let i = 0; i < uploadFiles.length; i++) {
      const file = uploadFiles[i];
      const relativePath = path.relative(uploadsDir, file);
      const fileBuffer = await fs.readFile(file);
      zip.addFile(`uploads/${relativePath}`, fileBuffer);
      onProgress?.(0.2 + (i / uploadFiles.length) * 0.5);
    }
  } catch {
    // uploads directory might not exist
  }
  onProgress?.(0.7);

  // Add config files
  const configFiles = [
    { path: path.resolve(__dirname, '../../.env'), name: '.env' },
    { path: path.resolve(__dirname, '../../.oxlintrc.json'), name: '.oxlintrc.json' },
    { path: path.resolve(__dirname, '../../ecosystem.config.cjs'), name: 'ecosystem.config.cjs' },
  ];

  for (const cf of configFiles) {
    try {
      const content = await fs.readFile(cf.path, 'utf-8');
      // Note: .env contains secrets - included per spec for "complete snapshot"
      zip.addFile(cf.name, Buffer.from(content, 'utf-8'));
    } catch {
      // Config file might not exist, skip
    }
  }
  onProgress?.(0.9);

  // Write zip file
  await fs.writeFile(zipPath, zip.toBuffer());
  onProgress?.(1.0);
}

async function getAllFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getAllFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

export async function testBackupPath(backupPath) {
  const testFile = path.join(backupPath, '.backup-probe.txt');
  try {
    await fs.mkdir(backupPath, { recursive: true });
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}