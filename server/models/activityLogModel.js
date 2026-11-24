import { getDb } from '../database.js';

export async function create(entry) {
  const db = await getDb();
  await db.run(
    `INSERT INTO activity_logs (entity_type, entity_id, action, user_id, user_name, ip_address, changes, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.entity_type, entry.entity_id, entry.action, entry.user_id, entry.user_name, entry.ip_address, entry.changes, entry.metadata]
  );
}

export async function query(filters = {}) {
  const db = await getDb();
  const conditions = [];
  const params = [];

  if (filters.entity_type) {
    conditions.push('entity_type = ?');
    params.push(filters.entity_type);
  }
  if (filters.action) {
    conditions.push('action = ?');
    params.push(filters.action);
  }
  if (filters.user_id) {
    conditions.push('user_id = ?');
    params.push(filters.user_id);
  }
  if (filters.from) {
    conditions.push('created_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push('created_at <= ?');
    params.push(filters.to);
  }
  if (filters.search) {
    conditions.push('(user_name LIKE ? OR entity_id LIKE ? OR changes LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(parseInt(filters.limit) || 50, 1), 200);
  const page = Math.max(parseInt(filters.page) || 1, 1);
  const offset = (page - 1) * limit;

  const countRow = await db.get(`SELECT COUNT(*) as total FROM activity_logs ${where}`, params);
  const total = countRow ? countRow.total : 0;

  const logs = await db.all(
    `SELECT * FROM activity_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getByEntity(entityType, entityId) {
  const db = await getDb();
  return db.all(
    'SELECT * FROM activity_logs WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC',
    [entityType, entityId]
  );
}

export async function getDistinctUsers() {
  const db = await getDb();
  // DISTINCT on the (user_id, user_name) PAIR is not enough: the same user
  // can be logged under different name strings over time (renames, seed
  // variants), which duplicates user_id in the filter dropdown and breaks
  // React keys. Keep only the FRESHEST name per user_id (highest rowid).
  return db.all(
    `SELECT user_id, user_name FROM activity_logs
     WHERE user_id IS NOT NULL
       AND id = (SELECT MAX(id) FROM activity_logs a2 WHERE a2.user_id = activity_logs.user_id)
     ORDER BY user_name ASC`
  );
}
