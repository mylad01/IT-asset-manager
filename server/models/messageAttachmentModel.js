import { getDb } from '../database.js';

export async function getByMessage(messageId) {
  const db = await getDb();
  return db.all(
    'SELECT * FROM message_attachments WHERE message_id = ? ORDER BY created_at ASC',
    [messageId]
  );
}

export async function create(messageId, { filename, filePath, fileSize, mimeType }) {
  const db = await getDb();
  const result = await db.run(
    'INSERT INTO message_attachments (message_id, filename, file_path, file_size, mime_type) VALUES (?, ?, ?, ?, ?)',
    [messageId, filename, filePath, fileSize, mimeType]
  );
  return result.lastID;
}

export async function getById(id) {
  const db = await getDb();
  return db.get('SELECT * FROM message_attachments WHERE id = ?', [id]);
}

export async function remove(id) {
  const db = await getDb();
  const attachment = await db.get('SELECT file_path FROM message_attachments WHERE id = ?', [id]);
  await db.run('DELETE FROM message_attachments WHERE id = ?', [id]);
  return attachment;
}

export async function getByConversation(conversationId) {
  const db = await getDb();
  return db.all(
    `SELECT ma.* FROM message_attachments ma
     INNER JOIN conversation_messages cm ON ma.message_id = cm.id
     WHERE cm.conversation_id = ?`,
    [conversationId]
  );
}
