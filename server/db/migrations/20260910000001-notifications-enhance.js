// Migration 20260910000001-notifications-enhance
// Enhances the existing notifications table with type, priority, link columns

export async function up(db) {
  // Add new columns to notifications table. Column-guarded: backups snapshot
  // the whole schema but exclude the _migrations ledger, so restoring one
  // re-runs the ENTIRE chain against already-migrated tables — a blind
  // ALTER TABLE fails with "duplicate column name" and the restored DB
  // never boots (caught live by scripts/testBackupRestoreDrill.js).
  const cols = new Set((await db.all("SELECT name FROM pragma_table_info('notifications')")).map((c) => c.name));
  if (!cols.has('type')) {
    await db.exec(`ALTER TABLE notifications ADD COLUMN type TEXT DEFAULT 'system'`);
  }
  if (!cols.has('priority')) {
    await db.exec(`ALTER TABLE notifications ADD COLUMN priority TEXT DEFAULT 'info'`);
  }
  if (!cols.has('link')) {
    await db.exec(`ALTER TABLE notifications ADD COLUMN link TEXT`);
  }
  
  // Create index for querying by user, read status, and type
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_type_read ON notifications(user_id, type, is_read)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC)`);
}

export async function down(_db) {
  // SQLite doesn't support DROP COLUMN directly before version 3.35.0
  // For rollback, we'd need to recreate the table without these columns
  // This is a one-way migration for production safety
  console.warn('Rolling back notifications-enhance migration requires manual intervention');
}