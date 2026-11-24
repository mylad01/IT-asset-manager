import { getDb } from '../database.js';

export async function getActiveByUser(userId, limit = 50) {
  const db = await getDb();
  return db.all(`
    SELECT * FROM notifications
    WHERE user_id = ? AND is_read = 0 AND (snooze_until IS NULL OR snooze_until <= datetime('now'))
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

export async function getAllByUser(userId, limit = 50, offset = 0) {
  const db = await getDb();
  return db.all(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [userId, limit, offset]);
}

export async function getUnreadCount(userId) {
  const db = await getDb();
  const row = await db.get(`
    SELECT COUNT(*) as count FROM notifications
    WHERE user_id = ? AND is_read = 0 AND (snooze_until IS NULL OR snooze_until <= datetime('now'))
  `, [userId]);
  return row?.count || 0;
}

export async function dismiss(id, userId) {
  const db = await getDb();
  await db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, userId]);
}

export async function snooze(id, userId, hours = 24) {
  const db = await getDb();
  await db.run('UPDATE notifications SET snooze_until = datetime("now", ?) WHERE id = ? AND user_id = ?', [`+${hours} hours`, id, userId]);
}

export async function create(notification) {
  const db = await getDb();
  await db.run(
    `INSERT INTO notifications (user_id, type, priority, title, message, link, is_read, snooze_until, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, datetime('now'))`,
    [
      notification.user_id,
      notification.type || 'system',
      notification.priority || 'info',
      notification.title || '',
      notification.message || '',
      notification.link || null
    ]
  );
}

export async function createMany(notifications) {
  if (!notifications.length) return [];
  const db = await getDb();
  const placeholders = notifications.map(() => '(?, ?, ?, ?, ?, ?, 0, NULL, datetime(\'now\'))').join(', ');
  const values = notifications.flatMap(n => [
    n.user_id,
    n.type || 'system',
    n.priority || 'info',
    n.title || '',
    n.message || '',
    n.link || null
  ]);
  // Capture MAX(id) before the insert so we can select exactly the rows we
  // just created and attach their real ids — the WebSocket push needs the
  // same shape the GET endpoints return (id, created_at) so clients can
  // dismiss/snooze a just-arrived notification.
  const maxRow = await db.get('SELECT MAX(id) as maxId FROM notifications');
  const beforeMax = maxRow?.maxId || 0;
  await db.run(
    `INSERT INTO notifications (user_id, type, priority, title, message, link, is_read, snooze_until, created_at) VALUES ${placeholders}`,
    values
  );
  const inserted = await db.all('SELECT * FROM notifications WHERE id > ? ORDER BY id ASC', [beforeMax]);
  attachRows(notifications, inserted);
  return notifications;
}

export async function markAllRead(userId) {
  const db = await getDb();
  await db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
}

export async function getByDateRange(userId, startDate, endDate) {
  const db = await getDb();
  return db.all(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM notifications
    WHERE user_id = ? AND date(created_at) BETWEEN ? AND ?
    GROUP BY date(created_at)
    ORDER BY date(created_at) ASC
  `, [userId, startDate, endDate]);
}

export async function getByDay(userId, date) {
  const db = await getDb();
  return db.all(`
    SELECT id, type, priority, title, message, link, is_read, created_at
    FROM notifications
    WHERE user_id = ? AND date(created_at) = ?
    ORDER BY created_at DESC
  `, [userId, date]);
}

export async function createManyInTxn(txn, notifications) {
  if (!notifications.length) return [];
  const placeholders = notifications.map(() => '(?, ?, ?, ?, ?, ?, 0, NULL, datetime(\'now\'))').join(', ');
  const values = notifications.flatMap(n => [
    n.user_id,
    n.type || 'system',
    n.priority || 'info',
    n.title || '',
    n.message || '',
    n.link || null
  ]);
  // Same id-attachment contract as createMany() — see comment there.
  const maxRow = await txn.get('SELECT MAX(id) as maxId FROM notifications');
  const beforeMax = maxRow?.maxId || 0;
  await txn.run(
    `INSERT INTO notifications (user_id, type, priority, title, message, link, is_read, snooze_until, created_at) VALUES ${placeholders}`,
    values
  );
  const inserted = await txn.all('SELECT * FROM notifications WHERE id > ? ORDER BY id ASC', [beforeMax]);
  attachRows(notifications, inserted);
  return notifications;
}

/* Match caller objects to their inserted rows (insert order is stable, but
   match on user_id+title as well so row order can never mis-attach). */
function attachRows(notifications, inserted) {
  const remaining = [...inserted];
  for (const n of notifications) {
    const idx = remaining.findIndex(r => r.user_id === n.user_id && r.title === n.title);
    if (idx !== -1) {
      Object.assign(n, { id: remaining[idx].id, created_at: remaining[idx].created_at, is_read: 0, snooze_until: null });
      remaining.splice(idx, 1);
    }
  }
}

export async function search(userId, { query, type, from, to, page = 1, limit = 20 }) {
  const db = await getDb();
  const conditions = ['user_id = ?'];
  const params = [userId];

  if (query) {
    conditions.push('(title LIKE ? OR message LIKE ?)');
    const like = `%${query}%`;
    params.push(like, like);
  }
  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }
  if (from) {
    conditions.push('date(created_at) >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('date(created_at) <= ?');
    params.push(to);
  }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * limit;

  const countRow = await db.get(`SELECT COUNT(*) as total FROM notifications WHERE ${where}`, params);
  const total = countRow?.total || 0;

  const results = await db.all(
    `SELECT id, type, priority, title, message, link, is_read, created_at
     FROM notifications
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { results, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}