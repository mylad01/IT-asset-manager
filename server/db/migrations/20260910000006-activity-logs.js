export async function up(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      user_id INTEGER,
      user_name TEXT,
      ip_address TEXT,
      changes TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.exec('CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_logs(entity_type, entity_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_logs(action)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_logs(created_at)');

  // Migrate existing transactions data. Table-guarded: on a restored backup
  // (no _migrations ledger → full chain re-runs), this migration may run
  // AFTER the earlier transactions migration already renamed the table to
  // transactions_old — a blind read would crash the boot. Skip when the
  // table is gone (or already renamed): the data was migrated before.
  const transactionsTable = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name = 'transactions'`);
  const alreadyRenamed = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name = 'transactions_old'`);
  const transactions = transactionsTable ? await db.all('SELECT * FROM transactions ORDER BY id ASC') : [];
  for (const t of transactions) {
    let action = 'update';
    const at = (t.action_type || '').toUpperCase();
    if (at === 'TRANSFER') action = 'transfer';
    else if (at === 'AUDIT_NOTE') action = 'audit_note';
    else if (at === 'DEPLOY') action = 'assign';

    let userName = null;
    if (t.user_id) {
      const user = await db.get('SELECT name FROM users WHERE id = ?', [t.user_id]);
      userName = user ? user.name : null;
    }

    const changes = t.notes ? JSON.stringify({ notes: { old: null, new: t.notes } }) : null;

    await db.run(
      `INSERT INTO activity_logs (entity_type, entity_id, action, user_id, user_name, changes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['asset', t.asset_id, action, t.user_id, userName, changes, t.timestamp]
    );
  }

  // Rename old table as backup (drop stale remnant from prior failed run).
  // Only when the source table still exists — see the guard above.
  if (transactionsTable) {
    await db.exec('DROP TABLE IF EXISTS transactions_old');
    await db.exec('ALTER TABLE transactions RENAME TO transactions_old');
  } else if (!alreadyRenamed) {
    // No transactions table in either form: a restored snapshot predating
    // the transactions feature, or a fresh DB — nothing to rename.
    console.log('[migration] transactions table absent — skipping rename');
  }
}

export async function down(db) {
  await db.exec('DROP TABLE IF EXISTS transactions');
  await db.exec('ALTER TABLE transactions_old RENAME TO transactions');
  await db.exec('DROP TABLE IF EXISTS activity_logs');
}
