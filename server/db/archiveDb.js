// archiveDb.js — dedicated SQLite database for archived + soft-deleted
// conversations (the "hard-move" archive).
//
// Why a separate DB: the goal is to keep the ACTIVE database lean. Flag-based
// archiving (old behavior) left every message row in the main DB forever, so
// the file kept growing. Here, archiving physically MOVES rows into this file
// and VACUUMs the main one, so the active DB actually shrinks.
//
// Schema mirrors the active DB's conversation tables, plus lifecycle columns
// on `conversations`:
//   archived_at / archived_by / archive_reason   — hard-move archive
//   deleted_at / deleted_by                      — recycle bin (Phase 4)
//
// IDs are PRESERVED when moving rows, which is what makes restore a pure
// inverse and deep links stable. INSERT (not REPLACE) is used everywhere so a
// double-move attempt fails loudly instead of silently duplicating.

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import env from '../config/env.js';
import { withBoolFlags, withBoolFlagsAll, CONVERSATION_FLAGS, MESSAGE_FLAGS } from '../utils/serializeFlags.js';

let dbPromise = null;

/** Archive DB filename is derived from the main DB path so test/load DBs don't collide. */
export function archiveDbPath() {
  const mainPath = env.DB_PATH || './database.sqlite';
  const dir = path.dirname(mainPath);
  const base = path.basename(mainPath).replace(/\.sqlite(-wal)?$/i, '');
  return path.join(dir, `${base}-conversations-archive.sqlite`);
}

function schemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'standalone',
      ticket_id INTEGER,
      created_by INTEGER NOT NULL,
      is_archived INTEGER DEFAULT 1,
      archived_at DATETIME,
      archived_by INTEGER,
      archive_reason TEXT,
      deleted_at DATETIME,
      deleted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_internal INTEGER DEFAULT 0,
      is_edited INTEGER DEFAULT 0,
      deleted_at DATETIME,
      deleted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_attachments (
      id INTEGER PRIMARY KEY,
      message_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS conversation_reads (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_arch_conv_updated ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_arch_conv_deleted ON conversations(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_arch_part_conv ON conversation_participants(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_arch_msgs_conv ON conversation_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_arch_att_msg ON message_attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_arch_react_msg ON message_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_arch_reads_conv ON conversation_reads(conversation_id);
  `;
}

async function getArchiveDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const file = archiveDbPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const db = await open({ filename: file, driver: sqlite3.Database });
      await db.exec('PRAGMA journal_mode = WAL');
      await db.exec('PRAGMA synchronous = NORMAL');
      await db.exec('PRAGMA busy_timeout = 5000');
      await db.exec('PRAGMA foreign_keys = OFF'); // rows arrive as complete sets
      await db.exec(schemaSql());
      return db;
    })().catch((err) => {
      dbPromise = null; // allow retry on next call
      throw err;
    });
  }
  return dbPromise;
}

/**
 * Whole-archive aggregate counts for the oversight summary. One query, no
 * raw handle exposure.
 */
export async function getArchiveStats() {
  const archDb = await getArchiveDb();
  return archDb.get(`
    SELECT
      (SELECT COUNT(*) FROM conversations) as conversations,
      (SELECT COUNT(*) FROM conversation_messages) as messages,
      (SELECT COUNT(*) FROM message_attachments) as attachments,
      (SELECT COALESCE(SUM(file_size), 0) FROM message_attachments) as bytes
  `);
}

/** Close the archive DB (used by graceful shutdown / tests). */
export async function closeArchiveDb() {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    if (db) {
      try { await db.close(); } catch {}
    }
    dbPromise = null;
  }
}

// Tables copied on archive, in child-first order (children may cascade on
// restore delete; parent last for the same reason on the main DB side).
const CHILD_TABLES = [
  { table: 'message_attachments', fk: 'message_id', via: 'conversation_messages', fkCol: 'id' },
  { table: 'message_reactions', fk: 'message_id', via: 'conversation_messages', fkCol: 'id' },
  { table: 'conversation_messages', fk: 'conversation_id', via: null, fkCol: null },
  { table: 'conversation_reads', fk: 'conversation_id', via: null, fkCol: null },
  { table: 'conversation_participants', fk: 'conversation_id', via: null, fkCol: null },
];

/**
 * Build a multi-VALUES INSERT for a batch of rows. Batches are sized to stay
 * under SQLite's legacy SQLITE_MAX_VARIABLE_NUMBER (999 variables on older
 * builds; newer builds allow 32766 — we stay conservative and portable).
 * Turns the old per-row awaited stmt.run loop (≈50µs/row of driver
 * round-trips — ~700ms for a 12k-message conversation) into a handful of
 * statements per table.
 */
function bulkInsert(db, table, columns, rows) {
  const rowsPerBatch = Math.max(1, Math.floor(900 / columns.length));
  const results = [];
  for (let i = 0; i < rows.length; i += rowsPerBatch) {
    const batch = rows.slice(i, i + rowsPerBatch);
    const valuesSql = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const flat = [];
    for (const row of batch) for (const c of columns) flat.push(row[c]);
    // eslint-disable-next-line no-await-in-loop -- ordered writes inside the txn
    results.push(db.run(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valuesSql}`,
      flat
    ));
  }
  return Promise.all(results);
}

/**
 * Copy one conversation's full row set into the archive DB inside a single
 * archive-DB transaction. Child rows are located via the mapping above.
 * Returns counts per table.
 */
export async function copyConversationIn(conversationId, { archiveReason = null, archivedBy = null, tombstone = null } = {}) {
  const mainDb = await (await import('../database.js')).getDb();
  const archDb = await getArchiveDb();

  const conv = await mainDb.get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  if (!conv) throw new Error(`Conversation ${conversationId} not found in active DB`);

  // Snapshot child rows BEFORE the archive transaction, while the source
  // rows are guaranteed present. The conversation row itself is read inside
  // the transaction for maximum freshness.
  const childSnapshots = {};
  for (const { table, fk, via, fkCol } of CHILD_TABLES) {
    if (via) {
      childSnapshots[table] = await mainDb.all(
        `SELECT t.* FROM ${table} t INNER JOIN ${via} v ON t.${fk} = v.${fkCol} WHERE v.conversation_id = ?`,
        [conversationId]
      );
    } else {
      childSnapshots[table] = await mainDb.all(`SELECT * FROM ${table} WHERE ${fk} = ?`, [conversationId]);
    }
  }

  const counts = {};
  await archDb.exec('BEGIN IMMEDIATE');
  try {
    const convRow = {
      id: conv.id,
      title: conv.title,
      type: conv.type,
      ticket_id: conv.ticket_id ?? null,
      created_by: conv.created_by,
      is_archived: 1,
      archived_at: conv.archived_at || new Date().toISOString(),
      archived_by: archivedBy,
      archive_reason: archiveReason,
      deleted_at: tombstone?.deleted_at || null,
      deleted_by: tombstone?.deleted_by || null,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
    };

    await archDb.run(
      `INSERT INTO conversations (id, title, type, ticket_id, created_by, is_archived, archived_at, archived_by, archive_reason, deleted_at, deleted_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [convRow.id, convRow.title, convRow.type, convRow.ticket_id, convRow.created_by, convRow.is_archived,
       convRow.archived_at, convRow.archived_by, convRow.archive_reason, convRow.deleted_at, convRow.deleted_by,
       convRow.created_at, convRow.updated_at]
    );
    counts.conversations = 1;

    for (const { table } of CHILD_TABLES) {
      const rows = childSnapshots[table] || [];
      counts[table] = rows.length;
      if (!rows.length) continue;

      // Prune stale-generation archive rows whose ids collide with the
      // incoming set. Pre-AUTOINCREMENT generations could REUSE ids after
      // deletion (bare INTEGER PRIMARY KEY pulls rowids from max(id)), so the
      // archive DB can hold DIFFERENT historical rows under the same child
      // id. Those archive rows are un-restorable regardless — a restore would
      // hit the same PK conflict in reverse — so they are deleted, not
      // merged. (20260921-conversation-autoincrement stops new reuse; this
      // guards against collisions already baked into the archive file.)
      const ids = rows.map(r => r.id).filter(v => v != null);
      if (ids.length) {
        const chunks = [];
        for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
        for (const chunk of chunks) {
          const placeholders = chunk.map(() => '?').join(', ');
          // eslint-disable-next-line no-await-in-loop -- ordered writes keep the txn ordered
          await archDb.run(`DELETE FROM ${table} WHERE id IN (${placeholders})`, chunk);
        }
      }

      const columns = Object.keys(rows[0]);
      // eslint-disable-next-line no-await-in-loop -- ordered writes keep the txn ordered
      await bulkInsert(archDb, table, columns, rows);
    }

    await archDb.exec('COMMIT');
    return counts;
  } catch (err) {
    try { await archDb.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

/**
 * Copy one conversation's full row set BACK into the active DB. Used by
 * restore. Rows keep their original ids. The active DB call site wraps this
 * in its own transaction for the delete step.
 *
 * INSERT ORDER MATTERS: the active DB enforces foreign keys, so rows must
 * arrive parents-before-children (conversation → messages → attachments /
 * reactions / reads / participants). This is the REVERSE of the archive
 * direction, which snapshots children first while the source is intact.
 */
export async function copyConversationOut(conversationId) {
  const mainDb = await (await import('../database.js')).getDb();
  const archDb = await getArchiveDb();

  const conv = await archDb.get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  if (!conv) throw new Error(`Conversation ${conversationId} not found in archive DB`);

  // The active DB enforces conversations.ticket_id → tickets(id). If the
  // ticket was deleted while this conversation sat in the archive, a plain
  // re-insert would fail the FK and abort the whole restore. The schema's
  // own ON DELETE policy for tickets is SET NULL — honor it here.
  let ticketId = conv.ticket_id ?? null;
  if (ticketId != null) {
    const ticket = await mainDb.get('SELECT id FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) ticketId = null;
  }

  // Vocabulary guard at the restore boundary: the archive DB carries no CHECK
  // and can hold rows written under the old `ticket` vocabulary (or an
  // orphaned ticket-linked row from the lenient workspace schema). The active
  // DB enforces `ticket-linked ⇒ ticket_id NOT NULL`, so normalize on the way
  // in — a restore must never die on a constraint the archive was never bound
  // by. (20261005000001-conversation-type-vocabulary owns the active side.)
  let type = conv.type === 'ticket' ? 'ticket-linked' : conv.type;
  if (type === 'ticket-linked' && ticketId == null) type = 'standalone';

  // Parent first.
  await mainDb.run(
    `INSERT INTO conversations (id, title, type, ticket_id, created_by, is_archived, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    [conv.id, conv.title, type, ticketId, conv.created_by, conv.created_at, conv.updated_at]
  );

  // Children in dependency order: messages before their attachments/reactions.
  const RESTORE_ORDER = [...CHILD_TABLES].reverse();
  for (const { table, fk, via, fkCol } of RESTORE_ORDER) {
    let rows;
    if (via) {
      rows = await archDb.all(
        `SELECT t.* FROM ${table} t INNER JOIN ${via} v ON t.${fk} = v.${fkCol} WHERE v.conversation_id = ?`,
        [conversationId]
      );
    } else {
      rows = await archDb.all(`SELECT * FROM ${table} WHERE ${fk} = ?`, [conversationId]);
    }
    if (!rows.length) continue;

    const columns = Object.keys(rows[0]);
    // eslint-disable-next-line no-await-in-loop -- ordered writes
    await bulkInsert(mainDb, table, columns, rows);
  }
}

/** Delete a conversation's rows from the archive DB (permanent purge). */
export async function purgeConversation(conversationId) {
  const archDb = await getArchiveDb();
  await archDb.exec('BEGIN IMMEDIATE');
  try {
    for (const { table, fk, via, fkCol } of CHILD_TABLES) {
      if (via) {
        // eslint-disable-next-line no-await-in-loop
        await archDb.run(
          `DELETE FROM ${table} WHERE ${fk} IN (SELECT v.${fkCol} FROM ${via} v WHERE v.conversation_id = ?)`,
          [conversationId]
        );
      } else {
        // eslint-disable-next-line no-await-in-loop
        await archDb.run(`DELETE FROM ${table} WHERE ${fk} = ?`, [conversationId]);
      }
    }
    await archDb.run('DELETE FROM conversations WHERE id = ?', [conversationId]);
    await archDb.exec('COMMIT');
  } catch (err) {
    try { await archDb.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

export async function getConversationById(conversationId) {
  const archDb = await getArchiveDb();
  const row = await archDb.get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  return withBoolFlags(row, CONVERSATION_FLAGS);
}

export async function getMessages(conversationId, { before, limit = 50 } = {}) {
  const archDb = await getArchiveDb();
  // Same contract as the active path (conversationMessageModel.getByConversation):
  // id-based `before` cursor, LIMIT, newest page first then reversed to ASC
  // for rendering. A 12k-message archived conversation must not serialize as
  // one giant JSON response.
  let query = `
    SELECT cm.*,
      (SELECT GROUP_CONCAT(json_object('id', ma.id, 'filename', ma.filename, 'file_size', ma.file_size, 'mime_type', ma.mime_type, 'file_path', ma.file_path))
       FROM message_attachments ma WHERE ma.message_id = cm.id) as attachments_json
     FROM conversation_messages cm
     WHERE cm.conversation_id = ?
  `;
  const params = [conversationId];
  if (before) {
    query += ' AND cm.id < ?';
    params.push(before);
  }
  query += ` ORDER BY cm.id DESC`;
  // limit == null → full history (export path only; never the API read path).
  if (limit != null) {
    query += ` LIMIT ?`;
    params.push(limit);
  }

  const rows = await archDb.all(query, params);
  const pageIds = rows.map(r => r.id);
  // Reactions for just this page. Join through the page's id range rather
  // than a giant IN-list: the full-history path (limit: null, export) can
  // exceed SQLite's variable limit (999 legacy / 32766 modern) and crash the
  // query. MIN/MAX over the page is exact because pageIds are contiguous —
  // they come from `WHERE id < before ORDER BY id DESC LIMIT n` on a table
  // whose ids are unique.
  const reactionRows = pageIds.length ? await archDb.all(
    `SELECT mr.message_id, mr.emoji, mr.user_id FROM message_reactions mr
     WHERE mr.message_id BETWEEN ? AND ?`,
    [Math.min(...pageIds), Math.max(...pageIds)]
  ) : [];
  const reactionsByMessage = new Map();
  for (const r of reactionRows) {
    if (!reactionsByMessage.has(r.message_id)) reactionsByMessage.set(r.message_id, []);
    reactionsByMessage.get(r.message_id).push(r);
  }

  // Reverse to chronological ASC, matching the active path's shape.
  rows.reverse();
  return rows.map(m => {
    const { attachments_json, ...rest } = m;
    const grouped = {};
    for (const r of reactionsByMessage.get(m.id) || []) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, users: [], count: 0 };
      // user_name resolved by the controller's enrichment pass.
      grouped[r.emoji].users.push({ id: r.user_id, name: null });
      grouped[r.emoji].count++;
    }
    return {
      ...withBoolFlags(rest, MESSAGE_FLAGS),
      attachments: attachments_json ? mapArchiveAttachments(m.id, JSON.parse(`[${attachments_json}]`)) : [],
      reactions: Object.values(grouped),
    };
  });
}

function mapArchiveAttachments(messageId, items) {
  return items.map(a => {
    const mime = a.mime_type || '';
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
    return {
      id: a.id,
      filename: a.filename,
      kind,
      url: `/api/conversations/messages/${messageId}/attachments/${a.id}`,
      file_size: a.file_size,
      mime_type: a.mime_type,
    };
  });
}

/**
 * Participant user_ids for one archived conversation (oversight name
 * enrichment — avoids pulling full participant rows).
 */
export async function getParticipantIds(conversationId) {
  const archDb = await getArchiveDb();
  const rows = await archDb.all(
    'SELECT user_id FROM conversation_participants WHERE conversation_id = ?',
    [conversationId]
  );
  return rows.map(r => r.user_id);
}

/** Participants of an archived conversation.
 * NOTE: no users JOIN — the archive DB has no users table. The service layer
 * (getArchivedConversation) enriches names against the live users table. */
export async function getParticipants(conversationId) {
  const archDb = await getArchiveDb();
  return archDb.all(
    `SELECT cp.* FROM conversation_participants cp
     WHERE cp.conversation_id = ?`,
    [conversationId]
  );
}

/** Attachment rows for one archived conversation (used for file moves + exports). */
export async function getAttachments(conversationId) {
  const archDb = await getArchiveDb();
  return archDb.all(
    `SELECT ma.* FROM message_attachments ma
     INNER JOIN conversation_messages cm ON ma.message_id = cm.id
     WHERE cm.conversation_id = ?`,
    [conversationId]
  );
}

/** Single lookups used by the attachment streaming endpoint (archive path). */
export async function getAttachmentById(attachmentId) {
  const archDb = await getArchiveDb();
  return archDb.get('SELECT * FROM message_attachments WHERE id = ?', [attachmentId]);
}

export async function getMessageById(messageId) {
  const archDb = await getArchiveDb();
  const row = await archDb.get('SELECT * FROM conversation_messages WHERE id = ?', [messageId]);
  return withBoolFlags(row, MESSAGE_FLAGS);
}

/**
 * List archived conversations. `includeDeleted=false` hides recycle-bin
 * entries (deleted_at set); root-only listing passes false/true explicitly.
 */
export async function listArchived({ search, includeDeleted = false, page = 1, limit = 50 } = {}) {
  const archDb = await getArchiveDb();
  const conditions = [];
  const params = [];
  if (!includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }
  if (search) {
    conditions.push('(c.title LIKE ? OR EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.conversation_id = c.id AND cm.content LIKE ?))');
    const term = `%${search}%`;
    params.push(term, term);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const total = await archDb.get(`SELECT COUNT(*) as total FROM conversations c ${where}`, params);
  // NOTE: no users JOIN here — the archive DB has no users table. Name
  // enrichment (archived_by_name / deleted_by_name) happens in the service
  // layer against the live database.
  const rows = await archDb.all(
    `SELECT c.*,
      (SELECT COUNT(*) FROM conversation_messages cm WHERE cm.conversation_id = c.id) as message_count,
      (SELECT COALESCE(SUM(ma.file_size), 0) FROM message_attachments ma
        INNER JOIN conversation_messages cm ON ma.message_id = cm.id
        WHERE cm.conversation_id = c.id) as attachments_size
     FROM conversations c
     ${where}
     ORDER BY c.archived_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { conversations: withBoolFlagsAll(rows, CONVERSATION_FLAGS), total: total?.total ?? 0, page, limit };
}

/**
 * Archive-side oversight rows: the same shape and filters as the active-DB
 * oversight query (conversationOversightModel.listAllForOversight) but
 * sourced from the archive DB, so root's system-wide view includes
 * hard-moved conversations. Names are NOT resolvable here (no users table in
 * the archive DB) — the service layer batch-enriches against the live DB.
 *
 * Returns the first `fetch` rows in the SAME global order the oversight
 * model merges on (last activity DESC, id DESC), so the model can combine
 * the two stores into one correctly-ordered page. Includes recycle-bin
 * tombstones: oversight is the forensic view.
 */
function oversightWhere({ search, type, participantId, hasAttachments }) {
  const conditions = [];
  const params = [];
  if (search) {
    conditions.push('(c.title LIKE ? OR EXISTS (SELECT 1 FROM conversation_messages osm WHERE osm.conversation_id = c.id AND osm.content LIKE ?))');
    const term = `%${search}%`;
    params.push(term, term);
  }
  if (type) {
    conditions.push('c.type = ?');
    params.push(type);
  }
  if (participantId) {
    conditions.push(`EXISTS (SELECT 1 FROM conversation_participants op
      WHERE op.conversation_id = c.id AND op.user_id = ?)`);
    params.push(participantId);
  }
  if (hasAttachments === true) {
    conditions.push(`EXISTS (SELECT 1 FROM message_attachments oa
      INNER JOIN conversation_messages om ON oa.message_id = om.id
      WHERE om.conversation_id = c.id)`);
  }
  return [conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params];
}

export async function oversightArchiveRows({ search, type, participantId, hasAttachments, fetch = 50 } = {}) {
  const [where, params] = oversightWhere({ search, type, participantId, hasAttachments });
  const archDb = await getArchiveDb();
  const rows = await archDb.all(
    `SELECT c.id, c.title, c.type, c.ticket_id, c.created_by, c.created_at, c.updated_at,
      NULL as created_by_name,
      NULL as participant_names,
      (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) as participant_count,
      (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) as message_count,
      (SELECT COUNT(*) FROM message_attachments ma
        INNER JOIN conversation_messages cm ON ma.message_id = cm.id
        WHERE cm.conversation_id = c.id) as attachment_count,
      (SELECT COALESCE(SUM(ma.file_size), 0) FROM message_attachments ma
        INNER JOIN conversation_messages cm ON ma.message_id = cm.id
        WHERE cm.conversation_id = c.id) as attachments_bytes,
      COALESCE((SELECT MAX(cm2.created_at) FROM conversation_messages cm2 WHERE cm2.conversation_id = c.id), c.updated_at) as sort_at,
      (SELECT MAX(cm2.created_at) FROM conversation_messages cm2 WHERE cm2.conversation_id = c.id) as last_activity_at,
      1 as from_archive
     FROM conversations c
     ${where}
     ORDER BY sort_at DESC, c.id DESC
     LIMIT ?`,
    [...params, fetch]
  );
  // from_archive is a synthesized 0/1 marker — same normalization as the
  // column flags so the merged oversight page is uniformly boolean.
  return rows.map((r) => ({ ...r, from_archive: true }));
}

/** Count for the same filter set — the total side of the oversight union. */
export async function oversightArchiveTotal({ search, type, participantId, hasAttachments } = {}) {
  const [where, params] = oversightWhere({ search, type, participantId, hasAttachments });
  const archDb = await getArchiveDb();
  const row = await archDb.get(
    `SELECT COUNT(DISTINCT c.id) as total FROM conversations c ${where}`,
    params
  );
  return row?.total ?? 0;
}

/**
 * Archive matches for root's /conversations/search (same shape as the
 * active-DB query in conversationService.searchAllConversations).
 */
export async function searchArchiveConversations(query, limit = 25) {
  const term = `%${query}%`;
  const [where, params] = oversightWhere({ search: query });
  const archDb = await getArchiveDb();
  const rows = await archDb.all(
    `SELECT c.id, c.title, c.type,
      (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) as message_count,
      (SELECT cm.created_at FROM conversation_messages cm WHERE cm.conversation_id = c.id AND cm.content LIKE ?
       ORDER BY cm.id DESC LIMIT 1) as match_at,
      1 as from_archive
     FROM conversations c
     ${where}
     ORDER BY c.updated_at DESC
     LIMIT ?`,
    [term, ...params, limit]
  );
  return rows.map((r) => ({ ...r, from_archive: true }));
}

/**
 * Conversations idle (no messages, no update) for at least `days` — the
 * auto-archive scheduler's candidate query.
 */
export async function findIdleConversations(days, limit = 25) {
  const mainDb = await (await import('../database.js')).getDb();
  return mainDb.all(
    `SELECT c.id, c.title, MAX(cm.created_at) as last_message_at
     FROM conversations c
     LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
     WHERE c.is_archived = 0
     GROUP BY c.id
     HAVING (MAX(cm.created_at) IS NULL AND c.updated_at <= datetime('now', ?))
         OR MAX(cm.created_at) <= datetime('now', ?)
     ORDER BY COALESCE(MAX(cm.created_at), c.updated_at) ASC
     LIMIT ?`,
    [`-${days} days`, `-${days} days`, limit]
  );
}

/**
 * How many archive attachment rows reference a given basename (the flat
 * layout's file identity). Our caller subtracts its own row; any remaining
 * reference means the physical file is shared and must not be deleted.
 */
export async function countAttachmentBasenames(base) {
  const archDb = await getArchiveDb();
  const row = await archDb.get(
    `SELECT COUNT(*) AS n
     FROM message_attachments
     WHERE replace(file_path, char(92), '/') LIKE '%' || '/' || ?`,
    [String(base)]
  );
  return row?.n ?? 0;
}


