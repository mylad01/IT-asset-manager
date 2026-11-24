// Migration 20260920000001-asset-warranty
// Adds warranty_expiry to assets for the lifecycle timeline feature

export async function up(db) {
  const rows = await db.all("SELECT name FROM pragma_table_info('assets') WHERE name = 'warranty_expiry'");
  if (rows.length === 0) {
    await db.exec('ALTER TABLE assets ADD COLUMN warranty_expiry DATE');
  }
}

export async function down(_db) {
  // SQLite doesn't support DROP COLUMN before 3.35.0 — one-way migration
}
