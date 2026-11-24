import { getDb } from '../database.js';
import { withBoolFlags, withBoolFlagsAll, CONVERSATION_FLAGS } from '../utils/serializeFlags.js';

export async function getAll(userId, { type, archived, search, page = 1, limit = 50 } = {}) {
  const db = await getDb();
  const conditions = ['cp.user_id = ?'];
  const params = [userId];

  if (type) {
    conditions.push('c.type = ?');
    params.push(type);
  }

  if (archived !== undefined) {
    conditions.push('c.is_archived = ?');
    params.push(archived ? 1 : 0);
  }

  if (search) {
    conditions.push('(c.title LIKE ? OR EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.conversation_id = c.id AND cm.content LIKE ?))');
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const countResult = await db.get(
    `SELECT COUNT(DISTINCT c.id) as total FROM conversations c
     INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
     ${where}`,
    params
  );

  const conversations = await db.all(
    `SELECT c.*,
      cm.content as last_message,
      cm.created_at as last_message_at,
      u.name as last_message_user_name,
      (SELECT COUNT(*) FROM conversation_messages cm2
       INNER JOIN conversation_reads cr ON cm2.conversation_id = cr.conversation_id
       WHERE cm2.conversation_id = c.id
       AND cm2.user_id != ?
       AND cm2.created_at > cr.last_read_at
       AND cr.user_id = ?) as unread_count,
      (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) as participant_count
     FROM conversations c
     INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
     LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
       AND cm.id = (SELECT MAX(id) FROM conversation_messages WHERE conversation_id = c.id)
     LEFT JOIN users u ON cm.user_id = u.id
     ${where}
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT ? OFFSET ?`,
    [userId, userId, ...params, limit, offset]
  );

  return { conversations: withBoolFlagsAll(conversations, CONVERSATION_FLAGS), total: countResult.total, page, limit };
}

export async function getById(id) {
  const db = await getDb();
  const row = await db.get(
    `SELECT c.*, u.name as creator_name, u.email as creator_email
     FROM conversations c
     LEFT JOIN users u ON c.created_by = u.id
     WHERE c.id = ?`,
    [id]
  );
  // Serialization boundary: is_archived leaves as a real boolean.
  return withBoolFlags(row, CONVERSATION_FLAGS);
}

export async function create({ title, type = 'standalone', ticketId = null, createdBy }) {
  const db = await getDb();
  const result = await db.run(
    'INSERT INTO conversations (title, type, ticket_id, created_by) VALUES (?, ?, ?, ?)',
    [title, type, ticketId, createdBy]
  );
  return result.lastID;
}

export async function update(id, { title }) {
  const db = await getDb();
  await db.run(
    'UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [title, id]
  );
}

export async function archive(id) {
  const db = await getDb();
  await db.run(
    'UPDATE conversations SET is_archived = 1, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id]
  );
}

export async function unarchive(id) {
  const db = await getDb();
  await db.run(
    'UPDATE conversations SET is_archived = 0, archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id]
  );
}

export async function remove(id) {
  const db = await getDb();
  await db.run('DELETE FROM conversations WHERE id = ?', [id]);
}

export async function search(query, userId) {
  const db = await getDb();
  const searchTerm = `%${query}%`;
  const rows = await db.all(
    `SELECT c.id, c.title, c.type, c.is_archived
     FROM conversations c
     INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
     WHERE cp.user_id = ?
     AND (c.title LIKE ? OR EXISTS (
       SELECT 1 FROM conversation_messages cm
       WHERE cm.conversation_id = c.id AND cm.content LIKE ?
     ))
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT 20`,
    [userId, searchTerm, searchTerm]
  );
  return withBoolFlagsAll(rows, CONVERSATION_FLAGS);
}

export async function touchUpdated(id) {
  const db = await getDb();
  await db.run('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

export async function getByTicketId(ticketId) {
  const db = await getDb();
  return db.get(
    'SELECT id FROM conversations WHERE ticket_id = ? AND type = \'ticket-linked\'',
    [ticketId]
  );
}

export async function getAllForExport() {
  const db = await getDb();
  const rows = await db.all(
    `SELECT c.*, u.name as creator_name
     FROM conversations c
     LEFT JOIN users u ON c.created_by = u.id
     ORDER BY c.created_at DESC`
  );
  return withBoolFlagsAll(rows, CONVERSATION_FLAGS);
}

/**
 * Total unread messages across all of a user's non-archived conversations.
 * Mirrors the unread_count semantics of getAll(), but tolerates a missing
 * conversation_reads row (never-opened conversation = everything unread).
 */
export async function getTotalUnreadCount(userId) {
  const db = await getDb();
  const result = await db.get(
    `SELECT COALESCE(SUM(unread), 0) AS total FROM (
       SELECT (SELECT COUNT(*) FROM conversation_messages cm
               WHERE cm.conversation_id = c.id
                 AND cm.user_id != ?
                 AND cm.created_at > COALESCE(cr.last_read_at, '1970-01-01 00:00:00')) AS unread
       FROM conversations c
       INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
       LEFT JOIN conversation_reads cr ON cr.conversation_id = c.id AND cr.user_id = ?
       WHERE cp.user_id = ? AND c.is_archived = 0
     )`,
    [userId, userId, userId]
  );
  return result?.total ?? 0;
}
