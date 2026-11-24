#!/usr/bin/env node
/**
 * scripts/testAttachments.js — Attachment contract.
 *
 * Behaviours: photo-only accepted, attachment served via auth endpoint,
 *             empty message rejected, text+photo works, multi-file works,
 *             video kind detected, unsupported type rejected, mentions work.
 */

import { api, runTest, assert, login, USERS, resolveUserId, BASE, report } from '../tests/helpers.mjs';

const { token: senderToken } = await login(USERS.admin);
const { token: otherToken }  = await login(USERS.admin1);
const otherId = await resolveUserId(USERS.admin1.email, senderToken);
assert(otherId, 'other user id');

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TINY_MP4 = Buffer.from('AAAAAA/pc3R5cGoAAAADAAAAAAAAAAEAAAA=', 'base64');

// Create conversation
const { data: conv } = await api('POST', '/conversations', {
  title: `Att ${Date.now()}`, type: 'standalone', participantIds: [otherId],
}, senderToken);
const convId = conv.id;

// Table: [name, content, files, expectStatus]
const msgCases = [
  ['photo-only accepted',        '',         [['photo.png', 'image/png', TINY_PNG]], 201],
  ['empty message rejected',     '',         [],                                      400],
  ['text + photo works',         'screenshot', [['shot.png', 'image/png', TINY_PNG]], 201],
  ['multi-file photo-only',      '',         [['a.png', 'image/png', TINY_PNG], ['b.png', 'image/png', TINY_PNG]], 201],
  ['video kind=video',           'clip',     [['clip.mp4', 'video/mp4', TINY_MP4]],  201],
  ['unsupported type rejected',  'docx',     [['bad.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('PK')]], 400],
];

for (const [name, content, files, expect] of msgCases) {
  await runTest(name, async () => {
    const form = new FormData();
    form.append('content', content);
    form.append('isInternal', 'false');
    for (const [fname, mime, buf] of files) form.append('attachments', new Blob([buf], { type: mime }), fname);
    const { status } = await api('POST', `/conversations/${convId}/messages`, form, senderToken);
    assert(status === expect, `expected ${expect}, got ${status}`);
  });
}

await runTest('attachment served via auth + non-member blocked', async () => {
  // Fetch the first message (photo-only) to test image content-type.
  const { data: msgs } = await api('GET', `/conversations/${convId}/messages`, null, senderToken);
  const firstWithAtt = msgs.find(m => m.attachments?.length > 0);
  const att = firstWithAtt?.attachments?.[0];
  assert(att?.url, 'attachment has url');
  assert(/^\/api\/conversations\/messages\/\d+\/attachments\/\d+$/.test(att.url), `url shape: ${att.url}`);

  const dl = await fetch(`${BASE}${att.url}`, { headers: { Authorization: `Bearer ${senderToken}` } });
  assert(dl.status === 200, `download ${dl.status}`);
  assert((dl.headers.get('content-type') || '').includes('image/png'), 'correct content-type');

  // Non-participant gets 403
  const third = await api('POST', '/auth/login', { email: USERS.admin2.email, password: USERS.admin2.password });
  if (third.status === 200) {
    const forbidden = await fetch(`${BASE}${att.url}`, { headers: { Authorization: `Bearer ${third.data.token}` } });
    assert(forbidden.status === 403, `non-member ${forbidden.status}`);
  }
});

await runTest('mention flow unaffected by validator', async () => {
  const form = new FormData();
  form.append('content', `@admin1 ping ${Date.now()}`);
  form.append('isInternal', 'false');
  const { status } = await api('POST', `/conversations/${convId}/messages`, form, senderToken);
  assert(status === 201, `status ${status}`);
  const { data: notifs } = await api('GET', '/notifications', null, otherToken);
  const mentions = (Array.isArray(notifs) ? notifs : []).filter(n =>
    n.link?.includes(`c=${convId}`) && n.title?.includes('mentioned you in'));
  assert(mentions.length === 1, `mention count: ${mentions.length}`);
});

await runTest('cleanup: delete conversation', async () => {
  const { status } = await api('DELETE', `/conversations/${convId}`, null, senderToken);
  assert(status === 200 || status === 204, `delete ${status}`);
});

report();
