#!/usr/bin/env node
/**
 * scripts/testConversations.js — Conversation workspace contract.
 *
 * Behaviours: role guardrails, CRUD lifecycle, messages, reactions, read
 * state, participants, search, archive round-trip, export, delete guard.
 */

import { api, runTest, assert, login, USERS, resolveUserId, BASE, report } from '../tests/helpers.mjs';

const { token: adminToken, user: adminUser } = await login(USERS.admin);
const { token: staffToken } = await login(USERS.staff1);
const adminId = adminUser.id;
assert(adminId, 'admin id missing from login');

let convId, msgId;

await runTest('staff blocked from conversation endpoints', async () => {
  const { status } = await api('GET', '/conversations', null, staffToken);
  assert(status === 401 || status === 403, `expected 401/403, got ${status}`);
});

await runTest('list conversations', async () => {
  const { status, data } = await api('GET', '/conversations', null, adminToken);
  assert(status === 200 && Array.isArray(data.conversations), 'expected { conversations: [] }');
});

await runTest('create → send → fetch → edit', async () => {
  const c = await api('POST', '/conversations', { title: `V ${Date.now()}`, type: 'standalone', participantIds: [adminId] }, adminToken);
  assert(c.status === 201 && c.data.id, `create ${c.status}`);
  convId = c.data.id;

  const m = await api('POST', `/conversations/${convId}/messages`, { content: 'hello', isInternal: false }, adminToken);
  assert(m.status === 201 && m.data.message?.id, `send ${m.status}`);
  msgId = m.data.message.id;

  const list = await api('GET', `/conversations/${convId}/messages`, null, adminToken);
  assert(list.status === 200 && list.data.some(x => x.id === msgId), 'message in list');

  const edit = await api('PUT', `/conversations/${convId}/messages/${msgId}`, { content: 'edited' }, adminToken);
  assert(edit.status === 200, `edit ${edit.status}`);
});

await runTest('reactions add/remove', async () => {
  await api('POST', `/conversations/${convId}/messages/${msgId}/reactions`, { emoji: '✅' }, adminToken);
  const rm = await api('DELETE', `/conversations/${convId}/messages/${msgId}/reactions/✅`, null, adminToken);
  assert(rm.status === 200, `remove ${rm.status}`);
});

await runTest('mark read', async () => {
  const { status } = await api('PUT', `/conversations/${convId}/read`, {}, adminToken);
  assert(status === 200, `status ${status}`);
});

await runTest('participants add/list/remove', async () => {
  const staffId = await resolveUserId(USERS.staff1.email, adminToken);
  assert(staffId, 'staff id');
  await api('POST', `/conversations/${convId}/participants`, { userIds: [staffId] }, adminToken);
  const list = await api('GET', `/conversations/${convId}/participants`, null, adminToken);
  assert(list.data.some(p => (p.user_id || p.id) === staffId), 'staff is participant');
  const rm = await api('DELETE', `/conversations/${convId}/participants/${staffId}`, null, adminToken);
  assert(rm.status === 200, `remove ${rm.status}`);
});

await runTest('search finds conversation', async () => {
  const { status } = await api('GET', '/conversations/search?q=Verification', null, adminToken);
  assert(status === 200, `status ${status}`);
});

await runTest('archive round-trip preserves history', async () => {
  const arch = await api('PUT', `/conversations/${convId}/archive`, {}, adminToken);
  assert(arch.status === 200, `archive ${arch.status}`);

  const active = await api('GET', '/conversations', null, adminToken);
  assert(!active.data.conversations.some(c => c.id === convId), 'gone from active list');

  const restore = await api('PUT', `/conversations/${convId}/unarchive`, {}, adminToken);
  assert(restore.status === 200, `restore ${restore.status}`);

  const msgs = await api('GET', `/conversations/${convId}/messages`, null, adminToken);
  assert(msgs.data.some(m => m.id === msgId), 'history survived round-trip');
});

await runTest('export conversation (json)', async () => {
  const { status, data } = await api('GET', `/conversations/${convId}/export?format=json`, null, adminToken);
  assert(status === 200 && data, `export ${status}`);
});

await runTest('export all (csv)', async () => {
  const res = await fetch(`${BASE}/api/conversations/export-all?format=csv`, { headers: { Authorization: `Bearer ${adminToken}` } });
  const text = await res.text();
  assert(res.status === 200 && text.startsWith('ID,Title,Type'), `csv header: ${text.slice(0, 40)}`);
});

await runTest('staff cannot delete conversations', async () => {
  const { status } = await api('DELETE', `/conversations/${convId}`, null, staffToken);
  assert(status === 401 || status === 403, `expected 401/403, got ${status}`);
});

// ── conversations.type vocabulary (split-brain regression) ──────────────
// The 20260920 bulletproof rebuild made the schema accept only `ticket`
// while EVERY app layer writes `ticket-linked` — POST /conversations and
// the auto-create route answered 500 CHECK constraint failed,
// getByTicketId never matched (duplicate ticket chats), and the badge/
// filter could never render. Migration 20261005000001 reconciles the two;
// these four assertions fail on the pre-migration schema.
let ticketConvId = null;

async function firstTicketId() {
  const t = await api('GET', '/tickets', null, adminToken);
  if (t.status === 200 && Array.isArray(t.data) && t.data.length > 0) return t.data[0].id;

  // A freshly reseeded dev DB (npm run reset:db) ships departments/asset
  // types/assets but no tickets, and tickets are optional domain data this
  // suite has no business assuming. Provision the fixture the way the app
  // does — Staff submits a ticket — so the three ticket-linked assertions
  // below still exercise the REAL conversation paths (201, one-chat-per-ticket
  // dedupe, idempotent auto-create). Nothing is asserted about the fixture.
  const created = await api('POST', '/tickets', {
    title: `Ticket-linked fixture ${Date.now()}`,
    description: 'Fixture created by testConversations when the dev DB has no tickets',
    category: 'Hardware',
    priority: 'Medium',
    assigned_admin_id: adminId, // mirrors how the app hands a ticket to an admin
  }, staffToken);
  // 2xx only — the CREATE status is not the subject under test here; the
  // re-fetch below is what proves the precondition ("a ticket exists").
  assert(created.status >= 200 && created.status < 300, `ticket fixture create ${created.status}`);

  const after = await api('GET', '/tickets', null, adminToken);
  assert(after.status === 200 && Array.isArray(after.data) && after.data.length > 0,
    `tickets list ${after.status}`);
  return after.data[0].id;
}

await runTest('ticket-linked create — schema accepts the app vocabulary', async () => {
  const ticketId = await firstTicketId();
  const c = await api('POST', '/conversations', { title: `T ${Date.now()}`, type: 'ticket-linked', ticketId, participantIds: [adminId] }, adminToken);
  assert(c.status === 201 && c.data.type === 'ticket-linked' && c.data.ticket_id === ticketId,
    `ticket-linked create ${c.status} type=${c.data?.type} ticket_id=${c.data?.ticket_id}`);
  ticketConvId = c.data.id;

  const list = await api('GET', '/conversations?type=ticket-linked', null, adminToken);
  assert(list.status === 200 && list.data.conversations.some(x => x.id === ticketConvId),
    'type=ticket-linked filter finds the conversation');
});

await runTest('ticket-linked without ticketId → 400, not a DB 500', async () => {
  const c = await api('POST', '/conversations', { title: `X ${Date.now()}`, type: 'ticket-linked' }, adminToken);
  assert(c.status === 400, `expected 400 from the validator, got ${c.status}`);
});

await runTest('one chat per ticket — second create returns the existing one', async () => {
  const ticketId = await firstTicketId();
  const again = await api('POST', '/conversations', { title: `T2 ${Date.now()}`, type: 'ticket-linked', ticketId, participantIds: [adminId] }, adminToken);
  assert(again.status === 201 && again.data.id === ticketConvId,
    `dedupe ${again.status} id=${again.data?.id} (want ${ticketConvId})`);
});

await runTest('auto-create ticket chat route (was 500 CHECK constraint failed)', async () => {
  const ticketId = await firstTicketId();
  const a = await api('POST', `/conversations/ticket/${ticketId}`, null, adminToken);
  assert((a.status === 200 || a.status === 201) && a.data.type === 'ticket-linked',
    `auto-create ${a.status} type=${a.data?.type}`);
  const b = await api('POST', `/conversations/ticket/${ticketId}`, null, adminToken);
  assert(b.status === a.status && b.data.id === a.data.id, 'auto-create is idempotent');
});

report();
