// Migration 20260928-ui-prefs
// PLAN.MD §13 P1: per-user UI preferences as one JSON blob on the users row
// (users.ui_prefs TEXT). One column instead of one column per preference:
// the registry (src/config/preferencesRegistry.js) owns the key/type list,
// the zod schema validates every write, and reads are whole-blob at login —
// SQL never needs to filter a single pref.
//
// Column-guarded (pragma_table_info), not a blind ALTER: backups snapshot
// the whole schema but exclude the _migrations ledger, so restoring one
// re-runs the ENTIRE chain against already-migrated tables — a blind
// ALTER TABLE fails with "duplicate column name" and the restored DB
// never boots (caught live by scripts/testBackupRestoreDrill.js; see the
// identical guard in 20260927000001-sha256sums-out-of-band.js and
// 20260917000001-toast-banner-pref.js).

export async function up(db) {
  const cols = new Set((await db.all("SELECT name FROM pragma_table_info('users')")).map((c) => c.name));
  if (!cols.has('ui_prefs')) {
    await db.exec("ALTER TABLE users ADD COLUMN ui_prefs TEXT");
  }
}

export async function down(_db) {
  // SQLite DROP COLUMN needs 3.35+ and the column is nullable bookkeeping —
  // one-way migration like its neighbours (see 20260927000001).
  console.warn('Rolling back 20260928-ui-prefs requires manual intervention');
}
