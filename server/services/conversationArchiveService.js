// conversationArchiveService.js — the hard-move archive engine.
//
// Archive = the conversation's rows MOVE from the active DB into the archive
// DB and its attachment files MOVE from uploads/conversations/ into
// uploads/archive/conversations/. Restore is the exact inverse. Each DB gets
// its own transaction; file moves happen AFTER the row commit so a crash
// mid-move is recoverable (resolveAttachmentPath checks both locations).
//
// Space reclamation: SQLite never returns disk space on DELETE — a debounced
// VACUUM after archive batches is what actually shrinks the file.

import { getDb } from '../database.js';
import * as archiveDb from '../db/archiveDb.js';
import * as attachmentModel from '../models/messageAttachmentModel.js';
import { logChange } from './activityLogService.js';
import { broadcastToConversation, pushToUser } from './wsServer.js';
import { emit as emitNotification } from './notificationEvents.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import {
  activeConversationsDir,
  archiveConversationsDir,
  ensureConversationDirs,
} from '../utils/uploadPaths.js';
import env from '../config/env.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────────
// Space reclamation
// ─────────────────────────────────────────────────────────────────

let vacuumQueued = false;
let vacuumTimer = null;
let vacuumWorker = null; // active worker thread — second triggers coalesce into it

/**
 * Debounced VACUUM + WAL checkpoint on the main DB, executed in a worker
 * thread (server/db/vacuumWorker.js) so better-sqlite3's synchronous VACUUM
 * never blocks the API server's event loop (bug #2: large vacuums made
 * /api/health answer 503 while healthy:true). Call after archive or purge
 * batches; multiple triggers within 10s coalesce into one VACUUM, and a
 * trigger while a worker is already running coalesces into the next run.
 */
export function scheduleVacuum(reason = 'archive') {
  vacuumQueued = true;
  if (vacuumWorker) return; // a VACUUM is in flight — its exit handler re-runs us
  if (vacuumTimer) clearTimeout(vacuumTimer);
  vacuumTimer = setTimeout(() => {
    vacuumTimer = null;
    if (!vacuumQueued) return;
    vacuumQueued = false;

    const runInlineFallback = (why) => {
      // Fallback for exotic runtimes (no worker_threads) or a failed spawn:
      // the old event-loop-blocking behavior is better than skipping VACUUM.
      logger.warn({ reason, why }, 'VACUUM worker unavailable — running inline (event loop will block)');
      runVacuumInline(reason).catch((err) => {
        logger.warn({ err, reason }, 'VACUUM failed (will retry on next trigger)');
        vacuumQueued = true; // retried on next scheduleVacuum call
      });
    };

    let Worker;
    try {
      ({ Worker } = require('node:worker_threads'));
    } catch (err) {
      runInlineFallback(`worker_threads unavailable: ${err?.message || err}`);
      return;
    }

    const dbPath = env.DB_PATH || './database.sqlite';
    let worker;
    try {
      worker = new Worker(new URL('../db/vacuumWorker.js', import.meta.url), { workerData: { dbPath } });
    } catch (err) {
      logger.warn({ err, reason }, 'VACUUM worker spawn failed — falling back to inline');
      runInlineFallback(`spawn failed: ${err?.message || err}`);
      return;
    }

    vacuumWorker = worker;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      vacuumWorker = null;
      // A trigger that arrived mid-run re-arms the debounce (10s) instead of
      // spawning a second concurrent worker.
      if (vacuumQueued) scheduleVacuum('vacuum-retry-or-coalesce');
    };

    worker.on('message', (msg) => {
      if (msg?.ok) {
        logger.info({ reason, durationMs: msg.durationMs, spaceReclaimedBytes: msg.spaceReclaimedBytes ?? null }, 'Main DB VACUUM completed (space reclaimed)');
      } else {
        logger.warn({ err: msg?.error, reason }, 'VACUUM failed (will retry on next trigger)');
        vacuumQueued = true; // same contract as the old inline failure path
      }
    });
    worker.on('error', (err) => {
      logger.warn({ err, reason }, 'VACUUM worker crashed (will retry on next trigger)');
      vacuumQueued = true;
    });
    worker.on('exit', finish);
  }, 10_000);
}

/** Legacy inline path — only used when worker_threads is unavailable. */
async function runVacuumInline(reason) {
  const { getConnection } = await import('../db/connection.js');
  const raw = await getConnection();
  await raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  await raw.exec('VACUUM');
  logger.info({ reason }, 'Main DB VACUUM completed (space reclaimed)');
}

// ─────────────────────────────────────────────────────────────────
// Attachment file moves
// ─────────────────────────────────────────────────────────────────

/**
 * Move a conversation's attachment files between the active and archive
 * trees. Driven by attachment DB rows (resolved via uploadPaths), never by
 * directory assumptions — flat layout means every row is authoritative.
 * Per-file failures are logged and skipped (best-effort); returns
 * { moved, failed, refused }.
 *
 * Hardened against cross-conversation collisions (basenames ARE the file
 * identity). Under the one-tree invariant — a row's file lives in exactly
 * one tree at a time — a crash-retry always shows the source GONE and the
 * destination present. Therefore: source AND destination both existing means
 * the destination belongs to someone else, and rename would clobber it —
 * refuse loudly instead. A missing source with the destination present is
 * the legitimate crash-retry and counts as moved.
 */
export function moveConversationFiles(attachments, direction) {
  ensureConversationDirs();
  const fromDir = direction === 'archive' ? activeConversationsDir() : archiveConversationsDir();
  const toDir = direction === 'archive' ? archiveConversationsDir() : activeConversationsDir();

  let moved = 0;
  let failed = 0;
  let refused = 0;
  for (const att of attachments) {
    const rel = String(att.file_path || '').replace(/\\/g, '/');
    const base = path.basename(rel);
    if (!base) { failed++; continue; }
    const from = path.join(fromDir, base);
    const to = path.join(toDir, base);
    try {
      if (fs.existsSync(from)) {
        if (fs.existsSync(to)) {
          // Both trees hold the name: the destination cannot be ours (a
          // completed move removes the source) — it is a foreign file.
          logger.error({ file: base, direction, destination: to }, 'Attachment move REFUSED — destination already exists while source is present (cross-conversation collision?)');
          refused++;
          continue;
        }
        fs.renameSync(from, to);
        moved++;
      } else if (fs.existsSync(to)) {
        // Already moved (crash-retry): the source is gone because our move
        // completed — the destination file is genuinely this row's.
        moved++;
      } else {
        logger.warn({ file: base, direction }, 'Attachment file missing during move');
        failed++;
      }
    } catch {
      // Cross-device fallback: rename fails EXDEV across filesystems.
      try {
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
        moved++;
      } catch (err2) {
        logger.error({ err: err2, file: base, direction }, 'Attachment file move failed');
        failed++;
      }
    }
  }
  return { moved, failed, refused };
}



// ─────────────────────────────────────────────────────────────────
// Archive / restore / delete
// ─────────────────────────────────────────────────────────────────

/**
 * Hard-move archive one conversation.
 * `req` optional (activity log attribution). `reason` stored in the archive
 * row. Rejects conversations already gone from the active DB.
 */
export async function archiveConversation(id, { reason = null, archivedBy = null, tombstone = null, actorUser = null, req = null } = {}) {
  const db = await getDb();
  const conversationId = Number(id);

  const conversation = await db.get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  if (!conversation) {
    const err = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }

  // 2.5 Pre-move collision audit (BEFORE any DB mutation): archiving moves
  // every file out of the active tree, so any basename already occupied in
  // the archive tree is foreign and would be clobbered. Refusing here leaves
  // the active rows untouched — the archive button becomes safe-by-default
  // when the storage trees hold a legacy name collision.
  {
    const activeAttachments = await attachmentModel.getByConversation(conversationId).catch(() => []);
    const { assertNoFileCollisions } = await import('../utils/uploadPaths.js');
    assertNoFileCollisions(activeAttachments, 'archive');
  }

  // 1. Copy rows into the archive DB (its own transaction, IDs preserved).
  // tombstone carries the recycle-bin deleted_at/deleted_by when called from
  // softDeleteConversation; null for plain archives.
  // A row with this id can only already exist in the archive if it belongs
  // to a previous DB generation (a DB reset recycles ids; a genuine double
  // archive 404s above because the active row is gone). Purge the stale
  // generation first so the move doesn't die on the ids-preserved UNIQUE.
  const stale = await archiveDb.getConversationById(conversationId).catch(() => null);
  if (stale) {
    logger.warn(
      { conversationId, staleArchivedAt: stale.archived_at, staleReason: stale.archive_reason },
      'Archive DB holds a stale-generation row for this id — purging before hard-move'
    );
    await archiveDb.purgeConversation(conversationId);
  }

  const counts = await archiveDb.copyConversationIn(conversationId, {
    archiveReason: reason,
    archivedBy: archivedBy ?? actorUser?.id ?? req?.user?.id ?? null,
    tombstone,
  });

  // 2. Delete rows from the active DB (FK cascade clears children).
  await db.run('DELETE FROM conversations WHERE id = ?', [conversationId]);

  // 3. Move attachment files to the archive tree. Row sets have already
  // moved, so the authoritative attachment list now lives in the archive DB.
  const archAttachments = await archiveDb.getAttachments(conversationId).catch(() => []);
  const { moved, failed } = moveConversationFiles(archAttachments, 'archive');

  // 4. Bookkeeping: activity log, WS event, badge refresh.
  await logChange({
    entityType: 'conversation',
    entityId: String(conversationId),
    action: 'archive',
    userId: actorUser?.id ?? req?.user?.id ?? null,
    userName: actorUser?.name ?? req?.user?.name ?? null,
    ipAddress: req?.ip ?? null,
    changes: { title: { old: conversation.title, new: null } },
    metadata: {
      mode: 'hard-move',
      reason: reason || null,
      message_count: counts.conversation_messages || 0,
      attachment_count: counts.message_attachments || 0,
      files_moved: moved,
      files_failed: failed,
    },
  });

  broadcastToConversation(conversationId, { type: 'conversation:archived', conversationId });
  // Participant rows have already moved to the archive DB — notify them from
  // the archived copy so their sidebars refresh.
  try {
    const archivedParts = await archiveDb.getParticipants(conversationId).catch(() => []);
    for (const p of archivedParts) {
      pushToUser(p.user_id, { type: 'conversation-archived', conversationId, title: conversation.title });
    }
  } catch {}

  scheduleVacuum('archive-conversation');
  return { conversationId, counts, moved, failed, title: conversation.title };
}

/**
 * Restore an archived (or recycle-binned) conversation back into the active
 * DB. Clears the deleted tombstone. Inverse of archiveConversation.
 */
export async function restoreConversation(id, { actorUser = null, req = null } = {}) {
  const db = await getDb();
  const conversationId = Number(id);

  const archived = await archiveDb.getConversationById(conversationId);
  if (!archived) {
    const err = new Error('Conversation not found in archive');
    err.status = 404;
    throw err;
  }

  const exists = await db.get('SELECT id FROM conversations WHERE id = ?', [conversationId]);
  if (exists) {
    const err = new Error('Conversation already exists in the active database');
    err.status = 409;
    throw err;
  }

  // 0. Snapshot the attachment list while the archive rows still exist —
  // purge below deletes them and we need file names for the move step.
  const attachments = await archiveDb.getAttachments(conversationId).catch(() => []);

  // 0.5 Pre-move collision audit (BEFORE any DB mutation): under the
  // one-tree invariant a restore can only see each file in the archive tree
  // (source present + destination present = foreign clobber). Refusing here
  // keeps the archive rows intact for a clean retry after the operator
  // clears the collision — the previous behavior purged rows first and
  // turned the refusal into an unrecoverable orphan.
  const { assertNoFileCollisions } = await import('../utils/uploadPaths.js');
  assertNoFileCollisions(attachments, 'restore');

  // 1. Copy rows back into the active DB inside a transaction — a failure
  // mid-copy must roll back, never leave a half-restored conversation.
  const { withTransaction } = await import('../db/transactions.js');
  await withTransaction(db, async () => {
    await archiveDb.copyConversationOut(conversationId);
  });

  // 2. Remove rows from the archive DB (own transaction — safe after the
  // active-side commit).
  await archiveDb.purgeConversation(conversationId);

  // 3. Move files back to the active tree (based on the snapshot). The
  // pre-audit above guarantees every destination is free.
  const { moved, failed } = moveConversationFiles(attachments, 'restore');

  await logChange({
    entityType: 'conversation',
    entityId: String(conversationId),
    action: 'restore',
    userId: actorUser?.id ?? req?.user?.id ?? null,
    userName: actorUser?.name ?? req?.user?.name ?? null,
    ipAddress: req?.ip ?? null,
    changes: { title: { old: null, new: archived.title } },
    metadata: { files_moved: moved, files_failed: failed },
  });

  broadcastToConversation(conversationId, { type: 'conversation:restored', conversationId });
  scheduleVacuum('restore-conversation');
  return { conversationId, moved, failed, title: archived.title };
}

/**
 * Recycle-bin soft delete (root): rows move to the archive DB with
 * deleted_at/deleted_by set. Restorable until retention purge.
 */
export async function softDeleteConversation(id, { actorUser = null, req = null } = {}) {
  const db = await getDb();
  const conversationId = Number(id);

  const conversation = await db.get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  if (!conversation) {
    const err = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }

  const result = await archiveConversation(conversationId, {
    reason: 'deleted',
    archivedBy: actorUser?.id ?? req?.user?.id ?? null,
    actorUser,
    req,
    tombstone: { deleted_at: new Date().toISOString(), deleted_by: actorUser?.id ?? req?.user?.id ?? null },
  });

  // Prune notifications pointing at the deleted conversation — their deep
  // links now lead to a root-only archive read, and SQLite rowid reuse would
  // otherwise attach stale notifications to a future conversation with the
  // same id.
  try {
    await db.run(
      'DELETE FROM notifications WHERE link LIKE ? OR link LIKE ?',
      [`%c=${conversationId}&%`, `%c=${conversationId}`]
    );
  } catch (err) {
    logger.warn({ err, conversationId }, 'Failed to prune notifications for deleted conversation');
  }

  await logChange({
    entityType: 'conversation',
    entityId: String(conversationId),
    action: 'delete',
    userId: actorUser?.id ?? req?.user?.id ?? null,
    userName: actorUser?.name ?? req?.user?.name ?? null,
    ipAddress: req?.ip ?? null,
    changes: { title: { old: conversation.title, new: null } },
    metadata: { mode: 'recycle-bin', restorable_days_setting: 'conversation_retention_days' },
  });

  return result;
}

/**
 * Permanent delete (root): purges archive rows + files. Only for
 * conversations already in the archive (or recycle bin).
 */
export async function purgeArchivedConversation(id, { actorUser = null, req = null } = {}) {
  const conversationId = Number(id);
  const archived = await archiveDb.getConversationById(conversationId);
  if (!archived) {
    const err = new Error('Conversation not found in archive');
    err.status = 404;
    throw err;
  }

  const attachments = await archiveDb.getAttachments(conversationId).catch(() => []);

  // ── Per-tree ownership audit (cross-conversation collision guard) ──
  // Basenames are the file identity in the flat storage layout. Before
  // deleting anything, check who else references each basename in the
  // ACTIVE DB (its rows would sit in the active tree) and in the ARCHIVE
  // DB (the archive tree). A tree is only safe to clean when we are the
  // sole owner there. Collisions cannot arise through the API (ID-unique,
  // INSERT-not-REPLACE), but seeded/imported data or a future bug could
  // create one — refuse loudly instead of destroying a foreign file.
  const { getConnection } = await import('../db/connection.js');
  const activeDb = await getConnection();
  const trees = [
    { name: 'active', dir: activeConversationsDir(), db: activeDb, sql: `SELECT COUNT(*) AS n FROM message_attachments WHERE replace(file_path, char(92), '/') LIKE '%' || '/' || ?` },
    { name: 'archive', dir: archiveConversationsDir(), db: null, sql: null },
  ];
  for (const t of trees) {
    for (const att of attachments) {
      const rel = String(att.file_path || '').replace(/\\/g, '/');
      const base = path.basename(rel);
      if (!base) continue;
      let others = 0;
      try {
        others = t.name === 'active'
          ? (await activeDb.get(t.sql, [base]))?.n ?? 0
          : Math.max(0, ((await archiveDb.countAttachmentBasenames(base)) ?? 1) - 1);
      } catch (err) {
        logger.warn({ err, tree: t.name, base }, 'Ownership probe failed during purge — assuming shared');
        others = 1; // fail-safe: treat as shared
      }
      if (others > 0) {
        const err = new Error(`Refusing purge: attachment "${base}" is also referenced by another conversation (${t.name} DB) — delete it manually after verifying ownership`);
        err.status = 409;
        logger.error({ conversationId, base, tree: t.name, others }, err.message);
        throw err;
      }
    }
  }

  await archiveDb.purgeConversation(conversationId);

  let filesDeleted = 0;
  for (const att of attachments) {
    const rel = String(att.file_path || '').replace(/\\/g, '/');
    const base = path.basename(rel);
    if (!base) continue;
    // The audit above proved both trees ours: remove our file from wherever
    // it exists, then the mirrored tree's copy.
    for (const p of [path.join(activeConversationsDir(), base), path.join(archiveConversationsDir(), base)]) {
      try {
        if (fs.existsSync(p)) { fs.unlinkSync(p); filesDeleted++; }
      } catch (err) {
        logger.warn({ err, file: base }, 'Failed to delete attachment file during purge');
      }
    }
  }

  await logChange({
    entityType: 'conversation',
    entityId: String(conversationId),
    action: 'purge',
    userId: actorUser?.id ?? req?.user?.id ?? null,
    userName: actorUser?.name ?? req?.user?.name ?? null,
    ipAddress: req?.ip ?? null,
    changes: { title: { old: archived.title, new: null } },
    metadata: { files_deleted: filesDeleted },
  });

  scheduleVacuum('purge');
  return { conversationId, title: archived.title, filesDeleted };
}

// ─────────────────────────────────────────────────────────────────
// Storage stats (root)
// ─────────────────────────────────────────────────────────────────

export async function getStorageStats() {
  const db = await getDb();
  const { getConnection } = await import('../db/connection.js');
  const { statSync } = fs;

  const dirSize = (dir) => {
    let total = 0;
    const walk = (d) => {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          try { total += statSync(p).size; } catch {}
        }
      }
    };
    walk(dir);
    return total;
  };

  const mainStats = await db.get(
    `SELECT
      (SELECT COUNT(*) FROM conversations) as active_conversations,
      (SELECT COUNT(*) FROM conversation_messages) as active_messages,
      (SELECT COALESCE(SUM(file_size), 0) FROM message_attachments) as active_attachments_bytes,
      (SELECT COUNT(*) FROM message_attachments) as active_attachments`
  );

  const archiveStats = await archiveDb.listArchived({ includeDeleted: true, limit: 1 });

  const raw = await getConnection();
  const mainDbSize = (await raw.get('PRAGMA page_count')).page_count * (await raw.get('PRAGMA page_size')).page_size;

  let archiveDbSize = 0;
  try {
    const { archiveDbPath } = await import('../db/archiveDb.js');
    archiveDbSize = statSync(archiveDbPath()).size;
  } catch {}

  const activeUploadsBytes = dirSize(activeConversationsDir());
  const archiveUploadsBytes = dirSize(archiveConversationsDir());

  const quotaMb = await getQuotaMb();

  return {
    main_db: {
      size_bytes: mainDbSize,
      conversations: mainStats.active_conversations,
      messages: mainStats.active_messages,
      attachments: mainStats.active_attachments,
      attachments_bytes: mainStats.active_attachments_bytes,
    },
    archive_db: {
      size_bytes: archiveDbSize,
      conversations: archiveStats.total,
    },
    uploads: {
      active_bytes: activeUploadsBytes,
      archive_bytes: archiveUploadsBytes,
    },
    quota: quotaMb > 0
      ? {
          mb: quotaMb,
          used_bytes: activeUploadsBytes + archiveUploadsBytes,
          usage_ratio: (activeUploadsBytes + archiveUploadsBytes) / (quotaMb * 1024 * 1024),
        }
      : null,
  };
}

async function getQuotaMb() {
  const db = await getDb();
  const row = await db.get(`SELECT value FROM system_settings WHERE key = 'conversation_storage_quota_mb'`);
  return parseInt(row?.value || '0', 10) || 0;
}

/** Public accessor for other services (quota check on send). */
export function getQuotaMbPublic() {
  return getQuotaMb();
}

// ─────────────────────────────────────────────────────────────────
// Retention purge (recycle bin → gone forever)
// ─────────────────────────────────────────────────────────────────

/**
 * Purge soft-deleted conversations older than `retentionDays`. Called by the
 * daily scheduler. Returns summary; never throws (scheduler-safe).
 */
export async function purgeExpiredDeleted(retentionDays, { actorUser = null } = {}) {
  const archived = await archiveDb.listArchived({ includeDeleted: true, limit: 1000 });
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const expired = archived.conversations.filter(
    (c) => c.deleted_at && new Date(c.deleted_at).getTime() < cutoff
  );

  const purged = [];
  for (const conv of expired) {
    try {
      const result = await purgeArchivedConversation(conv.id, { actorUser });
      purged.push(result);
    } catch (err) {
      logger.error({ err, conversationId: conv.id }, 'Retention purge failed for conversation');
    }
  }

  if (purged.length) {
    await logChange({
      entityType: 'conversation',
      entityId: '*',
      action: 'retention_purge',
      userId: actorUser?.id ?? null,
      userName: actorUser?.name ?? 'system',
      changes: null,
      metadata: { purged_count: purged.length, retention_days: retentionDays },
    });
    // Notify root(s) with a summary.
    try {
      await emitNotification('conversation:retention-purged', {
        purgedCount: purged.length,
        retentionDays,
      });
    } catch {}
  }

  return { purgedCount: purged.length, purged };
}

/**
 * Archive retention purge: permanently delete ARCHIVED conversations whose
 * archived_at is older than `days` days. Recycle-binned conversations are
 * excluded here — their deleted_at tombstone is governed by the separate
 * recycle-bin retention (purgeExpiredDeleted), which is always the later of
 * the two clocks for a binned row.
 *
 * days <= 0 disables the purge — the seeded setting default '0' keeps
 * archives forever, making this opt-in.
 */
export async function purgeExpiredArchived(days, { actorUser = null } = {}) {
  if (!days || days <= 0) return { purgedCount: 0, purged: [] };
  const archived = await archiveDb.listArchived({ includeDeleted: false, limit: 1000 });
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const expired = archived.conversations.filter(
    (c) => !c.deleted_at && c.archived_at && new Date(c.archived_at).getTime() < cutoff
  );

  const purged = [];
  for (const conv of expired) {
    try {
      const result = await purgeArchivedConversation(conv.id, { actorUser });
      purged.push(result);
    } catch (err) {
      logger.error({ err, conversationId: conv.id }, 'Archive retention purge failed for conversation');
    }
  }

  if (purged.length) {
    await logChange({
      entityType: 'conversation',
      entityId: '*',
      action: 'archive_retention_purge',
      userId: actorUser?.id ?? null,
      userName: actorUser?.name ?? 'system',
      changes: null,
      metadata: { purged_count: purged.length, retention_days: days },
    });
    // Notify root(s) with a summary.
    try {
      await emitNotification('conversation:archive-retention-purged', {
        purgedCount: purged.length,
        retentionDays: days,
      });
    } catch {}
  }

  return { purgedCount: purged.length, purged };
}

// ─────────────────────────────────────────────────────────────────
// Auto-archive scheduler
// ─────────────────────────────────────────────────────────────────

let autoArchiveTimer = null;

/** Daily scheduler: auto-archive idle conversations, purge expired deletes, quota check. */
export function startAutoArchiveScheduler() {
  if (autoArchiveTimer) clearInterval(autoArchiveTimer);
  autoArchiveTimer = setInterval(async () => {
    try {
      await runAutoArchiveOnce();
    } catch (err) {
      logger.error({ err }, 'Auto-archive scheduler tick failed');
    }
  }, 6 * 60 * 60 * 1000); // every 6h — cheap, idempotent
  autoArchiveTimer.unref();
}

export function stopAutoArchiveScheduler() {
  if (autoArchiveTimer) clearInterval(autoArchiveTimer);
  autoArchiveTimer = null;
}

/**
 * One scheduler pass: reads settings, auto-archives idle conversations,
 * purges expired recycle-bin entries, purges expired archives when the
 * (opt-in) archive retention is set, warns on quota. Safe to call manually
 * (used by tests + the Settings "Run now" button).
 */
export async function runAutoArchiveOnce({ actorUser = null } = {}) {
  const db = await getDb();

  const getSetting = async (key) => {
    const row = await db.get('SELECT value FROM system_settings WHERE key = ?', [key]);
    return row?.value;
  };

  // ── Auto-archive idle conversations ──
  let archivedCount = 0;
  if ((await getSetting('conversation_auto_archive_enabled')) === '1') {
    const days = parseInt((await getSetting('conversation_auto_archive_days')) || '90', 10);
    const idle = await archiveDb.findIdleConversations(days, 25);
    for (const conv of idle) {
      try {
        await archiveConversation(conv.id, {
          reason: 'auto-archive',
          actorUser,
        });
        archivedCount++;
      } catch (err) {
        logger.error({ err, conversationId: conv.id }, 'Auto-archive failed for conversation');
      }
    }
    if (idle.length) {
      await logChange({
        entityType: 'conversation',
        entityId: '*',
        action: 'auto_archive_run',
        userId: actorUser?.id ?? null,
        userName: actorUser?.name ?? 'system',
        changes: null,
        metadata: { archived_count: idle.length, days },
      });
    }
  }

  // ── Retention purge (recycle bin) ──
  const retentionDays = parseInt((await getSetting('conversation_retention_days')) || '30', 10);
  const purgeResult = await purgeExpiredDeleted(retentionDays, { actorUser });

  // ── Archive retention purge (opt-in; 0 = keep archives forever) ──
  const archiveRetentionDays = parseInt((await getSetting('conversation_archive_retention_days')) || '0', 10);
  const archivePurgeResult = await purgeExpiredArchived(archiveRetentionDays, { actorUser });

  // ── Quota warning ──
  try {
    const stats = await getStorageStats();
    if (stats.quota && stats.quota.usage_ratio >= 0.8) {
      await emitNotification('conversation:quota-warning', {
        usageRatio: stats.quota.usage_ratio,
        usedMb: Math.round(stats.quota.used_bytes / (1024 * 1024)),
        quotaMb: stats.quota.mb,
      });
    }
  } catch (err) {
    logger.warn({ err }, 'Quota check failed');
  }

  // Counts let the Settings "Run now" acknowledgement state what actually
  // happened ("archived 2, purged 1") instead of a bare success.
  return {
    ok: true,
    archivedCount,
    purgedCount: purgeResult?.purgedCount ?? 0,
    archivePurgedCount: archivePurgeResult?.purgedCount ?? 0,
    retentionDays,
    archiveRetentionDays,
  };
}

