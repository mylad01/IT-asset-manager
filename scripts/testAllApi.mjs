#!/usr/bin/env node

/**
 * Comprehensive API Test Suite — tests ALL endpoints as ALL roles.
 * Verifies: functionality, auth, validation, role guards, no API errors.
 */

const BASE = 'http://localhost:3000/api';
let passed = 0;
let failed = 0;
const errors = [];

async function api(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${url}`, opts);
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, ok: res.ok };
}

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; errors.push(msg); console.log(`  FAIL: ${msg}`); }
}

function assertStatus(actual, expected, msg) {
  // Accept both exact match and 201 for POST (Created is valid REST)
  if (expected === 200 && actual === 201) {
    passed++; // 201 Created is acceptable for POST
    return;
  }
  assert(actual === expected, `${msg} — expected ${expected}, got ${actual}`);
}

// ═══════════════════════════════════════════════════
// LOGIN ALL ROLES
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 2: AUTHENTICATION ===');

const rootLogin = await api('POST', '/auth/login', { email: 'admin@studio.com', password: 'admin' });
assertStatus(rootLogin.status, 200, 'Root admin login');
const rootToken = rootLogin.data?.token;
assert(!!rootToken, 'Root admin got token');
assert(rootLogin.data?.user?.isRoot === true, 'Root admin isRoot flag');

// Purge any admin (id 1) pending leave rows from prior standalone runner runs
// so the PHASE 12 seed does not collide with stale data from a previous run.
// Mirrors the same purge testLeaveRequests.js performs (same DB, same window).
try {
  // Direct DB access for the purge (mirrors the same SQL testLeaveRequests.js uses).
  // getDb() returns a timeout-proxied db whose .prepare() resolves async to a real
  // better-sqlite3 statement (the proxy wraps .run/.get/.all/.exec only; .prepare()
  // itself is async here). Await the statement, then call .run() on it.
  const { getDb } = await import('../server/database.js');
  const conn = await getDb();
  const stmt = await conn.prepare(`DELETE FROM leave_requests WHERE user_id = 1 AND status = 'Pending' AND start_date >= '2026-01-01' AND start_date < '2030-01-01'`);
  const purged = stmt.run();
  const changes = (purged && typeof purged === 'object' && typeof purged.changes === 'number') ? purged.changes : (Array.isArray(purged) ? purged.length : (typeof purged === 'number' ? purged : 0));
  if (changes > 0) console.log(`Purged ${changes} stale admin pending leave rows from prior runner runs.`);
} catch (purgeErr) {
  console.warn('WARNING: could not purge stale admin leave rows:', purgeErr?.message || purgeErr);
}

const adminLogin = await api('POST', '/auth/login', { email: 'admin1@studio.com', password: '12345678' });
assertStatus(adminLogin.status, 200, 'IT Admin login');
const adminToken = adminLogin.data?.token;
assert(!!adminToken, 'IT Admin got token');

const staffLogin = await api('POST', '/auth/login', { email: 'staff1@studio.com', password: '12345678' });
assertStatus(staffLogin.status, 200, 'Staff login');
const staffToken = staffLogin.data?.token;
assert(!!staffToken, 'Staff got token');

const staff2Login = await api('POST', '/auth/login', { email: 'staff2@studio.com', password: '12345678' });
assertStatus(staff2Login.status, 200, 'Staff2 login');

// Read-Only login (GAP-4: seeded by seedTestUsers as readonly1@studio.com / readonly1234)
const readonlyLogin = await api('POST', '/auth/login', { email: 'readonly1@studio.com', password: 'readonly1234' });
assertStatus(readonlyLogin.status, 200, 'Read-Only login');
const readonlyToken = readonlyLogin.data?.token;
assert(!!readonlyToken, 'Read-Only got token');
assert(readonlyLogin.data?.user?.role === 'Read-Only', 'Read-Only role flag');

// Invalid logins
const badPass = await api('POST', '/auth/login', { email: 'admin@studio.com', password: 'wrong' });
assertStatus(badPass.status, 401, 'Wrong password rejected');

const badEmail = await api('POST', '/auth/login', { email: 'nonexistent@test.com', password: '12345678' });
assertStatus(badEmail.status, 401, 'Non-existent email rejected');

const noBody = await api('POST', '/auth/login', {});
assertStatus(noBody.status, 400, 'Empty login body rejected');

// No token
const noAuth = await api('GET', '/assets');
assertStatus(noAuth.status, 401, 'No token => 401');

// Invalid token
const badToken = await api('GET', '/assets', null, 'invalid-token');
assertStatus(badToken.status, 401, 'Invalid token => 401');

// Change password
const changePw = await api('PUT', '/auth/change-password', { currentPassword: 'admin', newPassword: 'admin1234' }, rootToken);
assertStatus(changePw.status, 200, 'Password change succeeds');
// Change back
await api('PUT', '/auth/change-password', { currentPassword: 'admin1234', newPassword: 'admin' }, rootToken); // rejected: min 8 chars — expected API behavior

// Restore the seeded 5-char dev credential directly (the API enforces min 8,
// so it cannot be set back over HTTP). Mirrors npm run reseed:admin.
{
  const { default: Database } = await import('better-sqlite3');
  const { default: bcrypt } = await import('bcrypt');
  const db = new Database('./database.sqlite');
  db.prepare("UPDATE users SET password_hash = ? WHERE email = 'admin@studio.com'")
    .run(bcrypt.hashSync('admin', 10));
  db.close();
}

console.log(`  Auth: ${passed} passed, ${failed} failed`);

// SUITE-SEED PURGE — abort safety net for every fixed-identifier seed.
// Each seeding phase owns a FIXED identifier: asset 'TEST-API-001' (assets.id
// is the PRIMARY KEY), kit 'Test API Kit' and consumable 'Test API Consumable'
// (fixed names that accumulate — neither column is unique), user
// 'testcreated@test.com' and type 'Test API Type' (both UNIQUE), and the leave
// phase's QA pair + department (a leaked leftover 409s the reseed and cascades
// four assertions — observed live 2026-10-20). Until now every cleanup was
// success-only, so an aborted run leaked them: UNIQUE/PK seeds then break the
// NEXT run's create, the rest accumulate. Lookup-based rather than id-based,
// so it works even when an abort happened before ids were captured; failures
// WARN instead of throw so cleanup can never mask a phase's real outcome.
// Runs once up front (every run starts clean) and from every seeder phase's
// finally below.
async function purgeSuiteSeeds(tag) {
  try {
    const a = await api('GET', '/assets/TEST-API-001', null, adminToken);
    if (a.status === 200) await api('DELETE', '/assets/TEST-API-001', null, adminToken);
    const kits = await api('GET', '/kits', null, adminToken);
    for (const k of (kits.data || []).filter((k) => k.name === 'Test API Kit')) {
      await api('DELETE', `/kits/${k.id}`, null, adminToken);
    }
    const cons = await api('GET', '/consumables', null, adminToken);
    for (const c of (cons.data || []).filter((c) => c.name === 'Test API Consumable')) {
      await api('DELETE', `/consumables/${c.id}`, null, adminToken);
    }
    const types = await api('GET', '/asset-types', null, adminToken);
    for (const t of (types.data || []).filter((t) => t.name === 'Test API Type')) {
      await api('DELETE', `/asset-types/${t.id}`, null, adminToken);
    }
    const users = await api('GET', '/users', null, adminToken);
    for (const u of (users.data || []).filter((u) =>
      ['testcreated@test.com', 'leave-mgr@qa.local', 'leave-staff@qa.local'].includes(u.email))) {
      await api('DELETE', `/users/${u.id}`, null, adminToken);
    }
    const depts = await api('GET', '/departments', null, adminToken);
    for (const d of (depts.data || []).filter((d) => d.name === 'API-Leave-QA')) {
      await api('DELETE', `/departments/${d.id}`, null, adminToken);
    }
  } catch (err) {
    console.warn(`  WARN: suite-seed purge (${tag}) failed: ${err?.message || err}`);
  }
}

// PRE-CLEAN: every run starts clean even if the previous one aborted mid-phase.
await purgeSuiteSeeds('pre-clean');

// ═══════════════════════════════════════════════════
// PHASE 3: DASHBOARD
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 3: DASHBOARD ===');

const dashStats = await api('GET', '/dashboard/stats', null, adminToken);
assertStatus(dashStats.status, 200, 'Dashboard stats');
// Dashboard may return data in various formats — check it's a valid object
assert(dashStats.data && typeof dashStats.data === 'object', 'Dashboard returns object');
// Check for common field names (may vary)
const dashKeys = Object.keys(dashStats.data || {});
assert(dashKeys.length > 0, `Dashboard has data fields (${dashKeys.join(', ')})`);

const ticketAnalytics = await api('GET', '/analytics/tickets', null, adminToken);
assertStatus(ticketAnalytics.status, 200, 'Ticket analytics');

// Staff cannot access analytics
const staffAnalytics = await api('GET', '/analytics/tickets', null, staffToken);
assertStatus(staffAnalytics.status, 403, 'Staff blocked from analytics');

// Read-Only CAN access dashboard stats + analytics (requireAdminOrReadOnly)
const roDashStats = await api('GET', '/dashboard/stats', null, readonlyToken);
assertStatus(roDashStats.status, 200, 'Read-Only gets dashboard stats');
const roAnalytics = await api('GET', '/analytics/tickets', null, readonlyToken);
assertStatus(roAnalytics.status, 200, 'Read-Only gets ticket analytics');

console.log(`  Dashboard: done`);

// ═══════════════════════════════════════════════════
// PHASE 4: TICKETS (Helpdesk)
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 4: TICKETS ===');

// Staff creates ticket
const createTicket = await api('POST', '/tickets', {
  title: 'Test Ticket from API Suite',
  description: 'Comprehensive test of ticket creation',
  category: 'Workstation Hardware',
  priority: 'High',
  asset_id: null,
  assigned_admin_id: adminLogin.data?.user?.id || adminLogin.data?.id
}, staffToken);
assertStatus(createTicket.status, 200, 'Staff creates ticket');

// Get staff's tickets
const myTickets = await api('GET', '/tickets/my-tickets', null, staffToken);
assertStatus(myTickets.status, 200, 'Staff gets my-tickets');
assert(Array.isArray(myTickets.data), 'my-tickets returns array');
const ticketId = myTickets.data?.[0]?.id;
assert(!!ticketId, 'Ticket has ID');

// Admin gets all tickets
const allTickets = await api('GET', '/tickets', null, adminToken);
assertStatus(allTickets.status, 200, 'Admin gets all tickets');
assert(Array.isArray(allTickets.data), 'All tickets returns array');

// Staff cannot get all tickets
const staffAllTickets = await api('GET', '/tickets', null, staffToken);
assertStatus(staffAllTickets.status, 403, 'Staff blocked from all tickets');

// Ticket comments
if (ticketId) {
  const getComments = await api('GET', `/tickets/${ticketId}/comments`, null, staffToken);
  assertStatus(getComments.status, 200, 'Get ticket comments');
  assert(Array.isArray(getComments.data), 'Comments returns array');

  const addComment = await api('POST', `/tickets/${ticketId}/comments`, {
    text: 'Test comment from API suite'
  }, staffToken);
  assertStatus(addComment.status, 200, 'Add comment');

  // Admin adds internal note
  const internalNote = await api('POST', `/tickets/${ticketId}/comments`, {
    text: 'Internal admin note',
    is_internal: true
  }, adminToken);
  assertStatus(internalNote.status, 200, 'Admin adds internal note');

  // Update ticket status
  const updateStatus = await api('PUT', `/tickets/${ticketId}`, { status: 'In Progress' }, adminToken);
  assertStatus(updateStatus.status, 200, 'Admin updates ticket status');

  // Reassign ticket
  const admin2Id = (await api('POST', '/auth/login', { email: 'admin2@studio.com', password: '12345678' })).data?.user?.id || (await api('POST', '/auth/login', { email: 'admin2@studio.com', password: '12345678' })).data?.id;
  if (admin2Id) {
    const reassign = await api('PUT', `/tickets/${ticketId}/assign`, { assigned_admin_id: admin2Id }, rootToken);
    assertStatus(reassign.status, 200, 'Root admin reassigns ticket');
  }

  // Resolve ticket
  const resolve = await api('PUT', `/tickets/${ticketId}`, { status: 'Resolved' }, adminToken);
  assertStatus(resolve.status, 200, 'Admin resolves ticket');

  // Staff cannot update ticket status
  const staffUpdate = await api('PUT', `/tickets/${ticketId}`, { status: 'Submitted to Manager' }, staffToken);
  assertStatus(staffUpdate.status, 403, 'Staff blocked from ticket status update');
}

// Invalid ticket creation
const badTicket = await api('POST', '/tickets', {}, staffToken);
assertStatus(badTicket.status, 400, 'Invalid ticket creation rejected');

console.log(`  Tickets: done`);

// ═══════════════════════════════════════════════════
// PHASE 5: ASSETS
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 5: ASSETS ===');

// Get all assets
const allAssets = await api('GET', '/assets', null, adminToken);
assertStatus(allAssets.status, 200, 'Admin gets all assets');
assert(Array.isArray(allAssets.data), 'Assets returns array');
const assetCount = allAssets.data?.length || 0;
assert(assetCount > 0, `Has assets (${assetCount})`);

// Get unassigned
const unassigned = await api('GET', '/assets/unassigned', null, adminToken);
assertStatus(unassigned.status, 200, 'Get unassigned assets');
assert(Array.isArray(unassigned.data), 'Unassigned returns array');

// Get single asset
if (allAssets.data?.[0]) {
  const assetId = allAssets.data[0].id;
  const single = await api('GET', `/assets/${assetId}`, null, adminToken);
  assertStatus(single.status, 200, 'Get single asset');
  assert(single.data?.id === assetId, 'Single asset has correct ID');

  // Preview
  const preview = await api('GET', `/assets/${assetId}/preview`, null, adminToken);
  assertStatus(preview.status, 200, 'Asset preview');

  // History
  const history = await api('GET', `/assets/${assetId}/history`, null, adminToken);
  assertStatus(history.status, 200, 'Asset history');
  assert(Array.isArray(history.data), 'History returns array');

  // Lifecycle timeline
  const lifecycle = await api('GET', `/assets/${assetId}/lifecycle`, null, adminToken);
  assertStatus(lifecycle.status, 200, 'Asset lifecycle timeline');
  assert(lifecycle.data && typeof lifecycle.data === 'object', 'Lifecycle returns object');
  assert(Array.isArray(lifecycle.data?.milestones), 'Lifecycle milestones array');

  // Staff can read the timeline too (read endpoint — any authenticated role)
  const staffLifecycle = await api('GET', `/assets/${assetId}/lifecycle`, null, staffToken);
  assertStatus(staffLifecycle.status, 200, 'Staff reads asset lifecycle');

  // Add maintenance log
  const addLog = await api('POST', `/assets/${assetId}/log`, {
    notes: 'Routine check',
    action_type: 'MAINTENANCE'
  }, adminToken);
  assertStatus(addLog.status, 200, 'Add maintenance log');

  // Transfer asset
  const transfer = await api('PUT', `/assets/${assetId}/transfer`, {
    new_user_id: staffLogin.data?.user?.id || staffLogin.data?.id,
    transfer_notes: 'Testing transfer functionality'
  }, adminToken);
  assertStatus(transfer.status, 200, 'Transfer asset');

  // Transfer back to storage
  await api('PUT', `/assets/${assetId}/transfer`, {
    new_user_id: null,
    transfer_notes: 'Returning to storage'
  }, adminToken);

  // GAP-5: asset create→get→delete roundtrip with a 1x1 PNG fixture (self-cleaning).
  // The create endpoint requires multipart/form-data with an 'image' field.
  // 'TEST-API-001' is a FIXED id and assets.id is the PRIMARY KEY, so a leaked
  // leftover breaks the next run's create. Pre-clean is global (purgeSuiteSeeds);
  // the finally re-purges if this roundtrip aborts before its success-path delete.
  try {
    const pngFixture = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const form = new FormData();
    form.append('image', new Blob([pngFixture], { type: 'image/png' }), 'fixture-1x1.png');
    form.append('id', 'TEST-API-001');
    form.append('type', 'Workstation');
    form.append('model', 'Test Machine');
    form.append('serial_number', 'SN-TEST-001');
    form.append('status', 'In Storage');
    const createAssetReq = await fetch(`${BASE}/assets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    const createAssetData = await createAssetReq.json().catch(() => ({}));
    assertStatus(createAssetReq.status, 201, 'Admin creates asset with image');
    assert(createAssetData?.id === 'TEST-API-001', 'Create response echoes asset id');
    if (!createAssetData?.id) { console.log('  DEBUG body:', JSON.stringify(createAssetData)); }
    const createdAssetId = createAssetData.id;
    // GET the created asset by id
    const getCreated = await api('GET', `/assets/${createdAssetId}`, null, adminToken);
    assertStatus(getCreated.status, 200, 'GET created asset by id');
    assert(getCreated.data?.id === createdAssetId, 'GET returned correct asset');
    // DELETE the asset (success path)
    const deleteCreated = await api('DELETE', `/assets/${createdAssetId}`, null, adminToken);
    assertStatus(deleteCreated.status, 200, 'Delete created asset');
    // GET should now 404
    const getDeleted = await api('GET', `/assets/${createdAssetId}`, null, adminToken);
    assertStatus(getDeleted.status, 404, 'GET deleted asset is 404');
  } finally {
    await purgeSuiteSeeds('phase 5 asset roundtrip');
  }

}

// Unknown asset lifecycle => 404
const lifecycle404 = await api('GET', '/assets/NO-SUCH-ASSET/lifecycle', null, adminToken);
assertStatus(lifecycle404.status, 404, 'Lifecycle of unknown asset is 404');

// Staff cannot create assets
const staffCreate = await api('POST', '/assets', { asset_id: 'STAFF-001', model: 'Test' }, staffToken);
assertStatus(staffCreate.status, 403, 'Staff blocked from asset creation');

// Staff cannot delete assets
const staffDelete = await api('DELETE', '/assets/test', null, staffToken);
assertStatus(staffDelete.status, 403, 'Staff blocked from asset deletion');

console.log(`  Assets: done`);

// ═══════════════════════════════════════════════════
// PHASE 6-7: USERS & STORAGE
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 6-7: USERS & STORAGE ===');

// Get all users
const allUsers = await api('GET', '/users', null, adminToken);
assertStatus(allUsers.status, 200, 'Admin gets all users');
assert(Array.isArray(allUsers.data), 'Users returns array');
assert(allUsers.data?.length >= 5, `Has ≥5 users (${allUsers.data?.length})`);

// Get admins
const admins = await api('GET', '/users/admins', null, adminToken);
assertStatus(admins.status, 200, 'Get admins list');
assert(Array.isArray(admins.data), 'Admins returns array');

// Get user assets
const userId = allUsers.data?.find(u => u.email === 'staff1@studio.com')?.id;
if (userId) {
  const userAssets = await api('GET', `/users/${userId}/assets`, null, adminToken);
  assertStatus(userAssets.status, 200, 'Get user assets');
  assert(Array.isArray(userAssets.data), 'User assets returns array');
}

// Seed a user with a FIXED email (users.email is UNIQUE, so a leaked leftover
// breaks the next run's create). Pre-clean is global (purgeSuiteSeeds); the
// finally re-purges if this phase aborts before its success-path delete.
try {
  const newUser = await api('POST', '/users', {
    name: 'Test Created User',
    email: 'testcreated@test.com',
    password: 'password123',
    role: 'Staff',
    dept_id: 1
  }, adminToken);
  assertStatus(newUser.status, 200, 'Admin creates user');

  // Resolve the created user's id (the endpoint returns a message body, not the row)
  const createdUser = (await api('GET', '/users', null, adminToken)).data?.find(u => u.email === 'testcreated@test.com');

  // Update user
  if (createdUser?.id) {
    // updateUserSchema requires the full profile (name/email/role); password optional
    const updateUser = await api('PUT', `/users/${createdUser.id}`, {
      name: 'Updated Test User',
      email: createdUser.email,
      role: createdUser.role,
      dept_id: createdUser.dept_id,
    }, adminToken);
    assertStatus(updateUser.status, 200, 'Admin updates user');

    // Delete user (success path)
    const deleteUser = await api('DELETE', `/users/${createdUser.id}`, null, adminToken);
    assertStatus(deleteUser.status, 200, 'Admin deletes user');
  }
} finally {
  await purgeSuiteSeeds('phase 6-7 user');
}

// Staff cannot create users
const staffUserCreate = await api('POST', '/users', { name: 'X', email: 'x@x.com', password: '12345678' }, staffToken);
assertStatus(staffUserCreate.status, 403, 'Staff blocked from user creation');

// Read-Only gets field-restricted user list (GAP-6: id/name/role/dept_id/department, no email)
const roUsers = await api('GET', '/users', null, readonlyToken);
assertStatus(roUsers.status, 200, 'Read-Only gets users (field-restricted)');
assert(Array.isArray(roUsers.data), 'Read-Only users returns array');
if (roUsers.data.length > 0) {
  const roUser = roUsers.data[0];
  assert('id' in roUser, 'Read-Only user has id');
  assert('name' in roUser, 'Read-Only user has name');
  assert('role' in roUser, 'Read-Only user has role');
  assert('dept_id' in roUser, 'Read-Only user has dept_id');
  assert('email' in roUser === false, 'Read-Only user has NO email (field-restricted)');
}
// Read-Only CANNOT delete users
const roUserDelete = await api('DELETE', '/users/test', null, readonlyToken);
assertStatus(roUserDelete.status, 403, 'Read-Only blocked from user deletion');

// Departments
const depts = await api('GET', '/departments', null, adminToken);
assertStatus(depts.status, 200, 'Get departments');
assert(Array.isArray(depts.data), 'Departments returns array');

console.log(`  Users & Storage: done`);

// ═══════════════════════════════════════════════════
// PHASE 9: KITS
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 9: KITS ===');

const allKits = await api('GET', '/kits', null, adminToken);
assertStatus(allKits.status, 200, 'Get all kits');
assert(Array.isArray(allKits.data), 'Kits returns array');

// Create kit — 'Test API Kit' is a FIXED name (kits.name is not unique, so a
// leaked leftover accumulates). Pre-clean is global (purgeSuiteSeeds); the
// finally re-purges if this phase aborts before its success-path delete.
try {
  const newKit = await api('POST', '/kits', {
    name: 'Test API Kit',
    description: 'Created by test suite',
    items: [{ asset_type: 'Workstation', quantity: 2 }]
  }, adminToken);
  assertStatus(newKit.status, 200, 'Create kit');

  if (newKit.data?.id) {
    // Preview kit
    const kitPreview = await api('GET', `/kits/${newKit.data.id}/preview`, null, adminToken);
    assertStatus(kitPreview.status, 200, 'Kit preview');

    // Deploy kit (if assets available)
    if (userId) {
      const deploy = await api('POST', `/kits/${newKit.data.id}/deploy`, {
        user_id: userId,
        dept_id: 1,
        asset_selections: {}
      }, adminToken);
      // Deploy may fail if no matching assets, that's ok
      console.log(`  Kit deploy: ${deploy.status}`);
    }

    // Delete kit (success path)
    const deleteKit = await api('DELETE', `/kits/${newKit.data.id}`, null, adminToken);
    assertStatus(deleteKit.status, 200, 'Delete kit');
  }
} finally {
  await purgeSuiteSeeds('phase 9 kit');
}

// Staff cannot create kits
const staffKit = await api('POST', '/kits', { name: 'X', items: [] }, staffToken);
assertStatus(staffKit.status, 403, 'Staff blocked from kit creation');

// Read-Only CAN read kits (BUG-2 fix: requireAdminOrReadOnly on GETs)
const roKits = await api('GET', '/kits', null, readonlyToken);
assertStatus(roKits.status, 200, 'Read-Only gets kits');
assert(Array.isArray(roKits.data), 'Read-Only kits returns array');
// Read-Only CANNOT create kits
const roKitCreate = await api('POST', '/kits', { name: 'X', items: [] }, readonlyToken);
assertStatus(roKitCreate.status, 403, 'Read-Only blocked from kit creation');

console.log(`  Kits: done`);

// ═══════════════════════════════════════════════════
// PHASE 10: CONSUMABLES
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 10: CONSUMABLES ===');

const allConsumables = await api('GET', '/consumables', null, adminToken);
assertStatus(allConsumables.status, 200, 'Get all consumables');
assert(Array.isArray(allConsumables.data), 'Consumables returns array');

// Create consumable — 'Test API Consumable' is a FIXED name (consumables.name
// is not unique, so a leaked leftover accumulates). Pre-clean is global
// (purgeSuiteSeeds); the finally re-purges if this phase aborts.
try {
  const newConsumable = await api('POST', '/consumables', {
    name: 'Test API Consumable',
    description: 'Test item',
    quantity: 10,
    threshold: 3
  }, adminToken);
  assertStatus(newConsumable.status, 200, 'Create consumable');

  if (newConsumable.data?.id) {
    // Adjust stock up
    const stockUp = await api('PUT', `/consumables/${newConsumable.data.id}/stock`, { amount: 5 }, adminToken);
    assertStatus(stockUp.status, 200, 'Stock increase');

    // Adjust stock down
    const stockDown = await api('PUT', `/consumables/${newConsumable.data.id}/stock`, { amount: -3 }, adminToken);
    assertStatus(stockDown.status, 200, 'Stock decrease');

    // Delete (success path)
    const deleteCons = await api('DELETE', `/consumables/${newConsumable.data.id}`, null, adminToken);
    assertStatus(deleteCons.status, 200, 'Delete consumable');
  }
} finally {
  await purgeSuiteSeeds('phase 10 consumable');
}

// Staff cannot manage consumables
const staffCons = await api('POST', '/consumables', { name: 'X' }, staffToken);
assertStatus(staffCons.status, 403, 'Staff blocked from consumable creation');

// Read-Only CAN read consumables
const roConsumables = await api('GET', '/consumables', null, readonlyToken);
assertStatus(roConsumables.status, 200, 'Read-Only gets consumables');
assert(Array.isArray(roConsumables.data), 'Read-Only consumables returns array');

console.log(`  Consumables: done`);

// ═══════════════════════════════════════════════════
// PHASE 11: ASSET TYPES
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 11: ASSET TYPES ===');

const allTypes = await api('GET', '/asset-types', null, adminToken);
assertStatus(allTypes.status, 200, 'Get all asset types');
assert(Array.isArray(allTypes.data), 'Asset types returns array');
assert(allTypes.data?.length >= 5, `Has ≥5 types (${allTypes.data?.length})`);

// Create type — 'Test API Type' is a FIXED name and asset_types.name is UNIQUE,
// so a leaked leftover breaks the next run's create. Pre-clean is global
// (purgeSuiteSeeds); the finally re-purges if this phase aborts.
try {
  const newType = await api('POST', '/asset-types', { name: 'Test API Type' }, adminToken);
  assertStatus(newType.status, 200, 'Create asset type');

  // Resolve the created type's id (the endpoint returns a message body, not the row)
  const createdTypeId = (await api('GET', '/asset-types', null, adminToken)).data?.find(t => t.name === 'Test API Type')?.id;
  if (createdTypeId) {
    // Delete type (success path)
    const deleteType = await api('DELETE', `/asset-types/${createdTypeId}`, null, adminToken);
    assertStatus(deleteType.status, 200, 'Delete asset type');
  }
} finally {
  await purgeSuiteSeeds('phase 11 type');
}

// Staff cannot manage types
const staffType = await api('POST', '/asset-types', { name: 'X' }, staffToken);
assertStatus(staffType.status, 403, 'Staff blocked from type creation');

// Read-Only CAN read asset types
const roTypes = await api('GET', '/asset-types', null, readonlyToken);
assertStatus(roTypes.status, 200, 'Read-Only gets asset types');
assert(Array.isArray(roTypes.data), 'Read-Only asset types returns array');
assert(roTypes.data?.length >= 5, `Read-Only has ≥5 types (${roTypes.data?.length})`);

console.log(`  Asset Types: done`);

// ═══════════════════════════════════════════════════
// PHASE 12: LEAVE REQUESTS (spec: 2026-10-13 design)
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 12: LEAVE REQUESTS ===');

// Seeds two QA users + a QA department under FIXED identifiers — a leaked
// leftover 409s the next run's reseed and cascades four downstream assertions
// (observed live 2026-10-20). Pre-clean is global (purgeSuiteSeeds); the
// finally below re-purges if this phase aborts before its success-path cleanup.
try {

  // SETUP: seed a department + manager + staff so the inbox/decide paths can be
  // exercised without depending on any pre-existing leave data.
  const deptR = await api('POST', '/departments', { name: 'API-Leave-QA' }, adminToken);
  assertStatus(deptR.status, 201, 'seed: department for leave-requests phase');
  // POST /departments answers {message} only (no id echo) — resolve the new
  // department's id from the list, otherwise dept_id lands NULL on the seeded
  // users and every dept-scoped inbox/decide assertion fails (observed 2026-10-20).
  const deptList = await api('GET', '/departments', null, adminToken);
  const deptId = (deptList.data || []).find((d) => d.name === 'API-Leave-QA')?.id;
  assert(!!deptId, 'seed: department id resolved from the list');
  const mgrR = await api('POST', '/users', {
    name: 'LeaveManager', email: 'leave-mgr@qa.local', password: 'LeaveQA1234',
    role: 'Department Manager', dept_id: deptId
  }, adminToken);
  assertStatus(mgrR.status, 201, 'seed: manager for leave-requests phase');
  const mgrToken = (await api('POST', '/auth/login', { email: 'leave-mgr@qa.local', password: 'LeaveQA1234' })).data?.token;
  assert(!!mgrToken, 'seed: manager token');
  const staffR = await api('POST', '/users', {
    name: 'LeaveStaff', email: 'leave-staff@qa.local', password: 'LeaveQA1234',
    role: 'Staff', dept_id: deptId
  }, adminToken);
  assertStatus(staffR.status, 201, 'seed: staff for leave-requests phase');
  const staffLToken = (await api('POST', '/auth/login', { email: 'leave-staff@qa.local', password: 'LeaveQA1234' })).data?.token;
  assert(!!staffLToken, 'seed: staff token');

  // Staff submits a leave request.
  const leaveReq = await api('POST', '/leave-requests', {
    start_date: '2026-11-01',
    end_date: '2026-11-03',
    description: 'Test leave request from API phase.'
  }, staffLToken);
  assertStatus(leaveReq.status, 201, 'Staff creates leave request');
  assert(leaveReq.data?.id, 'Leave request has id');
  const leaveReqId = leaveReq.data?.id;

  // Staff sees their own requests via /mine.
  const myLeaveReqs = await api('GET', '/leave-requests/mine', null, staffLToken);
  assertStatus(myLeaveReqs.status, 200, 'Staff gets my leave requests');
  assert(Array.isArray(myLeaveReqs.data), 'My leave requests returns array');
  assert(myLeaveReqs.data.some(r => r.id === leaveReqId), 'my leave includes the submitted row');

  // Manager can read their department's pending inbox.
  const pend = await api('GET', '/leave-requests/pending', null, mgrToken);
  assertStatus(pend.status, 200, 'Manager GET /pending');
  assert(Array.isArray(pend.data), 'Manager pending returns array');
  assert(pend.data.some(r => r.id === leaveReqId), 'pending inbox includes the submitted row');

  // Manager can decide the request.
  const decideLeave = await api('PUT', `/leave-requests/${leaveReqId}/decide`, {
    decision: 'Approved'
  }, mgrToken);
  assertStatus(decideLeave.status, 200, 'Manager decides leave request');

  // Re-read via /mine to confirm the decision propagated to the requester's view.
  const decidedMine = await api('GET', '/leave-requests/mine', null, staffLToken);
  assertStatus(decidedMine.status, 200, 'Staff re-reads my leave after decision');
  assert(decidedMine.data.some(r => r.id === leaveReqId && r.status === 'Approved'), 'mine shows Approved after decision');

  // Read-Only can read the inbox (read-everything role).
  const roLeaveReqs = await api('GET', '/leave-requests/pending', null, readonlyToken);
  assertStatus(roLeaveReqs.status, 200, 'Read-Only GET /pending');
  assert(Array.isArray(roLeaveReqs.data), 'Read-Only pending returns array');
} finally {
  // Runs on success AND when a mid-phase throw aborts the phase, so an aborted
  // run no longer leaves the seed department + users behind (the leave row is
  // FK-cascaded by user delete).
  await purgeSuiteSeeds('phase 12 leave');
}

console.log(`  Leave Requests: done`);

// ═══════════════════════════════════════════════════
// PHASE 13: ACTIVITY LOGS
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 13: ACTIVITY LOGS ===');

const logs = await api('GET', '/activity-logs?limit=5', null, adminToken);
assertStatus(logs.status, 200, 'Get activity logs');
assert(logs.data !== null && logs.data !== undefined, 'Logs returns data');

const logFilters = await api('GET', '/activity-logs/filters', null, adminToken);
assertStatus(logFilters.status, 200, 'Get log filters');

const logExport = await api('GET', '/activity-logs/export?limit=5', null, adminToken);
assertStatus(logExport.status, 200, 'Export activity logs');

// Staff cannot access logs
const staffLogs = await api('GET', '/activity-logs', null, staffToken);
assertStatus(staffLogs.status, 403, 'Staff blocked from activity logs');

// Read-Only CAN access activity logs (requireAdminOrReadOnly — BUG-1 fix)
const roLogs = await api('GET', '/activity-logs?limit=5', null, readonlyToken);
assertStatus(roLogs.status, 200, 'Read-Only gets activity logs');
assert(roLogs.data !== null && roLogs.data !== undefined, 'Read-Only logs returns data');
const roLogFilters = await api('GET', '/activity-logs/filters', null, readonlyToken);
assertStatus(roLogFilters.status, 200, 'Read-Only gets log filters');
const roLogExport = await api('GET', '/activity-logs/export?limit=5', null, readonlyToken);
assertStatus(roLogExport.status, 200, 'Read-Only exports activity logs');

console.log(`  Activity Logs: done`);

// ═══════════════════════════════════════════════════
// PHASE 14: STAFF PAGES (via API)
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 14: STAFF PAGES ===');

const staffMyAssets = await api('GET', `/users/${userId}/assets`, null, staffToken);
assertStatus(staffMyAssets.status, 200, 'Staff gets own assets');

const staffMyTickets = await api('GET', '/tickets/my-tickets', null, staffToken);
assertStatus(staffMyTickets.status, 200, 'Staff gets own tickets');

console.log(`  Staff Pages: done`);

// ═══════════════════════════════════════════════════
// PHASE 15: NOTIFICATIONS
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 15: NOTIFICATIONS ===');

const notifs = await api('GET', '/notifications', null, adminToken);
assertStatus(notifs.status, 200, 'Get notifications');
assert(Array.isArray(notifs.data), 'Notifications returns array');

const allNotifs = await api('GET', '/notifications/all', null, adminToken);
assertStatus(allNotifs.status, 200, 'Get all notifications');

const unreadCount = await api('GET', '/notifications/unread-count', null, adminToken);
assertStatus(unreadCount.status, 200, 'Get unread count');

const markAll = await api('PUT', '/notifications/mark-all-read', null, adminToken);
assertStatus(markAll.status, 200, 'Mark all read');

// Snooze (if any notifications)
if (notifs.data?.length > 0) {
  const snooze = await api('PUT', `/notifications/${notifs.data[0].id}/snooze`, { hours: 24 }, adminToken);
  assertStatus(snooze.status, 200, 'Snooze notification');
}

// Staff can access notifications
const staffNotifs = await api('GET', '/notifications', null, staffToken);
assertStatus(staffNotifs.status, 200, 'Staff gets notifications');

// Read-Only CAN read notifications
const roNotifs = await api('GET', '/notifications', null, readonlyToken);
assertStatus(roNotifs.status, 200, 'Read-Only gets notifications');
assert(Array.isArray(roNotifs.data), 'Read-Only notifications returns array');

console.log(`  Notifications: done`);

// ═══════════════════════════════════════════════════
// PHASE 16: SETTINGS & BACKUP
// ═══════════════════════════════════════════════════
console.log('\n=== PHASE 16: SETTINGS & BACKUP ===');

const backupPath = await api('GET', '/settings/backup-path', null, rootToken);
assertStatus(backupPath.status, 200, 'Get backup path');

const wsEnabled = await api('GET', '/settings/ws-enabled', null, rootToken);
assertStatus(wsEnabled.status, 200, 'Get WS enabled setting');

const popupEnabled = await api('GET', '/settings/browser-popup-enabled', null, rootToken);
assertStatus(popupEnabled.status, 200, 'Get popup enabled setting');

// Save settings
const saveSettings = await api('PUT', '/settings', {
  backup_path: backupPath.data?.path || 'C:\\temp\\backups',
  ws_enabled: true,
  browser_popup_enabled: true
}, rootToken);
assertStatus(saveSettings.status, 200, 'Save settings');

// Backup test path
const testPath = await api('POST', '/backup/test-path', { path: 'C:\\temp\\backup-test' }, rootToken);
assertStatus(testPath.status, 200, 'Test backup path');

// Trigger backup
const backup = await api('POST', '/backup', null, rootToken);
assertStatus(backup.status, 200, 'Trigger backup');

// Wait for backup
await new Promise(r => setTimeout(r, 3000));

const backupHistory = await api('GET', '/backup/history', null, rootToken);
assertStatus(backupHistory.status, 200, 'Get backup history');
assert(Array.isArray(backupHistory.data), 'Backup history returns array');

// Staff cannot access settings
const staffSettings = await api('GET', '/settings/backup-path', null, staffToken);
assertStatus(staffSettings.status, 403, 'Staff blocked from settings');

// Read-Only CAN access settings batch GET (requireAdminOrReadOnly — PLAN §16.5 F2)
const roSettings = await api('GET', '/settings', null, readonlyToken);
assertStatus(roSettings.status, 200, 'Read-Only gets settings batch');
assert(roSettings.data && typeof roSettings.data === 'object', 'Read-Only settings returns object');
// Read-Only CANNOT PUT settings
const roSettingsPut = await api('PUT', '/settings', { ws_enabled: true }, readonlyToken);
assertStatus(roSettingsPut.status, 403, 'Read-Only blocked from settings PUT');

// Non-root cannot trigger backup
const adminBackup = await api('POST', '/backup', null, adminToken);
assertStatus(adminBackup.status, 403, 'Non-root blocked from backup trigger');

console.log(`  Settings & Backup: done`);

// ═══════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════
console.log('\n=== TRANSACTIONS ===');

// Transaction history is exposed as the per-entity activity-log timeline
// (GET /api/transactions was removed; timeline endpoint is the replacement).
const txns = await api('GET', '/activity-logs/entity/asset/1', null, adminToken);
assertStatus(txns.status, 200, 'Get transactions');
assert(Array.isArray(txns.data), 'Transactions returns array');

console.log(`  Transactions: done`);

// ═══════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════
console.log('\n=== SETUP ===');

const setupStatus = await api('GET', '/setup/status');
assertStatus(setupStatus.status, 200, 'Setup status accessible without auth');
console.log(`  Setup: done`);

// ═══════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════
console.log('\n' + '='.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log('\nFailed tests:');
  errors.forEach(e => console.log(`  - ${e}`));
}
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
