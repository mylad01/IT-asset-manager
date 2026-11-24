import { getDb } from '../database.js';

export async function getAll() {
  const db = await getDb();
  return db.all('SELECT * FROM asset_types ORDER BY name ASC');
}

export async function create(name) {
  const db = await getDb();
  await db.run('INSERT INTO asset_types (name) VALUES (?)', [name]);
}

export async function remove(id) {
  const db = await getDb();
  await db.run('DELETE FROM asset_types WHERE id = ?', [id]);
}
