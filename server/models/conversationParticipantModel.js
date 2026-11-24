import { getDb } from '../database.js';

export async function getByConversation(conversationId) {
  const db = await getDb();
  return db.all(
    `SELECT cp.*, u.name, u.email, u.role as user_role
     FROM conversation_participants cp
     INNER JOIN users u ON cp.user_id = u.id
     WHERE cp.conversation_id = ?
     ORDER BY cp.joined_at ASC`,
    [conversationId]
  );
}

export async function addParticipants(conversationId, userIds, role = 'member') {
  const db = await getDb();
  const stmt = await db.prepare(
    'INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)'
  );
  for (const userId of userIds) {
    await stmt.run(conversationId, userId, role);
  }
  await stmt.finalize();
}

export async function removeParticipant(conversationId, userId) {
  const db = await getDb();
  await db.run(
    'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
}

export async function isParticipant(conversationId, userId) {
  const db = await getDb();
  const row = await db.get(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
  return !!row;
}

export async function isAdmin(conversationId, userId) {
  const db = await getDb();
  const row = await db.get(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND role = \'admin\'',
    [conversationId, userId]
  );
  return !!row;
}

export async function getParticipantUserIds(conversationId) {
  const db = await getDb();
  const rows = await db.all(
    'SELECT user_id FROM conversation_participants WHERE conversation_id = ?',
    [conversationId]
  );
  return rows.map(r => r.user_id);
}

export async function getUnreadCount(userId) {
  const db = await getDb();
  const result = await db.get(
    `SELECT COUNT(*) as total FROM conversations c
     INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
     WHERE cp.user_id = ? AND c.is_archived = 0
     AND EXISTS (
       SELECT 1 FROM conversation_messages cm
       WHERE cm.conversation_id = c.id
       AND cm.user_id != ?
       AND cm.created_at > COALESCE(
         (SELECT last_read_at FROM conversation_reads cr
          WHERE cr.conversation_id = c.id AND cr.user_id = ?),
         '1970-01-01'
       )
     )`,
    [userId, userId, userId]
  );
  return result.total;
}
