#!/usr/bin/env node
/**
 * scripts/testArchive.js — Archive + oversight contract.
 *
 * Behaviours: membership enforcement, root oversight, hard-move archive,
 *             archive read + posting rejection, restore with history,
 *             recycle bin lifecycle, storage stats, bulk export.
 */

import { api, runTest, assert, login, USERS, resolveUserId, BASE, report } from '../tests/helpers.mjs';

const { token: rootToken } = await login(USERS.admin);
const { token: a1Token }   = await login(USERS.admin1);
const { token: a2Token }   = await login(USERS.admin2);
const a1Id = await resolveUserId(USERS.admin1.email, rootToken);
const a2Id = await resolveUserId(USERS.admin2.email, rootToken);
assert(a1Id && a2Id, `admin ids: ${a1Id}, ${a2Id}`);

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let convId;

await runTest('A1 creates conversation with A2 + attachment', async () => {
  const { status, data } = await api('POST', '/conversations', {
    title: `Arch ${Date.now()}`, type: 'standalone', participantIds: [a2Id],
  }, a1Token);
  assert(status === 201 && data.id, `create ${status}`);
  convId = data.id;

  const form = new FormData();
  form.append('content', 'before archive');
  form.append('isInternal', 'false');
  form.append('attachments', new Blob([TINY_PNG], { type: 'image/png' }), 'proof.png');
  const send = await api('POST', `/conversations/${convId}/messages`, form, a1Token);
  assert(send.status === 201, `send ${send.status}`);
});

await runTest('non-participant admin gets 403 on messages', async () => {
  const c = await api('POST', '/conversations', {
    title: `Mem ${Date.now()}`, type: 'standalone', participantIds: [],
  }, a1Token);
  const r = await api('GET', `/conversations/${c.data.id}/messages`, null, a2Token);
  assert(r.status === 403, `expected 403, got ${r.status}`);
  await api('DELETE', `/conversations/${c.data.id}`, null, rootToken);
});

await runTest('oversight: 403 for admin, 200 for root', async () => {
  const admin = await api('GET', '/conversations/oversight', null, a2Token);
  assert(admin.status === 403, `admin oversight ${admin.status}`);
  const root = await api('GET', '/conversations/oversight', null, rootToken);
  assert(root.status === 200 && Array.isArray(root.data?.conversations), 'root oversight ok');
  assert(root.data.conversations.some(c => c.id === convId), 'conv in oversight');
});

await runTest('root can open any conversation', async () => {
  const { status } = await api('GET', `/conversations/${convId}/messages?limit=10`, null, rootToken);
  assert(status === 200, `status ${status}`);
});

await runTest('hard-move archive: gone from active, present in archive', async () => {
  const arch = await api('PUT', `/conversations/${convId}/archive`, { reason: 'test' }, a1Token);
  assert(arch.status === 200, `archive ${arch.status}`);

  const active = await api('GET', '/conversations', null, a1Token);
  assert(!active.data.conversations.some(c => c.id === convId), 'not in active list');

  const archive = await api('GET', '/conversations/archive', null, rootToken);
  const item = archive.data?.conversations?.find(c => c.id === convId);
  assert(item, 'in archive list');
  assert(item.archive_reason === 'test', `reason: ${item.archive_reason}`);
});

await runTest('archived: readable, posting rejected (409)', async () => {
  const read = await api('GET', `/conversations/${convId}/messages`, null, rootToken);
  assert(read.status === 200 && read.data.some(m => (m.content || '').includes('before archive')), 'content readable');

  const form = new FormData(); form.append('content', 'x');
  const post = await api('POST', `/conversations/${convId}/messages`, form, rootToken);
  assert(post.status === 409, `expected 409, got ${post.status}`);
});

await runTest('restore: root-only, history preserved', async () => {
  const adminRestore = await api('PUT', `/conversations/${convId}/unarchive`, {}, a1Token);
  assert(adminRestore.status === 403, `admin restore ${adminRestore.status}`);

  const { status } = await api('PUT', `/conversations/${convId}/unarchive`, {}, rootToken);
  assert(status === 200, `root restore ${status}`);

  const msgs = await api('GET', `/conversations/${convId}/messages`, null, a1Token);
  assert(msgs.data.some(m => (m.content || '').includes('before archive')), 'history intact');
});

await runTest('recycle bin: delete → tombstone → restore → purge', async () => {
  await api('DELETE', `/conversations/${convId}`, null, rootToken);
  const bin = await api('GET', '/conversations/archive?includeDeleted=true', null, rootToken);
  assert(bin.data.conversations.some(c => c.id === convId && c.deleted_at), 'tombstone set');

  await api('PUT', `/conversations/${convId}/unarchive`, {}, rootToken);
  await api('DELETE', `/conversations/${convId}`, null, rootToken);
  const purge = await api('DELETE', `/conversations/archive/${convId}`, null, rootToken);
  assert(purge.status === 200, `purge ${purge.status}`);

  const after = await api('GET', '/conversations/archive?includeDeleted=true', null, rootToken);
  assert(!after.data.conversations.some(c => c.id === convId), 'gone forever');
});

await runTest('storage-stats: root 200, admin 403', async () => {
  const root = await api('GET', '/conversations/storage-stats', null, rootToken);
  assert(root.status === 200 && typeof root.data.main_db?.size_bytes === 'number', 'root ok');
  const admin = await api('GET', '/conversations/storage-stats', null, a2Token);
  assert(admin.status === 403, `admin ${admin.status}`);
});

await runTest('lifecycle run-now: archive retention 0 = disabled, admin 403', async () => {
  // Preserve the operator's current value; restore it at the end.
  const prev = await api('GET', '/settings/conversation-archive-retention-days', null, rootToken);
  const prevVal = parseInt(prev.data?.value || '0', 10) || 0;
  try {
    await api('PUT', '/settings', { conversationArchiveRetentionDays: 0 }, rootToken);
    const run = await api('POST', '/settings/conversation-auto-archive-run', {}, rootToken);
    assert(run.status === 200 && run.data?.ok, `run ${run.status}`);
    assert(run.data.archivePurgedCount === 0, `disabled path must purge 0 archives, got ${run.data.archivePurgedCount}`);
    assert(run.data.archiveRetentionDays === 0, `retention echo ${run.data.archiveRetentionDays}`);

    const admin = await api('POST', '/settings/conversation-auto-archive-run', {}, a1Token);
    assert(admin.status === 403, `admin run-now ${admin.status}`);
  } finally {
    if (prevVal !== 0) {
      await api('PUT', '/settings', { conversationArchiveRetentionDays: prevVal }, rootToken);
    }
  }
});

await runTest('bulk export ZIP (root)', async () => {
  const ids = [];
  for (const t of ['BulkA', 'BulkB']) {
    const { data } = await api('POST', '/conversations', { title: `${t} ${Date.now()}`, type: 'standalone', participantIds: [] }, a1Token);
    ids.push(data.id);
    const form = new FormData(); form.append('content', `payload ${t}`);
    await api('POST', `/conversations/${data.id}/messages`, form, a1Token);
  }
  const res = await fetch(`${BASE}/api/conversations/bulk/export`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rootToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  assert(res.status === 200, `export ${res.status}`);
  assert((res.headers.get('content-type') || '').includes('zip'), 'zip content-type');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert(bytes.length > 600 && bytes.slice(0, 2).toString() === 'PK', 'valid zip');
  for (const id of ids) await api('DELETE', `/conversations/${id}`, null, rootToken);
});

report();
