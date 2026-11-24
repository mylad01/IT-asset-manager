import { getDb } from '../database.js';

export async function getAll() {
  const db = await getDb();
  return db.all('SELECT * FROM departments');
}

export async function getUsersByDept(deptId) {
  const db = await getDb();
  return db.all('SELECT * FROM users WHERE dept_id = ?', [deptId]);
}

export async function create(name) {
  const db = await getDb();
  await db.run('INSERT INTO departments (name) VALUES (?)', [name]);
}

export async function remove(id) {
  const db = await getDb();
  await db.run('DELETE FROM departments WHERE id = ?', [id]);
}
