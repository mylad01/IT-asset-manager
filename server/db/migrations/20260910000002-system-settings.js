// Migration 20260910000002-system-settings
// Creates the system_settings table for setup wizard and runtime config

export async function up(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Insert default settings if they don't exist
  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES ('setup_complete', '0')`);
  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES ('ws_enabled', '1')`);
  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES ('browser_popup_enabled', '1')`);
}

export async function down(db) {
  await db.exec('DROP TABLE IF EXISTS system_settings');
}