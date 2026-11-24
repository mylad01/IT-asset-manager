// Migration 20260917000001-toast-banner-pref
// Adds users.toast_banners_enabled so each user can turn the slide-in
// notification banners (NotificationToasts) on/off; persisted server-side.
// Default 1 (enabled) — existing users keep current behavior.

export async function up(db) {
  const rows = await db.all("SELECT name FROM pragma_table_info('users') WHERE name = 'toast_banners_enabled'");
  if (rows.length === 0) {
    await db.exec(`ALTER TABLE users ADD COLUMN toast_banners_enabled INTEGER DEFAULT 1`);
  }
}

export async function down(db) {
  console.warn('Rolling back toast-banner-pref migration requires manual intervention');
}
