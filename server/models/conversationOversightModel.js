// Oversight queries — root-only, cross-membership visibility.
//
// Every query here deliberately ignores conversation_participants (except as
// a filter). That is the whole point of oversight: root sees conversations he
// was never added to. All callers must be root-gated at the route level.
//
// The system-wide view spans BOTH stores: the active DB and the hard-move
// archive DB (archived + recycle-bin conversations live only there now).
// Both sides run the SAME filters and order by the same key (last activity
// DESC, id DESC); `listAllForOversight` merges them into one globally
// ordered, duplicate-free page.

import { getDb } from '../database.js';
import * as archiveDb from '../db/archiveDb.js';

/**
 * Full system-wide conversation list with per-conversation detail:
 * participant names, message/attachment counts, storage, activity dates.
 * Filters: search (title + message body), type, participant, hasAttachments.
 * Page N of the merged result is deterministic because each store yields the
 * same ordering key; we fetch the first page*limit rows from each store,
 * merge, and slice — no duplicate or skipped rows across page boundaries.
 */
export async function listAllForOversight({ search, type, participantId, hasAttachments, page = 1, limit = 50 } = {}) {
  const db = await getDb();
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push(`(c.title LIKE ? OR EXISTS (
      SELECT 1 FROM conversation_messages osm
      WHERE osm.conversation_id = c.id AND osm.content LIKE ?))`);
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
  // Note: archived + soft-deleted conversations are not in the active DB at
  // all (hard-move), so no archive-state filter is needed on this side.

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const fetchN = page * limit; // how many each store must yield to fill page N

  const activeTotal = await db.get(
    `SELECT COUNT(DISTINCT c.id) as total FROM conversations c ${where}`,
    params
  );

  const rows = await db.all(
    `SELECT c.id, c.title, c.type, c.ticket_id, c.created_by, c.created_at, c.updated_at,
      creator.name as created_by_name,
      (SELECT GROUP_CONCAT(u2.name) FROM conversation_participants cp2
        LEFT JOIN users u2 ON cp2.user_id = u2.id
        WHERE cp2.conversation_id = c.id) as participant_names,
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
      0 as from_archive
     FROM conversations c
     LEFT JOIN users creator ON c.created_by = creator.id
     ${where}
     ORDER BY sort_at DESC, c.id DESC
     LIMIT ?`,
    [...params, fetchN]
  );

  // Archive side: same filters, same order. Names resolve in the service
  // layer (the archive DB has no users table). Rows arrive with ids.
  const [archiveRows, archiveTotal] = await Promise.all([
    archiveDb
      .oversightArchiveRows({ search, type, participantId, hasAttachments, fetch: fetchN })
      .catch(() => []),
    archiveDb
      .oversightArchiveTotal({ search, type, participantId, hasAttachments })
      .catch(() => 0),
  ]);

  // Merge on the shared key (sort_at DESC, id DESC) and slice the page.
  // from_archive is normalized to a real boolean on BOTH sides here (archive
  // rows are mapped in archiveDb.oversightArchiveRows), so the merged page —
  // and everything the service does with it — sees one consistent type.
  const merged = [...rows.map((r) => ({ ...r, from_archive: false })), ...archiveRows].sort((a, b) => {
    const ka = `${a.sort_at || ''}|${a.id}`;
    const kb = `${b.sort_at || ''}|${b.id}`;
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  const total = (activeTotal?.total ?? 0) + archiveTotal;
  const pageRows = merged.slice((page - 1) * limit, page * limit);
  return { conversations: pageRows, total, page, limit };
}

/** Aggregates for the oversight header: totals across the whole system. */
export async function getOversightSummary() {
  const db = await getDb();
  const row = await db.get(
    `SELECT
      (SELECT COUNT(*) FROM conversations) as total_conversations,
      (SELECT COUNT(*) FROM conversation_messages) as total_messages,
      (SELECT COUNT(*) FROM conversation_messages WHERE deleted_at IS NOT NULL) as deleted_messages,
      (SELECT COUNT(*) FROM message_attachments) as total_attachments,
      (SELECT COALESCE(SUM(file_size), 0) FROM message_attachments) as attachments_bytes`
  );
  const arch = (await archiveDb.getArchiveStats().catch(() => null)) || {};
  return {
    total_conversations: (row.total_conversations || 0) + (arch.conversations || 0),
    total_messages: (row.total_messages || 0) + (arch.messages || 0),
    deleted_messages: row.deleted_messages || 0,
    total_attachments: (row.total_attachments || 0) + (arch.attachments || 0),
    attachments_bytes: (row.attachments_bytes || 0) + (arch.bytes || 0),
  };
}
