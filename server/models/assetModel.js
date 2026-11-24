import { getDb } from '../database.js';

export async function getAll() {
  const db = await getDb();
  return db.all(`
    SELECT assets.*, departments.name as dept, users.name as assigned_to
    FROM assets
    LEFT JOIN departments ON assets.dept_id = departments.id
    LEFT JOIN users ON assets.assigned_to_user_id = users.id
  `);
}

export async function getById(id) {
  const db = await getDb();
  return db.get(`
    SELECT assets.*, departments.name as dept, users.name as assigned_to
    FROM assets
    LEFT JOIN departments ON assets.dept_id = departments.id
    LEFT JOIN users ON assets.assigned_to_user_id = users.id
    WHERE assets.id = ?
  `, [id]);
}

export async function getUnassigned() {
  const db = await getDb();
  return db.all('SELECT * FROM assets WHERE assigned_to_user_id IS NULL');
}

export async function getHistory(assetId) {
  const db = await getDb();
  return db.all(`
    SELECT id, action as action_type, user_name, changes, created_at as timestamp
    FROM activity_logs
    WHERE entity_type = 'asset' AND entity_id = ?
    ORDER BY created_at DESC
  `, [assetId]);
}

export async function create(asset) {
  const db = await getDb();
  await db.run(
    'INSERT INTO assets (id, type, model, serial_number, purchase_date, notes, custom_attributes, image_url, dept_id, assigned_to_user_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [asset.id, asset.type, asset.model, asset.serial_number, asset.purchase_date, asset.notes, asset.custom_attributes, asset.image_url, asset.dept_id, asset.assigned_to_user_id, asset.status]
  );
}

export async function updateAssignment(id, userId, deptId, status) {
  const db = await getDb();
  await db.run(
    'UPDATE assets SET assigned_to_user_id = ?, dept_id = ?, status = ? WHERE id = ?',
    [userId, deptId, status, id]
  );
}

export async function remove(id) {
  const db = await getDb();
  await db.run('DELETE FROM assets WHERE id = ?', [id]);
}

export async function addLogEntry(assetId, userId, actionType, notes) {
  const db = await getDb();
  let userName = null;
  if (userId) {
    const user = await db.get('SELECT name FROM users WHERE id = ?', [userId]);
    userName = user ? user.name : null;
  }
  await db.run(
    'INSERT INTO activity_logs (entity_type, entity_id, action, user_id, user_name, changes) VALUES (?, ?, ?, ?, ?, ?)',
    ['asset', assetId, actionType || 'assign', userId, userName, notes ? JSON.stringify({ notes: { old: null, new: notes } }) : null]
  );
}

export async function getCurrentOwner(id) {
  const db = await getDb();
  return db.get('SELECT assigned_to_user_id FROM assets WHERE id = ?', [id]);
}

export async function getAvailableByType(type, limit) {
  const db = await getDb();
  return db.all('SELECT id FROM assets WHERE type = ? AND assigned_to_user_id IS NULL LIMIT ?', [type, limit]);
}

export async function getAvailableByTypeFull(type, limit) {
  const db = await getDb();
  return db.all(
    `SELECT assets.id, assets.type, assets.model, assets.serial_number, assets.image_url, assets.custom_attributes
     FROM assets WHERE assets.type = ? AND assets.assigned_to_user_id IS NULL
     ORDER BY assets.id ASC LIMIT ?`,
    [type, limit]
  );
}
