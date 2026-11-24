// Migration: conversation-autoincrement (2026-09-21)
//
// The 20260920-bulletproof-conversations rebuild recreated `conversations` and
// `conversation_messages` with a bare `id INTEGER PRIMARY KEY`. That restores
// rowids from max(id) after any delete, so ids can be REUSED once the max row
// is gone — which breaks archive/restore round-trips (the hard-move archive
// preserves ids) and any deep link that holds a conversation id.
//
// This migration rebuilds both tables with `id INTEGER PRIMARY KEY
// AUTOINCREMENT` (monotonic ids, never reused) while preserving:
//   - every existing row and its id (dynamic column copy, like bulletproof)
//   - the CHECK constraint and FK policy from the bulletproof rebuild
//   - the idx_conversations_* / idx_conv_messages_* indexes that the
//     bulletproof DROP TABLE silently destroyed (CREATE INDEX is schema-
//     bound, so it does not survive a table drop; the workspace migration's
//     indexes were never recreated).
//
// Idempotent: if a table already declares AUTOINCREMENT (e.g. this migration
// ran, or a fresh DB came up through 20260913000001 which creates
// AUTOINCREMENT tables) the rebuild is skipped; indexes are IF NOT EXISTS.

async function tableExists(db, name) {
  const row = await db.get(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]);
  return !!row;
}

async function tableHasAutoincrement(db, name) {
  const row = await db.get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]);
  if (!row || !row.sql) return false;
  return /\bAUTOINCREMENT\b/i.test(row.sql);
}

async function rebuildWithAutoincrement(db, table, createSql) {
  const tmp = `${table}__ai_rebuild`;

  await db.exec(`DROP TABLE IF EXISTS ${tmp}`);
  await db.exec(createSql.replace(/__AI_REBUILD__/g, tmp));

  // Dynamic column copy — same pattern as the bulletproof rebuild, so a
  // legacy table that predates a column still migrates cleanly.
  const cols = await db.all(`PRAGMA table_info(${table})`);
  const colNames = cols.map(c => c.name).join(', ');
  await db.run(`INSERT INTO ${tmp} (${colNames}) SELECT ${colNames} FROM ${table}`);

  await db.exec(`DROP TABLE ${table}`);
  await db.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
}

export async function up(db) {
  // Only tables that EXIST and lack AUTOINCREMENT get rebuilt. On a fresh DB
  // the workspace migration (20260913000001) runs first and already creates
  // AUTOINCREMENT tables; if neither table exists at all there is nothing
  // to do here.
  const convNeedsRebuild = (await tableExists(db, 'conversations')) && !(await tableHasAutoincrement(db, 'conversations'));
  const msgNeedsRebuild = (await tableExists(db, 'conversation_messages')) && !(await tableHasAutoincrement(db, 'conversation_messages'));

  if (convNeedsRebuild || msgNeedsRebuild) {
    await db.exec('PRAGMA foreign_keys = OFF');
    await db.exec('BEGIN TRANSACTION');
    try {
      if (convNeedsRebuild) {
        await rebuildWithAutoincrement(db, 'conversations', `
          CREATE TABLE __AI_REBUILD__ (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'standalone',
            ticket_id INTEGER,
            created_by INTEGER NOT NULL,
            is_archived INTEGER DEFAULT 0,
            archived_at DATETIME,
            archived_by INTEGER,
            archive_reason TEXT,
            deleted_at DATETIME,
            deleted_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
            CONSTRAINT chk_ticket_logic CHECK (type = 'standalone' OR (type = 'ticket' AND ticket_id IS NOT NULL))
          )
        `);
        console.log('[migration] conversations rebuilt with AUTOINCREMENT');
      }

      if (msgNeedsRebuild) {
        await rebuildWithAutoincrement(db, 'conversation_messages', `
          CREATE TABLE __AI_REBUILD__ (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            is_internal INTEGER DEFAULT 0,
            is_edited INTEGER DEFAULT 0,
            deleted_at DATETIME,
            deleted_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `);
        console.log('[migration] conversation_messages rebuilt with AUTOINCREMENT');
      }

      await db.exec('COMMIT');
    } catch (err) {
      try { await db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw err;
    }
    await db.exec('PRAGMA foreign_keys = ON');

    // Integrity gate: the copy must not have orphaned anything.
    const violations = await db.all('PRAGMA foreign_key_check');
    if (violations.length > 0) {
      throw new Error(`foreign_key_check reported ${violations.length} violation(s) after AUTOINCREMENT rebuild`);
    }
  }

  // Indexes on the rebuilt tables: recreate what the bulletproof DROP TABLE
  // destroyed. IF NOT EXISTS keeps this a no-op on fresh DBs where the
  // workspace migration already created them.
  if (await tableExists(db, 'conversations')) {
    await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_ticket ON conversations(ticket_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(is_archived)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC)');
  }
  if (await tableExists(db, 'conversation_messages')) {
    await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages(conversation_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_messages_user ON conversation_messages(user_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_messages_created ON conversation_messages(created_at DESC)');
  }
}

export async function down(db) {
  // Reverse rebuild: back to bare INTEGER PRIMARY KEY (rowid-alias, ids
  // recyclable). Data and ids are preserved; the sequence bookkeeping goes
  // away with the AUTOINCREMENT keyword.
  await db.exec('PRAGMA foreign_keys = OFF');
  await db.exec('BEGIN TRANSACTION');
  try {
    await db.exec(`DROP TABLE IF EXISTS conversations__ai_down`);
    await db.exec(`
      CREATE TABLE conversations__ai_down (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'standalone',
        ticket_id INTEGER,
        created_by INTEGER NOT NULL,
        is_archived INTEGER DEFAULT 0,
        archived_at DATETIME,
        archived_by INTEGER,
        archive_reason TEXT,
        deleted_at DATETIME,
        deleted_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        CONSTRAINT chk_ticket_logic CHECK (type = 'standalone' OR (type = 'ticket' AND ticket_id IS NOT NULL))
      )
    `);
    const convCols = (await db.all('PRAGMA table_info(conversations)')).map(c => c.name).join(', ');
    await db.run(`INSERT INTO conversations__ai_down (${convCols}) SELECT ${convCols} FROM conversations`);
    await db.exec('DROP TABLE conversations');
    await db.exec('ALTER TABLE conversations__ai_down RENAME TO conversations');

    await db.exec(`DROP TABLE IF EXISTS conversation_messages__ai_down`);
    await db.exec(`
      CREATE TABLE conversation_messages__ai_down (
        id INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        is_internal INTEGER DEFAULT 0,
        is_edited INTEGER DEFAULT 0,
        deleted_at DATETIME,
        deleted_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    const msgCols = (await db.all('PRAGMA table_info(conversation_messages)')).map(c => c.name).join(', ');
    await db.run(`INSERT INTO conversation_messages__ai_down (${msgCols}) SELECT ${msgCols} FROM conversation_messages`);
    await db.exec('DROP TABLE conversation_messages');
    await db.exec('ALTER TABLE conversation_messages__ai_down RENAME TO conversation_messages');

    await db.exec('COMMIT');
  } catch (err) {
    try { await db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
  await db.exec('PRAGMA foreign_keys = ON');
}
