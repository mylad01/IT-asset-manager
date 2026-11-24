// Migration 20260831000002-auto-seed
// Seeds default data: departments, asset types, root admin user
// Only runs if the database is empty (no users exist)

import bcrypt from 'bcrypt';

export async function up(db) {
  const userCount = await db.get('SELECT COUNT(*) as count FROM users');
  if (userCount.count > 0) return;
  const deptCount = await db.get('SELECT COUNT(*) as count FROM departments');
  if (deptCount.count === 0) {
    for (const dept of ['Clothing', 'Directing', 'Scene', 'VFX', 'Virtual', 'Workshops']) {
      await db.run('INSERT OR IGNORE INTO departments (name) VALUES (?)', [dept]);
    }
  }
  const typeCount = await db.get('SELECT COUNT(*) as count FROM asset_types');
  if (typeCount.count === 0) {
    for (const type of ['Workstation', 'Laptop', 'Monitor', 'Tablet', 'Camera']) {
      await db.run('INSERT OR IGNORE INTO asset_types (name) VALUES (?)', [type]);
    }
  }
  // In production, skip the built-in root admin so the first-time setup wizard
  // creates the real admin account. Dev/staging keep the seeded admin for convenience.
  if (process.env.NODE_ENV !== 'production') {
    const rootPasswordHash = await bcrypt.hash('admin', 10);
    await db.run("INSERT OR IGNORE INTO users (name, email, role, password_hash, requires_password_change) VALUES ('admin', 'admin@studio.com', 'IT Admin', ?, 0)", [rootPasswordHash]);
  }
}

export async function down(db) {
  await db.run("DELETE FROM users WHERE email = 'admin@studio.com'");
  await db.run("DELETE FROM departments WHERE name IN ('Clothing', 'Directing', 'Scene', 'VFX', 'Virtual', 'Workshops')");
  await db.run("DELETE FROM asset_types WHERE name IN ('Workstation', 'Laptop', 'Monitor', 'Tablet', 'Camera')");
}
