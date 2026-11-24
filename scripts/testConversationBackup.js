#!/usr/bin/env node
/**
 * scripts/testConversationBackup.js — Conversation backup contract.
 *
 * Behaviours: staff blocked, manual backup succeeds with valid ZIP,
 *             history recorded, settings round-trip.
 */

import { api, runTest, assert, login, USERS, report } from '../tests/helpers.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const { token: adminToken, user: adminUser } = await login(USERS.admin);
const { token: staffToken } = await login(USERS.staff1);
if (!adminUser.isRoot) { console.log('Admin is not root — skipping root-only tests'); process.exit(0); }

await runTest('staff blocked from backup endpoints', async () => {
  const { status } = await api('POST', '/conversations/backup', {}, staffToken);
  assert(status === 401 || status === 403, `expected 401/403, got ${status}`);
});

await runTest('manual backup succeeds', async () => {
  const { status, data } = await api('POST', '/conversations/backup', {}, adminToken);
  assert(status === 200 && data.success, `backup ${status}`);
  assert(data.filename?.startsWith('conversations-backup-'), `filename: ${data.filename}`);
  assert(data.sizeBytes > 0, 'non-empty zip');
});

await runTest('backup ZIP has conversations.sqlite + archive', async () => {
  const { data: history } = await api('GET', '/conversations/backup/history?limit=1', null, adminToken);
  const entry = history?.[0];
  assert(entry, 'history entry exists');

  const setting = await api('GET', '/settings/backup-path', null, adminToken);
  const backupPath = setting.data?.value || process.env.BACKUP_PATH || './backups';
  const zipPath = path.resolve(backupPath, entry.filename);
  const stat = await fs.stat(zipPath).catch(() => null);
  assert(stat, `zip on disk: ${zipPath}`);

  const zip = new AdmZip(zipPath);
  const names = zip.getEntries().map(e => e.entryName);
  assert(names.includes('conversations.sqlite'), 'has conversations.sqlite');
  assert(names.includes('conversations-archive.sqlite'), 'has archive snapshot');
});

await runTest('backup ZIP carries a valid SHA256SUMS manifest', async () => {
  const { data: history } = await api('GET', '/conversations/backup/history?limit=1', null, adminToken);
  const entry = history?.[0];
  assert(entry, 'history entry exists');

  const setting = await api('GET', '/settings/backup-path', null, adminToken);
  const backupPath = setting.data?.value || process.env.BACKUP_PATH || './backups';
  const zip = new AdmZip(path.resolve(backupPath, entry.filename));

  const manifestEntry = zip.getEntry('SHA256SUMS');
  assert(manifestEntry, 'has SHA256SUMS entry');

  // Format: every line is `<64 hex>  <name>` (sha256sum-compatible).
  const lines = manifestEntry.getData().toString('utf-8').split('\n').filter(Boolean);
  assert(lines.length > 0, 'manifest has at least one line');
  const formatRe = /^([0-9a-f]{64})\s{2}(.+)$/;      // [1]=hash, [2]=name
  const badLines = lines.filter((l) => !formatRe.test(l));
  assert(badLines.length === 0, `every manifest line matches "<hex>  <name>"`, badLines[0]?.slice(0, 60));

  // Content: at least the two DB snapshots are listed, and one entry's
  // in-process sha-256 equals the manifest line (independent of the
  // verifier utility — proves the format, not just self-consistency).
  const byName = new Map(lines.map((l) => { const m = l.match(formatRe); return [m[2], m[1]]; }));
  assert(byName.has('conversations.sqlite'), 'manifest lists conversations.sqlite');
  assert(byName.has('conversations-archive.sqlite'), 'manifest lists conversations-archive.sqlite');

  const { createHash } = await import('node:crypto');
  const probeEntry = zip.getEntry('conversations.sqlite');
  const actual = createHash('sha256').update(probeEntry.getData()).digest('hex');
  assert(byName.get('conversations.sqlite') === actual,
    'manifest hash for conversations.sqlite matches an independently computed sha-256',
    `${byName.get('conversations.sqlite')?.slice(0, 12)} vs ${actual.slice(0, 12)}`);

  // The shared verifier passes on the fresh backup.
  const { verifyZipChecksums } = await import('../server/utils/backupChecksums.js');
  const verdict = verifyZipChecksums(zip);
  assert(verdict.ok, 'verifyZipChecksums passes on the fresh backup', verdict.problems.join('; '));
});

await runTest('backup history records the run', async () => {
  const { data } = await api('GET', '/conversations/backup/history?limit=5', null, adminToken);
  assert(Array.isArray(data) && data.length >= 1, 'at least one entry');
  assert(data[0].status === 'success', `status: ${data[0].status}`);
});

await runTest('backup history logs the manifest hash for out-of-band tamper-evidence', async () => {
  const { data: history } = await api('GET', '/conversations/backup/history?limit=5', null, adminToken);
  const entry = history?.find((e) => e.status === 'success');
  assert(entry, 'a successful backup exists');
  // New backups MUST log the hash (64-hex sha256 of the embedded SHA256SUMS).
  // The strict end-to-end equality check lives in testBackupRestoreDrill 2c;
  // here we pin the API contract: the field exists on fresh rows (raw
  // snake_case rows — the history UI reads size_bytes/created_at directly).
  assert(/^[0-9a-f]{64}$/.test(entry.manifest_hash_hex || ''),
    'history row exposes manifest_hash_hex (sha256 of the ZIP\'s embedded manifest)',
    `got: ${String(entry.manifest_hash_hex).slice(0, 20)}`);
});

await runTest('manifest sidecar (<zip>.SHA256SUMS) written next to the ZIP', async () => {
  const { data: history } = await api('GET', '/conversations/backup/history?limit=5', null, adminToken);
  const entry = history?.find((e) => e.status === 'success');
  assert(entry, 'a successful backup exists');

  const setting = await api('GET', '/settings/backup-path', null, adminToken);
  const backupPath = setting.data?.value || process.env.BACKUP_PATH || './backups';
  const zipPath = path.resolve(backupPath, entry.filename);
  const sidecarPath = `${zipPath}.SHA256SUMS`;
  const sidecar = await fs.readFile(sidecarPath, 'utf-8').catch(() => null);
  assert(sidecar != null, `sidecar exists: ${sidecarPath}`);

  // Byte-identical to the ZIP's embedded manifest — a diff must stay empty.
  const zip = new AdmZip(zipPath);
  const embedded = zip.getEntry('SHA256SUMS').getData().toString('utf-8');
  assert(sidecar === embedded, 'sidecar is byte-identical to the embedded SHA256SUMS');
});

await runTest('settings round-trip (auto-backup toggle)', async () => {
  const cur = await api('GET', '/settings/conversation-auto-backup', null, adminToken);
  const orig = cur.data?.value;
  await api('PUT', '/settings', { conversationAutoBackup: orig !== '1' }, adminToken);
  const ch = await api('GET', '/settings/conversation-auto-backup', null, adminToken);
  assert(ch.data?.value === (orig === '1' ? '0' : '1'), 'toggled');
  await api('PUT', '/settings', { conversationAutoBackup: orig === '1' }, adminToken);
});

report();
