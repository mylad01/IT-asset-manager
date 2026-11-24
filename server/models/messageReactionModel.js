import { getDb } from '../database.js';

export async function getByMessage(messageId) {
  const db = await getDb();
  return db.all(
    `SELECT mr.*, u.name as user_name
     FROM message_reactions mr
     LEFT JOIN users u ON mr.user_id = u.id
     WHERE mr.message_id = ?
     ORDER BY mr.created_at ASC`,
    [messageId]
  );
}

export async function add(messageId, userId, emoji) {
  const db = await getDb();
  try {
    await db.run(
      'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
      [messageId, userId, emoji]
    );
    return true;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT' || err.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw err;
  }
}

export async function remove(messageId, userId, emoji) {
  const db = await getDb();
  const result = await db.run(
    'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    [messageId, userId, emoji]
  );
  return result.changes > 0;
}

export async function hasReacted(messageId, userId, emoji) {
  const db = await getDb();
  const row = await db.get(
    'SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    [messageId, userId, emoji]
  );
  return !!row;
}
