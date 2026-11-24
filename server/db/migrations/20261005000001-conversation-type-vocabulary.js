// Migration: conversation-type vocabulary reconciliation (2026-10-05)
//
// The 20260920 bulletproof rebuild renamed the ticket-chat vocabulary from
// `ticket-linked` (the original workspace schema — and what EVERY layer of
// the app still writes: the zod enum in conversationValidator,
// conversationService.createTicketConversation, conversationModel.getByTicketId,
// every UI badge/filter) to `ticket`, and silently downgraded every legacy
// `ticket-linked` row to `standalone` (`WHERE type NOT IN
// ('standalone','ticket')`), while tightening the CHECK to
// `standalone OR (ticket AND ticket_id IS NOT NULL)`.
//
// Net effect on any DB that ran it — the split-brain: the schema REJECTS
// every value the app writes (`CHECK constraint failed: chk_ticket_logic` on
// POST /conversations with type ticket-linked and on the auto-create ticket
// chat route), getByTicketId never matches → duplicate ticket chats, and the
// ticket badge/filter can never render. (Proven against the live dev DB:
// INSERT type='ticket-linked' failed, type='ticket' succeeded.)
//
// This migration puts ONE vocabulary back — `ticket-linked` — and makes the
// DB enforce the semantics the app assumes:
//   1. REBUILD conversations with AUTOINCREMENT + the FK policy + ids intact
//      (dynamic column copy, same pattern as bulletproof/autoincrement) and
//      CHECK `type='standalone' OR (type='ticket-linked' AND ticket_id IS NOT
//      NULL)`, translating the vocabulary IN THE COPY:
//        a. every row pointing at a ticket becomes `ticket-linked` — this
//           restores the rows bulletproof downgraded and maps the interim
//           `ticket` vocabulary;
//        b. orphaned `ticket-linked` rows (ticket_id IS NULL — possible on
//           fresh DBs whose CHECK was the lenient workspace one) fall back to
//           `standalone`.
//      WHY IN THE COPY, NOT A PRE-COPY UPDATE: the old table's CHECK stays
//      live until DROP TABLE, so an UPDATE writing `ticket-linked` throws
//      CHECK constraint failed on any bulletproof-era table
//      (`standalone OR (ticket AND …)`) — i.e. on every DB it was meant to
//      repair — and down()'s mirror UPDATE (`ticket-linked` → `ticket`)
//      throws on our own strict table. The new table's CHECK validates each
//      transformed value by construction instead.
//   2. UNLINK duplicate chats for the same ticket (losers become standalone
//      with ticket_id NULL — rows are never deleted, their messages stay)
//      on the rebuilt table so the unique index can be built.
//   3. INDEXES: recreate the four idx_conversations_* the DROP TABLE destroys,
//      plus uq_conversations_ticket — one chat per ticket, enforced by the DB
//      instead of an app-level check that could not see its own rows.
//
// Fresh DBs matter too: 20260913000001 creates the LENIENT
// `CHECK(type IN ('standalone','ticket-linked'))` — no ticket_id requirement —
// so the skip test looks for the STRICT form, and fresh DBs are rebuilt to it.
//
// Idempotent: once the CHECK speaks strict `ticket-linked` and the unique
// index exists, this is a no-op.

const STRICT_VOCAB = /'ticket-linked'\s+AND\s+ticket_id\s+IS\s+NOT\s+NULL/i;

async function tableSql(db, name) {
  const row = await db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`, [name]);
  return row?.sql || null;
}

async function hasIndex(db, name) {
  const row = await db.get(`SELECT 1 FROM sqlite_master WHERE type='index' AND name = ?`, [name]);
  return !!row;
}

const CONVERSATION_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_ticket ON conversations(ticket_id)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(is_archived)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC)',
];

export async function up(db) {
  const sql = await tableSql(db, 'conversations');
  if (!sql) return; // nothing to reconcile
  const strictAlready = STRICT_VOCAB.test(sql);
  const uniqueAlready = await hasIndex(db, 'uq_conversations_ticket');
  if (strictAlready && uniqueAlready) return;

  await db.exec('PRAGMA foreign_keys = OFF');
  await db.exec('BEGIN TRANSACTION');
  try {
    // ── 1. rebuild with the strict vocabulary CHECK, translating the
    //        vocabulary IN THE COPY ──
    // The old table's CHECK stays live until DROP TABLE: a pre-copy UPDATE
    // writing `ticket-linked` would throw CHECK constraint failed on any
    // bulletproof-era table — the very DBs this migration repairs. The
    // INSERT…SELECT transforms each row instead, and the NEW table's CHECK
    // validates the result by construction:
    //   ticket_id set  ⇒ 'ticket-linked'  (restores bulletproof's downgrades,
    //                     maps the interim 'ticket' vocabulary)
    //   ticket_id NULL ⇒ 'standalone'     (orphans, plain rows, rogue values)
    if (!strictAlready) {
      await db.exec('DROP TABLE IF EXISTS conversations__vocab_rebuild');
      await db.exec(`
        CREATE TABLE conversations__vocab_rebuild (
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
          CONSTRAINT chk_ticket_logic CHECK (type = 'standalone' OR (type = 'ticket-linked' AND ticket_id IS NOT NULL))
        )
      `);
      const cols = (await db.all('PRAGMA table_info(conversations)')).map((c) => c.name);
      const selectList = cols
        .map((name) => (name === 'type'
          ? `CASE WHEN ticket_id IS NOT NULL THEN 'ticket-linked' ELSE 'standalone' END`
          : name))
        .join(', ');
      await db.run(
        `INSERT INTO conversations__vocab_rebuild (${cols.join(', ')}) SELECT ${selectList} FROM conversations`
      );
      await db.exec('DROP TABLE conversations;');
      await db.exec('ALTER TABLE conversations__vocab_rebuild RENAME TO conversations');
      console.log('[migration] conversations rebuilt with ticket-linked vocabulary CHECK');
    }

    // ── 2. one chat per ticket: keep the oldest (canonical) chat per
    //    ticket, unlink the rest. Runs on the rebuilt (strict) table, where
    //    standalone + NULL ticket_id satisfies its CHECK by construction.
    //    Rows survive; only the link is dropped — deleting them would take
    //    their messages with them.
    const dupes = await db.all(
      `SELECT ticket_id, MIN(id) AS keep FROM conversations
        WHERE ticket_id IS NOT NULL GROUP BY ticket_id HAVING COUNT(*) > 1`
    );
    for (const d of dupes) {
      // eslint-disable-next-line no-await-in-loop -- ordered, idempotent repair
      await db.run(
        `UPDATE conversations SET type = 'standalone', ticket_id = NULL
          WHERE ticket_id = ? AND id <> ?`,
        [d.ticket_id, d.keep]
      );
    }

    // ── 3. indexes: what DROP TABLE destroyed, plus the unique guard ──
    for (const stmt of CONVERSATION_INDEXES) await db.exec(stmt); // eslint-disable-line no-await-in-loop
    await db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_ticket ON conversations(ticket_id) WHERE ticket_id IS NOT NULL'
    );

    await db.exec('COMMIT');
  } catch (err) {
    try { await db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
  await db.exec('PRAGMA foreign_keys = ON');

  // Integrity gate: the copy/normalization must not have orphaned anything.
  const violations = await db.all('PRAGMA foreign_key_check');
  if (violations.length > 0) {
    throw new Error(`foreign_key_check reported ${violations.length} violation(s) after type-vocabulary rebuild`);
  }
}

export async function down(db) {
  // Reverse to the bulletproof-era schema: `ticket` vocabulary, its CHECK,
  // unique index gone. AUTOINCREMENT is deliberately KEPT — ids-never-reused
  // is orthogonal and 20260921000001 owns that down(); downgrading the PK
  // here would silently reintroduce id recycling on every rollback.
  const sql = await tableSql(db, 'conversations');
  if (!sql || !/ticket-linked/i.test(sql)) return;

  await db.exec('PRAGMA foreign_keys = OFF');
  await db.exec('BEGIN TRANSACTION');
  try {
    // Vocabulary translated IN THE COPY for the mirror-image reason up()
    // does it: an UPDATE writing `ticket` runs under OUR strict CHECK and
    // throws CHECK constraint failed whenever a ticket-linked row exists.
    // The strict CHECK guarantees those rows carry a ticket_id, so the
    // legacy ticket-side CHECK stays satisfiable.
    await db.exec('DROP INDEX IF EXISTS uq_conversations_ticket');

    await db.exec('DROP TABLE IF EXISTS conversations__vocab_down');
    await db.exec(`
      CREATE TABLE conversations__vocab_down (
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
    const cols = (await db.all('PRAGMA table_info(conversations)')).map((c) => c.name);
    const selectList = cols
      .map((name) => (name === 'type' ? `CASE WHEN type = 'ticket-linked' THEN 'ticket' ELSE type END` : name))
      .join(', ');
    await db.run(
      `INSERT INTO conversations__vocab_down (${cols.join(', ')}) SELECT ${selectList} FROM conversations`
    );
    await db.exec('DROP TABLE conversations;');
    await db.exec('ALTER TABLE conversations__vocab_down RENAME TO conversations');

    for (const stmt of CONVERSATION_INDEXES) await db.exec(stmt); // eslint-disable-line no-await-in-loop
    await db.exec('COMMIT');
  } catch (err) {
    try { await db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
  await db.exec('PRAGMA foreign_keys = ON');
}
