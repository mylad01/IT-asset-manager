// Migration 20260927-sha256sums-out-of-band
// Out-of-band tamper-evidence for conversation backups: the history row
// gains manifest_hash_hex (SHA-256 of the ZIP's embedded SHA256SUMS entry)
// so a backup's manifest can be checked against a value that lives in a
// different store than the ZIP itself.
//
// Column-guarded (pragma_table_info), not a blind ALTER: backups snapshot
// the whole schema but exclude the _migrations ledger, so restoring one
// re-runs the ENTIRE chain against already-migrated tables — a blind
// ALTER TABLE fails with "duplicate column name" and the restored DB
// never boots (caught live by scripts/testBackupRestoreDrill.js; see the
// identical guard in 20260910000001-notifications-enhance.js).

export async function up(db) {
  const cols = new Set((await db.all("SELECT name FROM pragma_table_info('conversation_backup_logs')")).map((c) => c.name));
  if (!cols.has('manifest_hash_hex')) {
    await db.exec('ALTER TABLE conversation_backup_logs ADD COLUMN manifest_hash_hex TEXT');
  }
}

export async function down(_db) {
  // SQLite DROP COLUMN needs 3.35+ and the column is nullable bookkeeping —
  // one-way migration like its neighbours (see 20260910000001).
  console.warn('Rolling back 20260927-sha256sums-out-of-band requires manual intervention');
}
