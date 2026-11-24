import { getDb } from '../database.js';

export async function getByTicketId(ticketId, isITAdmin) {
  const db = await getDb();
  let query = `SELECT c.*, u.name as author_name, u.role as author_role FROM ticket_comments c JOIN users u ON c.user_id = u.id WHERE c.ticket_id = ?`;
  if (!isITAdmin) {
    query += ` AND c.is_internal = 0`;
  }
  query += ` ORDER BY c.created_at ASC`;
  return db.all(query, [ticketId]);
}

export async function create(comment) {
  const db = await getDb();
  const internalFlag = comment.is_internal ? 1 : 0;
  await db.run(
    'INSERT INTO ticket_comments (ticket_id, user_id, text, is_internal) VALUES (?, ?, ?, ?)',
    [comment.ticket_id, comment.user_id, comment.text, internalFlag]
  );
}

export async function markAsRead(ticketId, userId) {
  const db = await getDb();
  await db.run(`
    INSERT INTO ticket_reads (ticket_id, user_id, last_read_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(ticket_id, user_id) DO UPDATE SET last_read_at = CURRENT_TIMESTAMP
  `, [ticketId, userId]);
}
