// Migration 20260910000003-notification-title
// Adds the title column to notifications (missing from the enhance migration)

export async function up(db) {
  const rows = await db.all("SELECT name FROM pragma_table_info('notifications') WHERE name = 'title'");
  if (rows.length === 0) {
    await db.exec(`ALTER TABLE notifications ADD COLUMN title TEXT`);
  }
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority)`);
}

export async function down(db) {
  console.warn('Rolling back notification-title migration requires manual intervention');
}