import connectionManager from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrations/umzug-instance.js';
import bcrypt from 'bcrypt';

// ── Safety guard ────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  console.error('\n❌  Refusing to seed test data in production!');
  console.error('    Set NODE_ENV=development or omit it to run this script.\n');
  process.exit(1);
}

// Shared live-API guard: never race the dev API on its own DB.
{
  const { refuseIfDevApiLive } = await import('../server/utils/liveApiGuard.js');
  const verdict = await refuseIfDevApiLive('seedTestUsers');
  if (verdict.refused) process.exit(1);
}

/**
 * Seed Test Users Script
 *
 * Creates the following test accounts:
 *   1. Root Admin    – user: admin    / password: admin
 *   2. Administrator – user: admin1   / password: 12345678
 *   3. Administrator – user: admin2   / password: 12345678
 *   4. Staff         – user: staff1   / password: 12345678
 *   5. Staff         – user: staff2   / password: 12345678
 *   6. Read-Only     – user: readonly / password: readonly1234
 *
 * Run: node scripts/seedTestUsers.js
 */

const testUsers = [
  { name: 'admin',  email: 'admin@studio.com',  role: 'IT Admin', pass: 'admin'     },
  { name: 'admin1', email: 'admin1@studio.com', role: 'IT Admin', pass: '12345678' },
  { name: 'admin2', email: 'admin2@studio.com', role: 'IT Admin', pass: '12345678' },
  { name: 'staff1', email: 'staff1@studio.com', role: 'Staff',    pass: '12345678' },
  { name: 'staff2', email: 'staff2@studio.com', role: 'Staff',    pass: '12345678' },
  { name: 'readonly', email: 'readonly1@studio.com', role: 'Read-Only', pass: 'readonly1234' },
];

async function seedTestUsers() {
  const db = await connectionManager.connect();
  console.log('Connected to database.');

  // Run migrations to ensure schema exists
  await runMigrations(db);
  console.log('Migrations applied.\n');

  let created = 0;
  let skipped  = 0;    for (const user of testUsers) {
    try {
      const hash = await bcrypt.hash(user.pass, 10);
      // Check by email first (email UNIQUE constraint), then by name
      const existing = await db.get('SELECT id FROM users WHERE email = ? OR name = ?', [user.email, user.name]);
      if (existing) {
        await db.run(
          'UPDATE users SET name = ?, email = ?, role = ?, password_hash = ?, requires_password_change = 0 WHERE id = ?',
          [user.name, user.email, user.role, hash, existing.id]
        );
      } else {
        await db.run(
          'INSERT INTO users (name, email, role, password_hash, requires_password_change) VALUES (?, ?, ?, ?, 0)',
          [user.name, user.email, user.role, hash]
        );
      }
      created++;
      console.log(`  ✓ ${user.name.padEnd(8)} (${user.role}) — ${user.email}`);
    } catch (err) {
      console.error(`  ✗ Failed to seed "${user.name}": ${err.message}`);
      skipped++;
    }
  }

  console.log('\n--- Seed Summary ---');
  console.log(`  Users processed : ${created}`);
  console.log(`  Failed          : ${skipped}`);
  console.log('\nTest Accounts:');
  console.log('  ┌──────────┬──────────────────────────────┬────────────┬──────────┐');
  console.log('  │ Role     │ Email                        │ Password   │ User     │');
  console.log('  ├──────────┼──────────────────────────────┼────────────┼──────────┤');
  for (const u of testUsers) {
    const role  = u.role.padEnd(8);
    const email = u.email.padEnd(28);
    const pass  = u.pass.padEnd(10);
    const name  = u.name.padEnd(8);
    console.log(`  │ ${role} │ ${email} │ ${pass} │ ${name} │`);
  }
  console.log('  └──────────┴──────────────────────────────┴────────────┴──────────┘');

  await connectionManager.close();
  console.log('\nDatabase connection closed. Done!');
}

seedTestUsers().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
