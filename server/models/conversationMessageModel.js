import { getDb } from '../database.js';
import { withBoolFlags, withBoolFlagsAll, MESSAGE_FLAGS } from '../utils/serializeFlags.js';

export async function getByConversation(conversationId, { before, limit = 50 } = {}) {
  const db = await getDb();
  let query = `
    SELECT cm.*, u.name as user_name, u.email as user_email, u.role as user_role,
      (SELECT GROUP_CONCAT(json_object('id', ma.id, 'filename', ma.filename, 'file_size', ma.file_size, 'mime_type', ma.mime_type, 'file_path', ma.file_path))
       FROM message_attachments ma WHERE ma.message_id = cm.id) as attachments_json,
      (SELECT GROUP_CONCAT(json_object('emoji', mr.emoji, 'user_id', mr.user_id, 'user_name', ru.name))
       FROM message_reactions mr LEFT JOIN users ru ON mr.user_id = ru.id WHERE mr.message_id = cm.id) as reactions_json
    FROM conversation_messages cm
    LEFT JOIN users u ON cm.user_id = u.id
    WHERE cm.conversation_id = ?
  `;
  const params = [conversationId];

  if (before) {
    query += ' AND cm.id < ?';
    params.push(before);
  }

  // Tombstoned messages are filtered everywhere (oversight counts them
  // separately); the cursors are id-based so filtering after paging is safe.
  query += ' AND cm.deleted_at IS NULL';

  // Order by id (not created_at): ids are monotonic so same-second messages
  // keep a stable order, and the `before` cursor is id-based too.
  query += ' ORDER BY cm.id DESC LIMIT ?';
  params.push(limit);

  const messages = await db.all(query, params);

  return messages.map(m => ({
    ...withBoolFlags(m, MESSAGE_FLAGS),
    attachments: m.attachments_json ? mapAttachments(m.id, JSON.parse(`[${m.attachments_json}]`)) : [],
    reactions: m.reactions_json ? parseReactions(m.reactions_json) : []
  }));
}

// Attachments leave the API with a stable, membership-checked streaming URL
// (id-addressed, served with auth + Range support) — the raw server path is
// never exposed and no static mount leaks other conversations' files.
// `kind` mirrors the archive path's mapper (archiveDb.mapArchiveAttachments);
// AttachmentCard switches on it to render inline images/videos vs file cards.
export function attachmentKind(mime = '') {
  return String(mime).startsWith('image/') ? 'image' : String(mime).startsWith('video/') ? 'video' : 'file';
}

function mapAttachments(messageId, items) {
  return items.map(a => ({
    id: a.id,
    filename: a.filename,
    kind: attachmentKind(a.mime_type),
    url: `/api/conversations/messages/${messageId}/attachments/${a.id}`,
    file_size: a.file_size,
    mime_type: a.mime_type,
  }));
}

function parseReactions(json) {
  const items = JSON.parse(`[${json}]`);
  const grouped = {};
  for (const item of items) {
    if (!grouped[item.emoji]) {
      grouped[item.emoji] = { emoji: item.emoji, users: [], count: 0 };
    }
    grouped[item.emoji].users.push({ id: item.user_id, name: item.user_name });
    grouped[item.emoji].count++;
  }
  return Object.values(grouped);
}

export async function getById(id) {
  const db = await getDb();
  const row = await db.get(
    `SELECT cm.*, u.name as user_name
     FROM conversation_messages cm
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE cm.id = ?`,
    [id]
  );
  // Serialization boundary: is_internal / is_edited leave as real booleans.
  // This row is ALSO the WebSocket broadcast payload (new + edited message),
  // so HTTP responses and live frames share one shape.
  return withBoolFlags(row, MESSAGE_FLAGS);
}

export async function create(conversationId, { userId, content, isInternal = false }) {
  const db = await getDb();
  const result = await db.run(
    'INSERT INTO conversation_messages (conversation_id, user_id, content, is_internal) VALUES (?, ?, ?, ?)',
    [conversationId, userId, content, isInternal ? 1 : 0]
  );
  await db.run(
    'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [conversationId]
  );
  return result.lastID;
}

/**
 * Soft-delete (tombstone): the row stays (oversight can count it, the
 * archive DB mirrors it) but it disappears from every read path.
 */
export async function softDelete(id, deletedBy) {
  const db = await getDb();
  await db.run(
    'UPDATE conversation_messages SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?',
    [deletedBy ?? null, id]
  );
}

export async function update(id, { content }) {
  const db = await getDb();
  await db.run(
    'UPDATE conversation_messages SET content = ?, is_edited = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [content, id]
  );
}

export async function remove(id) {
  const db = await getDb();
  await db.run('DELETE FROM conversation_messages WHERE id = ?', [id]);
}

export async function countAfter(conversationId, timestamp) {
  const db = await getDb();
  const result = await db.get(
    'SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = ? AND created_at > ?',
    [conversationId, timestamp]
  );
  return result.count;
}

export async function searchInConversation(conversationId, query) {
  const db = await getDb();
  const searchTerm = `%${query}%`;
  return db.all(
    `SELECT cm.id, cm.content, cm.created_at, u.name as user_name
     FROM conversation_messages cm
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE cm.conversation_id = ? AND cm.content LIKE ? AND cm.deleted_at IS NULL
     ORDER BY cm.created_at DESC
     LIMIT 50`,
    [conversationId, searchTerm]
  );
}

export async function getAllForExport(conversationId) {
  const db = await getDb();
  const rows = await db.all(
    `SELECT cm.*, u.name as user_name,
      (SELECT GROUP_CONCAT(filename) FROM message_attachments WHERE message_id = cm.id) as attachment_files
     FROM conversation_messages cm
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE cm.conversation_id = ?
     ORDER BY cm.created_at ASC`,
    [conversationId]
  );
  return withBoolFlagsAll(rows, MESSAGE_FLAGS);
}
