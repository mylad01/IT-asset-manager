import { getDb } from '../database.js';

export async function getAnalytics(userId, isRoot) {
  const db = await getDb();

  let activeQuery, urgentQuery, unreadQuery, statusQuery;
  let baseParams = [];
  let unreadParams = [];

  if (isRoot) {
    activeQuery = `SELECT COUNT(*) as count FROM tickets WHERE status != 'Resolved'`;
    urgentQuery = `SELECT COUNT(*) as count FROM tickets WHERE priority = 'Critical' AND status != 'Resolved'`;
    statusQuery = `SELECT status, COUNT(*) as count FROM tickets GROUP BY status`;
    unreadQuery = `
      SELECT COUNT(c.id) as count FROM ticket_comments c
      JOIN tickets t ON c.ticket_id = t.id
      WHERE c.user_id != ?
      AND c.created_at > COALESCE((SELECT last_read_at FROM ticket_reads r WHERE r.ticket_id = t.id AND r.user_id = ?), '1970-01-01')
    `;
    unreadParams = [userId, userId];
  } else {
    activeQuery = `SELECT COUNT(*) as count FROM tickets WHERE status != 'Resolved' AND (assigned_admin_id = ? OR assigned_admin_id IS NULL)`;
    urgentQuery = `SELECT COUNT(*) as count FROM tickets WHERE priority = 'Critical' AND status != 'Resolved' AND (assigned_admin_id = ? OR assigned_admin_id IS NULL)`;
    statusQuery = `SELECT status, COUNT(*) as count FROM tickets WHERE (assigned_admin_id = ? OR assigned_admin_id IS NULL) GROUP BY status`;
    baseParams = [userId];
    unreadQuery = `
      SELECT COUNT(c.id) as count FROM ticket_comments c
      JOIN tickets t ON c.ticket_id = t.id
      WHERE c.user_id != ? AND (t.assigned_admin_id = ? OR t.assigned_admin_id IS NULL)
      AND c.created_at > COALESCE((SELECT last_read_at FROM ticket_reads r WHERE r.ticket_id = t.id AND r.user_id = ?), '1970-01-01')
    `;
    unreadParams = [userId, userId, userId];
  }

  const [activeRes, urgentRes, unreadRes, statusBreakdown] = await Promise.all([
    db.get(activeQuery, baseParams),
    db.get(urgentQuery, baseParams),
    db.get(unreadQuery, unreadParams),
    db.all(statusQuery, baseParams),
  ]);

  return {
    activeTickets: activeRes.count || 0,
    urgentRequests: urgentRes.count || 0,
    unreadMessages: unreadRes.count || 0,
    statusBreakdown: statusBreakdown || [],
  };
}
