import { getDb } from '../database.js';

export async function get(conversationId, userId) {
  const db = await getDb();
  return db.get(
    'SELECT * FROM conversation_reads WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
}

export async function upsert(conversationId, userId) {
  const db = await getDb();
  await db.run(
    `INSERT INTO conversation_reads (conversation_id, user_id, last_read_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(conversation_id, user_id)
     DO UPDATE SET last_read_at = CURRENT_TIMESTAMP`,
    [conversationId, userId]
  );
}

export async function getLastReadAt(conversationId, userId) {
  const db = await getDb();
  const row = await db.get(
    'SELECT last_read_at FROM conversation_reads WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
  return row ? row.last_read_at : '1970-01-01';
}
