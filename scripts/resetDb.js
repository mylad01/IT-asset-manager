import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import connectionManager from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrations/umzug-instance.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
// NOTE: top-level await is available (package.json is ESM) — the live-server
// guard below uses it to consult the process table before touching files.

/**
 * Database Reset & Full Reseed Script
 *
 * 1. Wipes the database (file delete or SQL-level DROP if locked)
 * 2. Re-creates the schema via migrations (auto-seeds departments, asset types, root admin)
 * 3. Seeds the 5 test users
 * 4. Generates 25 random hardware assets
 *
 * Run: node scripts/resetDb.js
 *   or: npm run reset:db
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

// Load .env from project root
config({ path: resolve(__dirname, '../.env') });

const DB_PATH = resolve(process.env.DB_PATH || './database.sqlite');

// ── Safety guard ────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  console.error('\n❌  Refusing to reset database in production!');
  console.error('    Set NODE_ENV=development or omit it to run this script.\n');
  process.exit(1);
}

// ── Live-server guard: never reset a database a server is serving ──
// Shared implementation (server/utils/liveApiGuard.js) used by every
// DB-writing/destructive script — image-validated, RESET_DB_ALLOW_LIVE=1
// opt-out, fail-open if the probe itself fails. The doctor gate checks
// :3000 before offering reset:db; this guard protects every other path.
{
  const { refuseIfDevApiLive } = await import('../server/utils/liveApiGuard.js');
  const verdict = await refuseIfDevApiLive('resetDb');
  if (verdict.refused) process.exit(1);
}

// ── Step 1: Wipe database ─────────────────────────────────────
// Called with NO open handle on our side (main closes the connection
// manager first) — the only lock to race is another process's.
//
// Grace window for the Windows file-lock race: a just-stopped server holds
// the DB handle a few seconds after its port frees (graceful shutdown
// unbinds, then drains HTTP and runs wal_checkpoint(TRUNCATE) before the
// handle releases — observed ~8s total). Lock-flavored delete failures
// retry every 500 ms until RESET_DB_LOCK_GRACE_MS expires (default 12s;
// overridable for tests); only then does the SQL fallback engage.
const LOCK_GRACE_MS = parseInt(process.env.RESET_DB_LOCK_GRACE_MS, 10) || 12_000;
const isLockErr = (err) => err && ['EPERM', 'EBUSY', 'EACCES', 'EDEADLK'].includes(err.code);

async function wipeDatabase() {
  const extensions = ['', '-wal', '-shm'];

  // Attempt 1 — file deletion with a grace window (works when no other
  // process holds the file, or releases it within LOCK_GRACE_MS). The
  // main-DB failure flag only tracks main-DB files; an archive file that
  // happens to be locked is reported but doesn't force the SQL-wipe branch.
  // The hard-move archive DB (v2) lives next to the main DB and preserves
  // conversation ids across moves — a stale archive from a previous DB
  // generation would collide (UNIQUE) with the freshly reseeded ids, so it
  // must die with the main DB.
  const archivePath = DB_PATH.replace(/\.sqlite(-wal)?$/i, '') + '-conversations-archive.sqlite';
  const archiveFiles = [archivePath, archivePath + '-wal', archivePath + '-shm'];
  const pending = new Set(
    [...extensions.map((e) => DB_PATH + e), ...archiveFiles].filter((fp) => existsSync(fp))
  );
  const deadline = Date.now() + LOCK_GRACE_MS;
  while (pending.size && Date.now() < deadline) {
    for (const fp of [...pending]) {
      try {
        unlinkSync(fp);
        pending.delete(fp);
        console.log(`  🗑  Deleted ${fp}`);
      } catch (err) {
        if (!isLockErr(err) || Date.now() >= deadline) {
          pending.delete(fp);
          console.log(`  ⚠  Could not delete ${fp} (${err?.code || 'error'})`);
        }                                        // lock-flavored: retry next pass
      }
    }
    if (pending.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
  }
  for (const fp of pending) console.log(`  ⚠  Still locked after grace: ${fp}`);

  const mainCleared = extensions.every((e) => !existsSync(DB_PATH + e));
  if (mainCleared) {
    console.log('  ✅ Database files removed (including conversation archive).');
    return;
  }

  // Attempt 2 — SQL-level wipe (file still locked after the grace window).
  // Two rules that the old hardcoded ALL_TABLES broke:
  //   • Tables are enumerated DYNAMICALLY from sqlite_master — a stale
  //     static list (it predated the conversations family: conversations,
  //     conversation_messages/participants/reads, message_attachments,
  //     message_reactions, …) left child rows behind.
  //   • foreign_keys must be OFF for the sweep: connectionManager boots
  //     every connection with foreign_keys=ON, and dropping a parent while
  //     child rows remain fails with "FOREIGN KEY constraint failed". The
  //     pragma is connection-scoped; this wipe connection is dedicated and
  //     closed below — the reseed's fresh connection is unaffected.
  console.log('  ⚠  Files locked — falling back to SQL-level reset...');
  const db = await connectionManager.connect();
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map((r) => r.name);
    if (!tables.length) {
      console.log('  ✅ No tables to drop (fresh or empty database).');
      return;
    }
    // Child-first order via repeated passes (children hold FKs to parents;
    // dropping parents last keeps the log readable). A cycle just falls
    // through — with FK OFF the order cannot fail, it is hygiene.
    const fkRefs = (t) => db.pragma(`foreign_key_list("${t.replace(/"/g, '""')}")`).map((f) => f.table);
    const remaining = new Set(tables);
    const order = [];
    while (remaining.size) {
      let progressed = false;
      for (const t of [...remaining]) {
        if (!fkRefs(t).some((p) => remaining.has(p))) { order.push(t); remaining.delete(t); progressed = true; }
      }
      if (!progressed) { order.push(...remaining); remaining.clear(); }
    }
    for (const t of order) db.exec(`DROP TABLE IF EXISTS "${t.replace(/"/g, '""')}"`);
    db.exec('PRAGMA foreign_keys = ON');
    console.log(`  ✅ All ${order.length} tables dropped (dynamic schema, FK-safe order).`);
  } finally {
    await connectionManager.close();
  }

  // Partial-deletion edge: if some main-side files were deleted but others
  // stayed locked, try them once more now — the fallback's close/checkpoint
  // cycle sometimes frees the last handle. Leftovers are logged, never
  // fatal (SQLite discards a stale -wal whose salt/checksums don't match
  // the fresh main file; the reseed below proceeds either way).
  for (const fp of [...extensions.map((e) => DB_PATH + e)].filter((p) => existsSync(p))) {
    try {
      unlinkSync(fp);
      console.log(`  🗑  Deleted leftover ${fp}`);
    } catch (err) {
      console.log(`  ⚠  Leftover ${fp} still locked (${err?.code || 'error'}) — proceeding (SQLite discards a mismatched WAL)`);
    }
  }
}

// ── Step 2: Run migrations (creates schema + auto-seeds) ──────
async function runSchemaMigrations(db) {
  await runMigrations(db);
  console.log('  ✅ Migrations applied (schema + auto-seed).');
}

// ── Step 3: Seed test users ────────────────────────────────────
const testUsers = [
  { name: 'admin',  email: 'admin@studio.com',  role: 'IT Admin', pass: 'admin'     },
  { name: 'admin1', email: 'admin1@studio.com', role: 'IT Admin', pass: '12345678' },
  { name: 'admin2', email: 'admin2@studio.com', role: 'IT Admin', pass: '12345678' },
  { name: 'staff1', email: 'staff1@studio.com', role: 'Staff',    pass: '12345678' },  { name: 'staff2',  email: 'staff2@studio.com',  role: 'Staff',    pass: '12345678' },
  // Read-Only MUST be here too: `seedTestUsers.js` has always seeded six
  // accounts, but this list drifted back to five — so a `reset:db` silently
  // deleted the Read-Only account and testAllApi's entire Read-Only phase
  // (23 assertions) failed with 401. The reseed must reproduce everything
  // the QA gate logs in with, not a subset of it.
  { name: 'readonly', email: 'readonly1@studio.com', role: 'Read-Only', pass: 'readonly1234' },
];

async function seedUsers(db) {
  let created = 0;
  for (const user of testUsers) {
    try {
      const hash = await bcrypt.hash(user.pass, 10);
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
    }
  }
  return created;
}

// ── Step 4: Generate bulk assets ───────────────────────────────
async function generateAssets(db) {
  const types = ['Workstation', 'Camera', 'Monitor', 'Tablet', 'Lens', 'Lighting'];
  for (const type of types) {
    await db.run('INSERT OR IGNORE INTO asset_types (name) VALUES (?)', [type]);
  }

  const users = await db.all('SELECT id, dept_id FROM users');
  const depts = await db.all('SELECT id FROM departments');

  const gearPool = {
    'Workstation': ['Mac Studio M2 Ultra', 'HP Z8 Fury', 'Threadripper PRO 5995WX', 'Dell Precision 7920'],
    'Camera':      ['ARRI Alexa Mini LF', 'RED V-Raptor 8K', 'Sony FX9', 'Blackmagic URSA Mini'],
    'Monitor':     ['Sony BVM-HX310', 'EIZO ColorEdge CG319X', 'Apple Pro Display XDR', 'LG OLED C3'],
    'Tablet':      ['Wacom Cintiq Pro 24', 'Wacom Intuos Pro', 'iPad Pro 12.9', 'Huion Kamvas Pro'],
    'Lens':        ['Zeiss Master Prime 35mm', 'Cooke S4/i 50mm', 'Angenieux Optimo 24-290mm', 'Sigma Cine 18-35mm'],
    'Lighting':    ['ARRI SkyPanel S60-C', 'Aputure LS 1200d', 'Astera Titan Tube', 'LiteMat Plus 4'],
  };

  let count = 0;
  for (let i = 0; i < 25; i++) {
    const type  = types[Math.floor(Math.random() * types.length)];
    const model = gearPool[type][Math.floor(Math.random() * gearPool[type].length)];
    const id    = `${type.substring(0, 3).toUpperCase()}-${Math.floor(Math.random() * 9000) + 1000}`;
    const serial = `SN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const isDeployed = Math.random() > 0.4;
    let assignedUser = null;
    let deptId = null;
    let status = 'In Storage';

    if (isDeployed && users.length > 0) {
      assignedUser = users[Math.floor(Math.random() * users.length)];
      deptId = assignedUser.dept_id;
      status = 'Deployed';
    } else if (depts.length > 0 && Math.random() > 0.5) {
      deptId = depts[Math.floor(Math.random() * depts.length)].id;
    }

    try {
      await db.run(
        `INSERT INTO assets (id, type, model, serial_number, status, dept_id, assigned_to_user_id, image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, type, model, serial, status, deptId, assignedUser ? assignedUser.id : null, '/uploads/dummy-seed.png']
      );
      count++;
    } catch {
      // Ignore duplicates
    }
  }
  return count;
}

// 1x1 transparent PNG used as the placeholder image for every seeded asset.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwmvZQAAAABJRU5ErkJggg==',
  'base64'
);

function ensurePlaceholderImage() {
  const uploadsDir = resolve(dirname(DB_PATH), 'uploads');
  try {
    mkdirSync(uploadsDir, { recursive: true });
    writeFileSync(resolve(uploadsDir, 'dummy-seed.png'), PLACEHOLDER_PNG);
    console.log('  🖼  Placeholder asset image ensured at uploads/dummy-seed.png');
  } catch {
    console.log('  ⚠  Could not write uploads/dummy-seed.png (uploads dir unavailable)');
  }
}

// ── Main ───────────────────────────────────────────────────────
async function resetDatabase() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  DATABASE RESET & FULL RESEED');
  console.log('═══════════════════════════════════════════════════\n');

  console.log(`📂 Database path: ${DB_PATH}\n`);

  // Step 0 — Close any existing connection manager: OUR OWN handle must not
  // hold the file while the wipe tries to delete it (on Windows an open
  // handle without FILE_SHARE_DELETE turns the delete into a lock failure).
  try { await connectionManager.close(); } catch { /* not open yet */ }

  // Step 1 — Wipe the database (no handle of ours is open)
  console.log('Step 1: Wiping database...');
  await wipeDatabase();

  console.log('\nStep 2: Running migrations on fresh schema...');
  const freshDb = await connectionManager.connect();
  await runSchemaMigrations(freshDb);

  // Step 3 — Seed test users
  console.log('\nStep 3: Seeding test users...');
  const userCount = await seedUsers(freshDb);

  // Step 4 — Generate bulk assets
  console.log('\nStep 4: Generating bulk assets...');
  ensurePlaceholderImage();
  const assetCount = await generateAssets(freshDb);

  // Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  RESET COMPLETE');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Users  : ${userCount}`);
  console.log(`  Assets : ${assetCount}`);
  console.log('\n  Test Accounts:');
  console.log('  ┌──────────┬──────────────────────────────┬────────────┬──────────┐');
  console.log('  │ Role     │ Email                        │ Password   │ User     │');
  console.log('  ├──────────┼──────────────────────────────┼────────────┼──────────┤');
  for (const u of testUsers) {
    console.log(`  │ ${u.role.padEnd(8)} │ ${u.email.padEnd(28)} │ ${u.pass.padEnd(10)} │ ${u.name.padEnd(8)} │`);
  }
  console.log('  └──────────┴──────────────────────────────┴────────────┴──────────┘');
  console.log('');

  await connectionManager.close();
  console.log('Database connection closed. Ready for testing!\n');
}

resetDatabase().catch((err) => {
  console.error('❌ Reset failed:', err);
  process.exit(1);
});
