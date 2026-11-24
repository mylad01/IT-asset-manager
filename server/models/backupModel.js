import { getDb } from '../database.js';

export async function logBackup(backup) {
  const db = await getDb();
  await db.run(
    `INSERT INTO backup_logs (filename, size_bytes, status, error_message, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [backup.filename, backup.sizeBytes || 0, backup.status, backup.errorMessage || null]
  );
}

export async function getBackupHistory(limit = 20) {
  const db = await getDb();
  return db.all(`
    SELECT * FROM backup_logs
    ORDER BY created_at DESC
    LIMIT ?
  `, [limit]);
}

// Create backup_logs table if it doesn't exist (run once on startup)
export async function ensureBackupLogsTable() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS backup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_backup_logs_created ON backup_logs(created_at DESC)`);
}