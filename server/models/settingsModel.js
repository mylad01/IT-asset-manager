import { getDb } from '../database.js';

export async function get(key) {
  const db = await getDb();
  const row = await db.get('SELECT value FROM system_settings WHERE key = ?', [key]);
  return row?.value;
}

export async function getAll() {
  const db = await getDb();
  return db.all('SELECT key, value FROM system_settings');
}

export async function set(key, value) {
  const db = await getDb();
  await db.run(
    `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value]
  );
}

export async function setMany(settings) {
  if (!settings.length) return;
  const db = await getDb();
  for (const { key, value } of settings) {
    await db.run(
      `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, value]
    );
  }
}

export async function getSetupStatus() {
  const setupComplete = await get('setup_complete');
  return setupComplete === '1';
}

export async function getBackupPath() {
  return get('backup_path');
}

export async function getWsEnabled() {
  const val = await get('ws_enabled');
  return val !== '0';
}

export async function getBrowserPopupEnabled() {
  const val = await get('browser_popup_enabled');
  return val !== '0';
}