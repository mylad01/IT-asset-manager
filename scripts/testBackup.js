#!/usr/bin/env node
/**
 * scripts/testBackup.js — Backup contract.
 *
 * Behaviours: write-probe valid/invalid paths, on-demand backup produces
 *             valid ZIP with database + local config (.env when present,
 *             omitted when the checkout has no .env at all),
 *             history recorded.
 */

import { api, runTest, assert, login, USERS, report } from '../tests/helpers.mjs';
import path from 'node:path';
import os from 'node:os';
import { readdir } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { existsSync, writeFileSync } from 'node:fs';

const { token, user } = await login(USERS.admin);
assert(user.isRoot, 'backup requires root admin');

const validPath = path.join(os.tmpdir(), `itame-backup-${Date.now()}`);

await runTest('write-probe: valid path accepted', async () => {
  const { status, data } = await api('POST', '/backup/test-path', { path: validPath }, token);
  assert(status === 200 && data.success === true, `status ${status}`);
});

let backup;
await runTest('on-demand backup succeeds', async () => {
  const { status, data } = await api('POST', '/backup', null, token);
  assert(status === 200 && data.filename?.endsWith('.zip'), `filename: ${data.filename}`);
  assert(data.sizeBytes > 0, 'non-empty');
  backup = data;
});

await runTest('snapshot ZIP contains database + local config', async () => {
  const fullPath = backup.path || path.join(process.env.BACKUP_PATH || validPath, backup.filename);
  const zip = new AdmZip(fullPath);
  const names = zip.getEntries().map(e => e.entryName);
  assert(names.includes('database.sqlite') || names.some(n => n.startsWith('database.sqlite')), 'has database.sqlite');
  // The snapshot must capture .env whenever it exists on disk; the only
  // correct omission is a checkout that has no .env at all.
  const envOnDisk = existsSync(path.resolve(import.meta.dirname, '../.env'));
  assert(names.some(n => n === '.env') || !envOnDisk, 'has .env when a local .env exists');

  const dbBuf = zip.readFile('database.sqlite');
  assert(dbBuf && dbBuf.length > 1000, 'database not empty');

  const uploadsDir = path.resolve(import.meta.dirname, '../uploads');
  let uploadFiles = 0;
  try { uploadFiles = (await readdir(uploadsDir, { recursive: true })).length; } catch {}
  if (uploadFiles > 0) assert(names.some(n => n.startsWith('uploads')), 'has uploads/');
});

await runTest('backup history records the run', async () => {
  const { data } = await api('GET', '/backup/history', null, token);
  assert(Array.isArray(data) && data.length >= 1, 'at least one entry');
  assert(data.some(h => h.filename === backup.filename && h.status === 'success'), 'matching entry');
});

await runTest('write-probe: invalid path rejected', async () => {
  const blocker = path.join(validPath, 'blocker');
  writeFileSync(blocker, 'x');
  const { status } = await api('POST', '/backup/test-path', { path: path.join(blocker, 'sub') }, token);
  assert(status === 400, `expected 400, got ${status}`);
});

report();
