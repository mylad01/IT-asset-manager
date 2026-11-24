// Migration 20260910000005-root-flag
// Adds users.is_root flag so root identity is data-driven, not email-based

export async function up(db) {
  const rows = await db.all("SELECT name FROM pragma_table_info('users') WHERE name = 'is_root'");
  if (rows.length === 0) {
    await db.exec(`ALTER TABLE users ADD COLUMN is_root INTEGER DEFAULT 0`);
  }
  await db.exec(`UPDATE users SET is_root = 1 WHERE email = 'admin@studio.com'`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_users_is_root ON users(is_root)`);
}

export async function down(db) {
  console.warn('Rolling back root-flag migration requires manual intervention');
}