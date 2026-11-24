import { getDb } from '../database.js';
import * as settingsModel from '../models/settingsModel.js';
import * as userModel from '../models/userModel.js';
import bcrypt from 'bcrypt';
import { withTransaction } from '../db/transactions.js';
import logger from '../utils/logger.js';

const SETUP_KEYS = {
  SETUP_COMPLETE: 'setup_complete',
  BACKUP_PATH: 'backup_path',
  WS_ENABLED: 'ws_enabled',
  BROWSER_POPUP_ENABLED: 'browser_popup_enabled',
};

export async function getStatus() {
  const db = await getDb();
  
  // Check if root admin exists
  const rootAdmin = await db.get('SELECT id FROM users WHERE email = "admin@studio.com" AND role = "IT Admin"');
  const hasRootAdmin = !!rootAdmin;
  
  // Check setup_complete flag
  const setupComplete = await settingsModel.getSetupStatus();
  
  if (setupComplete) {
    return 'SETUP_DONE';
  }
  
  if (!hasRootAdmin) {
    return 'SETUP_PENDING';
  }
  
  // Existing deployment with root admin but no settings - seed defaults and mark done
  await seedDefaults();
  return 'SETUP_DONE';
}

async function seedDefaults() {
  const _db = await getDb();
  await settingsModel.setMany([
    { key: SETUP_KEYS.SETUP_COMPLETE, value: '1' },
    { key: SETUP_KEYS.WS_ENABLED, value: '1' },
    { key: SETUP_KEYS.BROWSER_POPUP_ENABLED, value: '1' },
  ]);
  logger.info('Seeded default system_settings for existing deployment');
}

export async function createRootAdmin(data) {
  const { name, email, password } = data;

  // Validate email format
  if (!email.includes('@')) {
    throw new Error('Invalid email format');
  }

  // The built-in seed email is owned by auto-seed in dev; keep it reserved so
  // wizard-created roots never collide with "existing deployment" detection.
  if (email.toLowerCase() === 'admin@studio.com') {
    throw new Error('The reserved admin email cannot be used. Please pick a distinct admin email.');
  }

  // Check if root admin already exists
  const existing = await userModel.getByEmail(email);
  if (existing && existing.role === 'IT Admin') {
    throw new Error('Root admin already exists');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const db = await getDb();
  return withTransaction(db, async (txn) => {
    // Create user
    await txn.run(
      `INSERT INTO users (name, email, role, password_hash, requires_password_change, is_root) VALUES (?, ?, 'IT Admin', ?, 0, 1)`,
      [name, email, hashedPassword]
    );

    // Seed notification defaults (setup stays pending until completeSetup())
    await txn.run(
      `INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('ws_enabled', '1', datetime('now'))`
    );
    await txn.run(
      `INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('browser_popup_enabled', '1', datetime('now'))`
    );
  });
}

export async function saveBackupPath(path) {
  // Validate path is writable
  const { testBackupPath } = await import('./backupService.js');
  const result = await testBackupPath(path);
  if (!result.success) {
    throw new Error(`Backup path not writable: ${result.error}`);
  }
  
  await settingsModel.set(SETUP_KEYS.BACKUP_PATH, path);
  return { success: true };
}

export async function savePreferences({ wsEnabled, browserPopupEnabled }) {
  await settingsModel.setMany([
    { key: SETUP_KEYS.WS_ENABLED, value: wsEnabled ? '1' : '0' },
    { key: SETUP_KEYS.BROWSER_POPUP_ENABLED, value: browserPopupEnabled ? '1' : '0' },
  ]);
  return { success: true };
}

export async function completeSetup() {
  const status = await getStatus();
  if (status !== 'SETUP_PENDING') {
    throw new Error('Setup already completed');
  }
  
  const db = await getDb();
  return withTransaction(db, async (txn) => {
    await txn.run(
      `INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('setup_complete', '1', datetime('now'))`
    );
    await txn.run(
      `INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('ws_enabled', '1', datetime('now'))`
    );
    await txn.run(
      `INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('browser_popup_enabled', '1', datetime('now'))`
    );
  });
}

export function isSetupPending() {
  // This is a sync check used by middleware - actual async check in getStatus
  return null; // middleware will call getStatus
}