#!/usr/bin/env node
/**
 * scripts/testMentions.js — @mention notification contract.
 *
 * Behaviours: @mention notifies exactly the mentioned participant with
 *             warning priority, bystander gets plain info notification,
 *             sender not notified, non-participant mention resolves to nobody.
 */

import { api, runTest, assert, login, USERS, resolveUserId, report } from '../tests/helpers.mjs';

const { token: senderToken }      = await login(USERS.admin);
const { token: mentionedToken }   = await login(USERS.admin1);
const { token: bystanderToken }   = await login(USERS.admin2);
const { token: outsiderToken }    = await login(USERS.staff1);

const senderId    = await resolveUserId(USERS.admin.email, senderToken);
const mentionedId = await resolveUserId(USERS.admin1.email, senderToken);
const bystanderId = await resolveUserId(USERS.admin2.email, senderToken);
assert(senderId && mentionedId && bystanderId, 'user ids');

const { data: conv } = await api('POST', '/conversations', {
  title: `Mention ${Date.now()}`, type: 'standalone', participantIds: [mentionedId, bystanderId],
}, senderToken);
const convId = conv.id;
assert(convId, 'conversation created');

const settle = (ms = 1100) => new Promise(r => setTimeout(r, ms));
const forConv = (notifs, id) => (Array.isArray(notifs) ? notifs : []).filter(n =>
  n.link?.startsWith('/conversations?') && new URLSearchParams(n.link.split('?')[1]).get('c') === String(id));

const send = async (token, content) => {
  const { status } = await api('POST', `/conversations/${convId}/messages`, { content, isInternal: false }, token);
  assert(status === 201, `send ${status}`);
};

// 1. @mention → mentioned user gets warning notification
await runTest('@admin1 notifies exactly admin1', async () => {
  await send(senderToken, `@admin1 review this ${Date.now()}`);
  const notifs = forConv(await (await api('GET', '/notifications', null, mentionedToken)).data, convId);
  assert(notifs.length === 1, `expected 1, got ${notifs.length}`);
  assert(notifs[0].title?.includes('mentioned you in'), `title: ${notifs[0].title}`);
  assert(notifs[0].priority === 'warning', `priority: ${notifs[0].priority}`);
});

// 2. Bystander gets plain info notification
await runTest('bystander gets plain notification', async () => {
  const notifs = forConv(await (await api('GET', '/notifications', null, bystanderToken)).data, convId);
  assert(notifs.length === 1, `expected 1, got ${notifs.length}`);
  assert(notifs[0].title?.startsWith('New Message:'), `title: ${notifs[0].title}`);
  assert(notifs[0].priority === 'info', `priority: ${notifs[0].priority}`);
});

// 3. Sender not notified
await runTest('sender not self-notified', async () => {
  const notifs = forConv(await (await api('GET', '/notifications', null, senderToken)).data, convId);
  assert(notifs.length === 0, `sender got ${notifs.length}`);
});

// 4. Non-participant mention resolves to nobody
await runTest('non-participant @mention notifies nobody extra', async () => {
  await settle();
  await send(senderToken, `@staff1 hey ${Date.now()}`);
  const outsider = forConv(await (await api('GET', '/notifications', null, outsiderToken)).data, convId);
  assert(outsider.length === 0, 'outsider not notified');
  // Bystander now has 2 plain notifications (one per message)
  const byst = forConv(await (await api('GET', '/notifications', null, bystanderToken)).data, convId);
  assert(byst.length === 2, `bystander expected 2, got ${byst.length}`);
});

// 5. Plain message → info for all participants
await runTest('plain message → info for all participants', async () => {
  await settle();
  await send(senderToken, `no tags ${Date.now()}`);
  const m = forConv(await (await api('GET', '/notifications', null, mentionedToken)).data, convId);
  const mentions = m.filter(n => n.title?.includes('mentioned you in'));
  const plains = m.filter(n => n.title?.startsWith('New Message:'));
  assert(mentions.length === 1, 'still only 1 mention');
  assert(plains.length === 2, `expected 2 plain, got ${plains.length}`);
});

report();
