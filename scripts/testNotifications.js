#!/usr/bin/env node
/**
 * scripts/testNotifications.js — Notification + WebSocket contract.
 *
 * Behaviours: WS auth + push, role routing, ticket status reach staff,
 *             failed-login alert, dismiss/snooze lifecycle, retention.
 */

import { api, runTest, assert, login, USERS, report } from '../tests/helpers.mjs';
import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';

const BASE = process.env.API_BASE || 'http://localhost:3000';
const WS_BASE = BASE.replace(/^http/, 'ws');

const { token: adminToken, user: adminUser } = await login(USERS.admin);
const { token: staffToken } = await login(USERS.staff1);

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws`);
    const received = [];
    const timer = setTimeout(() => resolve({ ws, received }), 3000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.on('message', buf => {
      const msg = JSON.parse(buf.toString());
      if (msg.type === 'auth:ok') { clearTimeout(timer); resolve({ ws, received }); }
      else received.push(msg);
    });
    ws.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// Clean slate
await api('PUT', '/notifications/mark-all-read', {}, adminToken);
await api('PUT', '/notifications/mark-all-read', {}, staffToken);

const adminWs = await connectWs(adminToken);
const staffWs = await connectWs(staffToken);

let ticketId;

await runTest('staff ticket → admin WS push + DB row', async () => {
  const title = `Notif Test ${Date.now()}`;
  await api('POST', '/tickets', { title, description: 'Created by notification verification script', category: 'Hardware', priority: 'Medium' }, staffToken);
  const list = await api('GET', '/tickets', null, adminToken);
  const found = list.data?.find(t => t.title === title);
  assert(found, 'ticket in admin list');
  ticketId = found.id;

  await delay(600);
  const pushed = adminWs.received.filter(m => m.type === 'notification');
  assert(pushed.length >= 1, 'WS push received');
  assert(pushed[0].data.priority === 'warning', `priority: ${pushed[0].data.priority}`);
});

await runTest('role routing: admin sees ticket, staff does not', async () => {
  const admin = await api('GET', '/notifications', null, adminToken);
  const staff = await api('GET', '/notifications', null, staffToken);
  assert(admin.data?.some(n => n.type === 'ticket' && n.priority === 'warning'), 'admin has ticket notif');
  assert(!staff.data?.some(n => n.type === 'ticket' && n.priority === 'warning'), 'staff does not');
});

await runTest('assign + resolve → staff WS push', async () => {
  const adminId = adminUser.id;
  await api('PUT', `/tickets/${ticketId}/assign`, { assigned_admin_id: adminId }, adminToken);
  await api('PUT', `/tickets/${ticketId}`, { status: 'Resolved' }, adminToken);
  await delay(600);
  const staffPush = staffWs.received.filter(m => m.type === 'notification');
  assert(staffPush.some(m => m.data.message.includes('Resolved')), 'staff got resolve push');
});

await runTest('failed login → root critical alert', async () => {
  await api('POST', '/auth/login', { email: USERS.admin.email, password: 'wrong' });
  await delay(400);
  if (adminUser.isRoot) {
    const { data } = await api('GET', '/notifications', null, adminToken);
    assert(data?.some(n => n.type === 'auth' && n.priority === 'critical'), 'critical alert exists');
  }
});

let notifId;
await runTest('snooze hides, mark-all-read works', async () => {
  const { data } = await api('GET', '/notifications', null, adminToken);
  const target = data?.find(n => n.type === 'ticket') || data?.[0];
  assert(target, 'notification to act on');
  notifId = target.id;

  await api('PUT', `/notifications/${notifId}/snooze`, { hours: 24 }, adminToken);
  const after = await api('GET', '/notifications', null, adminToken);
  assert(!after.data?.some(n => n.id === notifId), 'snoozed hidden');

  await api('PUT', '/notifications/mark-all-read', null, adminToken);
  const read = await api('GET', '/notifications', null, adminToken);
  assert(read.data?.every(n => n.is_read === 1), 'all read');
});

await runTest('read notifications persist in history', async () => {
  const { data } = await api('GET', '/notifications/all', null, adminToken);
  assert(data?.some(n => n.id === notifId), 'dismissed row in history');
});

adminWs.ws.close();
staffWs.ws.close();
report();
