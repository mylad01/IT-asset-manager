import { getDb } from '../database.js';

export async function getByUserId(userId) {
  const db = await getDb();
  return db.all(`
    SELECT t.*, a.model as asset_model,
    (SELECT COUNT(*) FROM ticket_comments WHERE ticket_id = t.id AND is_internal = 0) as comment_count,
    (SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id = t.id AND c.user_id != ? AND c.is_internal = 0 AND c.created_at > COALESCE((SELECT last_read_at FROM ticket_reads r WHERE r.ticket_id = t.id AND r.user_id = ?), '1970-01-01')) as unread_count
    FROM tickets t LEFT JOIN assets a ON t.asset_id = a.id WHERE t.user_id = ? ORDER BY t.created_at DESC
  `, [userId, userId, userId]);
}

export async function getAllForAdmin(userId) {
  const db = await getDb();
  return db.all(`
    SELECT t.*, u.name as user_name, u.email as user_email, a.model as asset_model, a.id as hardware_id, admin.name as admin_name,
    (SELECT COUNT(*) FROM ticket_comments WHERE ticket_id = t.id) as comment_count,
    (SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id = t.id AND c.user_id != ? AND c.created_at > COALESCE((SELECT last_read_at FROM ticket_reads r WHERE r.ticket_id = t.id AND r.user_id = ?), '1970-01-01')) as unread_count
    FROM tickets t
    LEFT JOIN users u ON t.user_id = u.id LEFT JOIN assets a ON t.asset_id = a.id LEFT JOIN users admin ON t.assigned_admin_id = admin.id
    ORDER BY CASE t.status WHEN 'Submitted to Manager' THEN 1 WHEN 'Submitted to Helpdesk Administrator' THEN 2 WHEN 'In Progress' THEN 3 WHEN 'Waiting on User' THEN 4 ELSE 5 END, t.created_at DESC
  `, [userId, userId]);
}

export async function getAllForStandardAdmin(userId) {
  const db = await getDb();
  return db.all(`
    SELECT t.*, u.name as user_name, u.email as user_email, a.model as asset_model, a.id as hardware_id, admin.name as admin_name,
    (SELECT COUNT(*) FROM ticket_comments WHERE ticket_id = t.id) as comment_count,
    (SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id = t.id AND c.user_id != ? AND c.created_at > COALESCE((SELECT last_read_at FROM ticket_reads r WHERE r.ticket_id = t.id AND r.user_id = ?), '1970-01-01')) as unread_count
    FROM tickets t
    LEFT JOIN users u ON t.user_id = u.id LEFT JOIN assets a ON t.asset_id = a.id LEFT JOIN users admin ON t.assigned_admin_id = admin.id
    WHERE t.assigned_admin_id = ? OR t.assigned_admin_id IS NULL
    ORDER BY CASE t.status WHEN 'Submitted to Manager' THEN 1 WHEN 'Submitted to Helpdesk Administrator' THEN 2 WHEN 'In Progress' THEN 3 WHEN 'Waiting on User' THEN 4 ELSE 5 END, t.created_at DESC
  `, [userId, userId, userId]);
}

export async function create(ticket) {
  const db = await getDb();
  const result = await db.run(
    'INSERT INTO tickets (user_id, asset_id, assigned_admin_id, title, description, category, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?, "Submitted to Manager")',
    [ticket.user_id, ticket.asset_id, ticket.assigned_admin_id, ticket.title, ticket.description, ticket.category, ticket.priority]
  );
  return result.lastID;
}

export async function assignAdmin(id, adminId) {
  const db = await getDb();
  await db.run('UPDATE tickets SET assigned_admin_id = ? WHERE id = ?', [adminId, id]);
}

export async function updateStatus(id, status) {
  const db = await getDb();
  await db.run('UPDATE tickets SET status = ? WHERE id = ?', [status, id]);
}

export async function getById(id) {
  const db = await getDb();
  return db.get('SELECT user_id, assigned_admin_id, title, status FROM tickets WHERE id = ?', [id]);
}
