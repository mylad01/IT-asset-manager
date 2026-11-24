import { getDb } from '../database.js';

export async function getAll() {
  const db = await getDb();
  return db.all('SELECT * FROM consumables ORDER BY name ASC');
}

export async function getById(id) {
  const db = await getDb();
  return db.get('SELECT quantity, name, threshold FROM consumables WHERE id = ?', [id]);
}

export async function create(item) {
  const db = await getDb();
  const result = await db.run(
    'INSERT INTO consumables (name, description, quantity, threshold) VALUES (?, ?, ?, ?)',
    [item.name, item.description, item.quantity, item.threshold]
  );
  // Surface the new row id so callers (service/controller) can return 201 with
  // a Location-ready id instead of forcing clients to re-list to find it.
  // (sqlite3 driver exposes lastID; better-sqlite3 would expose lastInsertRowid.)
  return { id: Number(result?.lastID ?? result?.lastInsertRowid ?? 0) || null };
}

export async function adjustStock(id, amount) {
  const db = await getDb();
  await db.run('UPDATE consumables SET quantity = MAX(0, quantity + ?) WHERE id = ?', [amount, id]);
  return db.get('SELECT quantity, name, threshold FROM consumables WHERE id = ?', [id]);
}

export async function updateQuantity(id, quantity) {
  const db = await getDb();
  await db.run('UPDATE consumables SET quantity = ? WHERE id = ?', [quantity, id]);
}

export async function remove(id) {
  const db = await getDb();
  await db.run('DELETE FROM consumables WHERE id = ?', [id]);
}
