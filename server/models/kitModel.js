import { getDb } from '../database.js';

export async function getAll() {
  const db = await getDb();
  const kits = await db.all('SELECT * FROM kits ORDER BY name ASC');
  for (let kit of kits) {
    kit.items = await db.all('SELECT id, asset_type, quantity FROM kit_items WHERE kit_id = ?', [kit.id]);
  }
  return kits;
}

export async function getById(id) {
  const db = await getDb();
  return db.get('SELECT * FROM kits WHERE id = ?', [id]);
}

export async function create(kit) {
  const db = await getDb();
  await db.exec('BEGIN TRANSACTION');
  try {
    const result = await db.run('INSERT INTO kits (name, description) VALUES (?, ?)', [kit.name, kit.description]);
    const kitId = result.lastID ?? result.lastInsertRowid;
    for (let item of (kit.items || [])) {
      await db.run('INSERT INTO kit_items (kit_id, asset_type, quantity) VALUES (?, ?, ?)', [kitId, item.asset_type, item.quantity]);
    }
    await db.exec('COMMIT');
    // Surface the new kit id so the API can return 201 with an id (load-test
    // fixtures and UI flows should not need to re-list to find the new row).
    return { id: Number(kitId) || null };
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

export async function getItems(kitId) {
  const db = await getDb();
  return db.all('SELECT asset_type, quantity FROM kit_items WHERE kit_id = ?', [kitId]);
}

export async function remove(id) {
  const db = await getDb();
  await db.exec('BEGIN TRANSACTION');
  try {
    await db.run('DELETE FROM kit_items WHERE kit_id = ?', [id]);
    await db.run('DELETE FROM kits WHERE id = ?', [id]);
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}
