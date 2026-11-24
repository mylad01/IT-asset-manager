import { getDb } from '../database.js';
import bcrypt from 'bcrypt';

export async function getByEmail(email) {
  const db = await getDb();
  // Match by email OR by name, so users can log in with either
  return db.get('SELECT * FROM users WHERE email = ? OR name = ?', [email, email]);
}

export async function getById(id) {
  const db = await getDb();
  return db.get('SELECT * FROM users WHERE id = ?', [id]);
}

export async function getAll() {
  const db = await getDb();
  return db.all('SELECT users.id, users.name, users.email, users.role, departments.name as department, users.dept_id FROM users LEFT JOIN departments ON users.dept_id = departments.id');
}

export async function getAdmins() {
  const db = await getDb();
  return db.all('SELECT id, name FROM users WHERE role = "IT Admin" ORDER BY name ASC');
}

export async function getAssetsByUser(userId) {
  const db = await getDb();
  return db.all('SELECT assets.*, departments.name as dept FROM assets LEFT JOIN departments ON assets.dept_id = departments.id WHERE assigned_to_user_id = ?', [userId]);
}

export async function create(user) {
  const db = await getDb();
  const passwordHash = await bcrypt.hash(user.password, 10);
  const result = await db.run(
    'INSERT INTO users (name, email, role, dept_id, password_hash, requires_password_change) VALUES (?, ?, ?, ?, ?, 1)',
    [user.name, user.email, user.role || 'Staff', user.dept_id, passwordHash]
  );
  // Surface the new row id so callers can return a Location-ready 201 body
  // (sqlite3 driver exposes lastID; better-sqlite3 would be lastInsertRowid).
  return { id: Number(result?.lastID ?? result?.lastInsertRowid ?? 0) || null };
}

export async function update(id, user) {
  const db = await getDb();
  if (user.password && user.password.trim() !== '') {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    await db.run(
      'UPDATE users SET name = ?, email = ?, role = ?, dept_id = ?, password_hash = ?, requires_password_change = 1 WHERE id = ?',
      [user.name, user.email, user.role, user.dept_id, hashedPassword, id]
    );
  } else {
    await db.run(
      'UPDATE users SET name = ?, email = ?, role = ?, dept_id = ? WHERE id = ?',
      [user.name, user.email, user.role, user.dept_id, id]
    );
  }
}

export async function remove(id) {
  const db = await getDb();
  await db.run('DELETE FROM users WHERE id = ?', [id]);
}

export async function updatePassword(id, hashedPassword) {
  const db = await getDb();
  await db.run('UPDATE users SET password_hash = ?, requires_password_change = 0 WHERE id = ?', [hashedPassword, id]);
}

export async function getToastBannersEnabled(id) {
  const db = await getDb();
  const row = await db.get('SELECT toast_banners_enabled FROM users WHERE id = ?', [id]);
  return row ? row.toast_banners_enabled !== 0 : true; // default: enabled
}

export async function setToastBannersEnabled(id, enabled) {
  const db = await getDb();
  await db.run('UPDATE users SET toast_banners_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

// ── Per-user UI preferences (PLAN.MD §13 P1) ────────────────────────────
// One JSON blob in users.ui_prefs instead of a column per preference: the
// registry owns the key list, the zod schema (uiPrefsSchema.js) validates
// every write, and reads are whole-blob — SQL never filters a single pref.

export async function getUiPrefs(id) {
  const db = await getDb();
  const row = await db.get('SELECT ui_prefs FROM users WHERE id = ?', [id]);
  if (!row || !row.ui_prefs) return {};
  try {
    const parsed = JSON.parse(row.ui_prefs);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Corrupt blob (manual edit, older writer) — degrade to defaults rather
    // than failing login/prefs reads.
    return {};
  }
}

export async function setUiPrefs(id, prefsObject) {
  const db = await getDb();
  await db.run('UPDATE users SET ui_prefs = ? WHERE id = ?', [JSON.stringify(prefsObject), id]);
}
