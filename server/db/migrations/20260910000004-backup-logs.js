// Migration 20260910000004-backup-logs
// Creates the backup_logs table for on-demand backup history

export async function up(db) {
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

export async function down(db) {
  await db.exec('DROP TABLE IF EXISTS backup_logs');
}