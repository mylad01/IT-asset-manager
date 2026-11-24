// reseed-admin.js - Standalone script to force-reseed the root admin user
// Run with: node server/db/reseed-admin.js

import connectionManager from './connection.js';
import { runMigrations } from './migrations/umzug-instance.js';
import bcrypt from 'bcrypt';
import logger from '../utils/logger.js';

// ── Safety guard ────────────────────────────────────────────────────────────
// Like reset:db / seed:*, this script installs well-known credentials
// (admin@studio.com / admin) — never silently in production. A production
// lockout-recovery run must be explicit: RESEED_ADMIN_ALLOW_PRODUCTION=1,
// and the reset account is then flagged requires_password_change so the
// operator MUST rotate the password at the next login (setup wizard flow
// creates the real root admin on a fresh production DB — see
// migrations/20260831000002-auto-seed.js).
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
if (IS_PRODUCTION && process.env.RESEED_ADMIN_ALLOW_PRODUCTION !== '1') {
  console.error('\n❌  Refusing to reseed the root admin in production!');
  console.error('    On a fresh production DB the first-run setup wizard creates');
  console.error('    the real admin account instead. For lockout recovery only,');
  console.error('    re-run with RESEED_ADMIN_ALLOW_PRODUCTION=1 (the reset login');
  console.error('    will be forced to change its password at next sign-in).\n');
  process.exit(1);
}

// Shared live-API guard: never race the dev API on its own DB (this script
// upserts the root admin while a server may hold the same database).
{
  // Import DOWN from server/utils: production code never reaches into
  // scripts/ (layering rule — see CLAUDE.md "Layering rules").
  const { refuseIfDevApiLive } = await import('../utils/liveApiGuard.js');
  const verdict = await refuseIfDevApiLive('reseed-admin');
  if (verdict.refused) process.exit(1);
}

async function reseedAdmin() {
  // Use the new ConnectionManager instead of direct getConnection()
  const db = await connectionManager.connect();
  // Run migrations to ensure schema exists (idempotent)
  await runMigrations(db);

  const passwordHash = await bcrypt.hash('admin', 10);

  const existing = await db.get("SELECT id, name, email, role FROM users WHERE email = 'admin@studio.com'");

  // In production recovery runs, force the operator through the change-password
  // flow instead of leaving the well-known default credential live.
  const forceChange = IS_PRODUCTION ? 1 : 0;

  // is_root=1 on both paths: this account IS the root admin (in dev the
  // 20260910000005-root-flag migration normally stamps it, but a row created
  // after migrations ran — e.g. production lockout recovery on a DB where it
  // was deleted — would otherwise stay is_root=0 and fail requireRoot routes).
  if (existing) {
    await db.run('UPDATE users SET name = ?, password_hash = ?, role = ?, requires_password_change = ?, is_root = 1 WHERE email = ?', ['admin', passwordHash, 'IT Admin', forceChange, 'admin@studio.com']);
    logger.info('Root admin user updated (force-reset password)');
  } else {
    await db.run("INSERT INTO users (name, email, role, password_hash, requires_password_change, is_root) VALUES (?, ?, ?, ?, ?, 1)", ['admin', 'admin@studio.com', 'IT Admin', passwordHash, forceChange]);
    logger.info('Root admin user created');
  }

  const user = await db.get("SELECT id, name, email, role, requires_password_change FROM users WHERE email = 'admin@studio.com'");
  logger.info({ user }, 'Root admin user in database');
  logger.info('Login credentials: Email/Username=admin@studio.com, Password=admin');

  await connectionManager.close();
}

reseedAdmin().catch((err) => {
  logger.error({ err }, 'Reseed failed');
  process.exit(1);
});
