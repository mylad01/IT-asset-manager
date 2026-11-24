// scripts/seedAccessTestUsers.js
// Dev-only test accounts for the User Access page. Live-API-guard + seed
// THROUGH the running dev server's /api/users (admin only), so we never
// race the server's WAL handle. Never runs in `npm run reset:db` (that
// uses the in-process resetDb).
//
// Usage: node scripts/seedAccessTestUsers.js
import { config } from 'dotenv'; config();
import { refuseIfDevApiLive } from '../server/utils/liveApiGuard.js';

// ── Safety guard (same as reset:db / seed:*) ──
// Creates named test accounts with well-known passwords — never into a
// production deployment (production users come from the setup wizard).
if (process.env.NODE_ENV === 'production') {
  console.error('\n❌  Refusing to seed test accounts in production!');
  console.error('    Set NODE_ENV=development or omit it to run this script.\n');
  process.exit(1);
}

// Dev-only test accounts for the User Access page.
const ACCOUNTS = [
  { name: 'AccessProbe', email: 'accessprobe@studio.com', role: 'Staff', password: 'AccessProbe123!' },
  { name: 'AccessManager', email: 'accessmanager@studio.com', role: 'IT Admin', password: 'AccessMgr123!' },
  { name: 'AccessReadOnly', email: 'accessreadonly@studio.com', role: 'Read-Only', password: 'AccessRO123!' },
];

main().catch((err) => { console.error('seedAccessTestUsers failed:', err); process.exit(1); });

async function main() {
  const verdict = await refuseIfDevApiLive('seedAccessTestUsers');
  if (verdict.refused) {
    console.error('[seedAccessTestUsers] ❌ Refused: a dev API/ghost holder is on :3000.');
    process.exit(1);
  }

  const API = 'http://localhost:3000';

  // Resolve root admin's token (the caller who will create these).
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@studio.com', password: 'admin' }),
  });
  if (!loginRes.ok) {
    console.error('[seedAccessTestUsers] ❌ root admin login failed');
    process.exit(1);
  }
  const loginBody = await loginRes.json();
  const token = loginBody.token || loginBody.data?.token;

  for (const acc of ACCOUNTS) {
    // Check if already exists.
    const listRes = await fetch(`${API}/api/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const users = listRes.ok ? await listRes.json() : [];
    const exists = Array.isArray(users) && users.some((u) => u.email === acc.email);
    if (exists) {
      console.log(`[seedAccessTestUsers] ${acc.email} already present — skipping`);
      continue;
    }

    const createRes = await fetch(`${API}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: acc.name,
        email: acc.email,
        role: acc.role,
        password: acc.password,
        dept_id: null,
      }),
    });
    if (createRes.ok) {
      console.log(`[seedAccessTestUsers] created ${acc.name} <${acc.email}> (role=${acc.role})`);
    } else {
      console.error(`[seedAccessTestUsers] failed to create ${acc.email}: ${createRes.status}`);
    }
  }

  console.log('[seedAccessTestUsers] done.');
}
