import { getDb } from '../database.js';
import { withTransaction } from '../db/transactions.js';
import * as conversationModel from '../models/conversationModel.js';
import * as participantModel from '../models/conversationParticipantModel.js';
import * as messageModel from '../models/conversationMessageModel.js';
import * as attachmentModel from '../models/messageAttachmentModel.js';
import * as reactionModel from '../models/messageReactionModel.js';
import * as readModel from '../models/conversationReadModel.js';
import { logChange } from './activityLogService.js';
import AppError from '../utils/AppError.js';
import { broadcastToConversation, pushUnreadCount } from './wsServer.js';
import { emit as emitNotification } from './notificationEvents.js';
import { resolveMentions } from '../utils/mentions.js';
import { toRelativeUploadPath, resolveAttachmentPath } from '../utils/uploadPaths.js';
import { attachmentKind } from '../models/conversationMessageModel.js';
import {
  archiveConversation as engineArchive,
  restoreConversation as engineRestore,
  softDeleteConversation as engineSoftDelete,
  purgeArchivedConversation as enginePurge,
  getStorageStats as engineStorageStats,
} from './conversationArchiveService.js';
import * as archiveDb from '../db/archiveDb.js';
import * as oversightModel from '../models/conversationOversightModel.js';

export async function getConversations(userId, filters) {
  // v2 hard-move: archived conversations physically leave the active DB, so
  // the legacy `archived` filter is gone. Tolerate it silently for callers
  // that still send `archived=true` (old clients / stale tests).
  const { archived: _ignored, ...rest } = filters || {};
  return conversationModel.getAll(userId, rest);
}

export async function getConversationById(id) {
  return conversationModel.getById(id);
}

export async function updateConversation(id, { title }) {
  await conversationModel.update(id, { title });
  return conversationModel.getById(id);
}

export async function createConversation({ title, type, ticketId, createdBy, participantIds }, req) {
  // One chat per ticket is DB-enforced (uq_conversations_ticket) and
  // getByTicketId works again after the vocabulary migration — so a second
  // create for the same ticket returns the EXISTING conversation instead of
  // racing the unique index. Mirrors createTicketConversation's dedupe.
  if (ticketId != null) {
    const existing = await conversationModel.getByTicketId(ticketId);
    if (existing) return conversationModel.getById(existing.id);
  }

  const db = await getDb();
  let conversationId;

  await withTransaction(db, async () => {
    conversationId = await conversationModel.create({ title, type, ticketId, createdBy });
    const allParticipants = [...new Set([createdBy, ...participantIds])];
    await participantModel.addParticipants(conversationId, allParticipants, 'admin');
  });

  await logChange({
    entityType: 'conversation',
    entityId: String(conversationId),
    action: 'create',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: { title: { old: null, new: title }, type: { old: null, new: type } },
  });

  const conversation = await conversationModel.getById(conversationId);
  return conversation;
}

export async function createTicketConversation(ticketId, req) {
  const db = await getDb();
  const ticket = await db.get('SELECT * FROM tickets WHERE id = ?', [ticketId]);
  if (!ticket) return null;

  const existing = await conversationModel.getByTicketId(ticketId);
  if (existing) return conversationModel.getById(existing.id);

  const rootAdmin = await db.get('SELECT id FROM users WHERE is_root = 1 LIMIT 1');
  const participantIds = [ticket.user_id];
  if (ticket.assigned_admin_id) participantIds.push(ticket.assigned_admin_id);
  if (rootAdmin) participantIds.push(rootAdmin.id);

  return createConversation({
    title: `RE: ${ticket.title}`,
    type: 'ticket-linked',
    ticketId,
    createdBy: req?.user?.id,
    participantIds: [...new Set(participantIds)],
  }, req);
}

export async function sendMessage(conversationId, userId, { content, isInternal }, { files = [] } = {}) {
  const db = await getDb();
  let messageId;

  // Reject messages that are empty overall — the schema keeps a length cap
  // on content but cannot see uploaded files (multipart is parsed by multer
  // before validation), so the "nothing to send" check lives here.
  if (!(content || '').trim() && files.length === 0) {
    throw new AppError('Message cannot be empty.', 400);
  }

  await withTransaction(db, async () => {
    messageId = await messageModel.create(conversationId, { userId, content, isInternal });
    // Persist attachment rows for the files multer already wrote to disk.
    // Paths are normalized to the canonical uploads-relative form so they
    // survive archive/restore file moves (hard-move v2 invariant).
    for (const file of files) {
      await attachmentModel.create(messageId, {
        filename: file.originalname,
        filePath: toRelativeUploadPath(file.path),
        fileSize: file.size,
        mimeType: file.mimetype,
      });
    }
    await readModel.upsert(conversationId, userId);
  });

  const message = await messageModel.getById(messageId);
  const participantIds = await participantModel.getParticipantUserIds(conversationId);

  // getById does not join attachments — merge them so the sender's HTTP
  // response matches the shape of GET /messages rows (attachments array,
  // id-addressed streaming URLs).
  const attachments = await attachmentModel.getByMessage(messageId);
  message.attachments = attachments.map(a => ({
    id: a.id,
    filename: a.filename,
    kind: attachmentKind(a.mime_type),
    url: `/api/conversations/messages/${messageId}/attachments/${a.id}`,
    file_size: a.file_size,
    mime_type: a.mime_type,
  }));

  // Roster for @mention resolution — getByConversation returns participant
  // rows (id = participant PK), so map to { id: user_id, name } explicitly.
  const roster = (await participantModel.getByConversation(conversationId))
    .map(p => ({ id: p.user_id, name: p.name }));
  const mentionedUserIds = resolveMentions(content, roster);

  // Broadcast to WebSocket participants (exclude sender — they get the message via HTTP response)
  const senderSockets = await db.get('SELECT name FROM users WHERE id = ?', [userId]);
  broadcastToConversation(conversationId, {
    type: 'conversation:message',
    conversationId,
    // mentions = resolved user ids, so clients can highlight @names
    message: { ...message, mentions: mentionedUserIds },
  });

  // Emit notification to other participants. A direct @mention replaces the
  // generic new-message notification for that user (one notification per
  // user per message) with a higher-priority "X mentioned you" variant.
  const otherParticipantIds = participantIds.filter(id => id !== userId);
  if (otherParticipantIds.length > 0) {
    const conversation = await conversationModel.getById(conversationId);
    const senderName = senderSockets?.name || 'Someone';
    for (const pid of otherParticipantIds) {
      const eventName = mentionedUserIds.includes(pid)
        ? 'conversation:mentioned'
        : 'conversation:message';
      await emitNotification(eventName, {
        userId: pid,
        senderName,
        conversationId,
        // Enables the &m=<id> deep link: the workspace scrolls to and
        // highlights the referenced message after navigating from a
        // notification click.
        messageId,
        conversationTitle: conversation?.title || 'Conversation',
        messagePreview: (content || '').slice(0, 100),
      });
      // Live-update the nav unread badge for each recipient.
      pushUnreadCount(pid, await conversationModel.getTotalUnreadCount(pid));
    }
  }

  // The sender's own read-state was upserted in the transaction — refresh their badge too.
  pushUnreadCount(userId, await conversationModel.getTotalUnreadCount(userId));

  return { message, participantIds, mentionedUserIds };
}

export async function editMessage(messageId, userId, content, _req) {
  const message = await messageModel.getById(messageId);
  if (!message) throw new AppError('Message not found', 404);
  if (message.user_id !== userId) throw new AppError('Can only edit your own messages', 403);

  await messageModel.update(messageId, { content });
  const updated = await messageModel.getById(messageId);
  // Broadcast so other participants (and this sender's other panels) see the
  // edit live instead of only after a refetch.
  broadcastToConversation(updated.conversation_id, {
    type: 'conversation:message-edited',
    conversationId: updated.conversation_id,
    message: updated,
  });
  return updated;
}

export async function deleteMessage(messageId, req) {
  const message = await messageModel.getById(messageId);
  if (!message) throw new AppError('Message not found', 404);
  // v2: messages are tombstoned (oversight/audit keeps them); the DB row and
  // attachment files survive so the archive DB copy stays complete.
  await messageModel.softDelete(messageId, req?.user?.id);
  broadcastToConversation(message.conversation_id, {
    type: 'conversation:message-deleted',
    conversationId: message.conversation_id,
    messageId: message.id,
  });
  return message;
}

export async function addReaction(messageId, userId, emoji) {
  const added = await reactionModel.add(messageId, userId, emoji);
  if (added) {
    const message = await messageModel.getById(messageId);
    // Broadcast so every room member (including the sender — no local optimistic
    // update exists) applies the reaction live via the ChatPanel WS handler.
    const user = await (await getDb()).get('SELECT name FROM users WHERE id = ?', [userId]);
    broadcastToConversation(message.conversation_id, {
      type: 'conversation:reaction-added',
      conversationId: message.conversation_id,
      // message.id is numeric (SQLite PK); the raw route param is a string and
      // would never match the numeric message ids the client holds.
      messageId: message.id,
      emoji,
      userId,
      userName: user?.name || 'Someone',
    });
    return { success: true, conversationId: message.conversation_id };
  }
  return { success: false };
}

export async function removeReaction(messageId, userId, emoji) {
  const existing = await reactionModel.hasReacted(messageId, userId, emoji);
  if (!existing) {
    const anyReaction = await reactionModel.getByMessage(messageId);
    const hasReaction = anyReaction.some(r => r.emoji === emoji);
    if (hasReaction) {
      throw new AppError('You can only remove your own reactions', 403);
    }
    return { success: false };
  }
  const removed = await reactionModel.remove(messageId, userId, emoji);
  if (removed) {
    const message = await messageModel.getById(messageId);
    broadcastToConversation(message.conversation_id, {
      type: 'conversation:reaction-removed',
      conversationId: message.conversation_id,
      messageId: message.id,
      emoji,
      userId,
    });
    return { success: true, conversationId: message.conversation_id };
  }
  return { success: false };
}

export async function markAsRead(conversationId, userId) {
  await readModel.upsert(conversationId, userId);
  // Keep the nav unread badge in sync after reading.
  pushUnreadCount(userId, await conversationModel.getTotalUnreadCount(userId));
}

export async function getUnreadCount(userId) {
  return conversationModel.getTotalUnreadCount(userId);
}

// ── v2 hard-move archive surface (engine lives in conversationArchiveService) ──

/**
 * Archive (hard-move): rows move to the archive DB, attachment files move to
 * uploads/archive/conversations/. Any admin participant may archive.
 */
export async function archiveConversation(id, req) {
  const conversation = await conversationModel.getById(id);
  if (!conversation) throw new AppError('Conversation not found', 404);
  return engineArchive(id, {
    reason: req?.body?.reason || 'manual',
    actorUser: req?.user || null,
    req,
  });
}

/**
 * Restore: root-only (enforced at the route). Works for archived AND
 * recycle-binned conversations.
 */
export async function unarchiveConversation(id, req) {
  return engineRestore(id, { actorUser: req?.user || null, req });
}

/**
 * Delete: v2 recycle-bin semantics — the conversation's rows move to the
 * archive DB with a deleted_at tombstone and stay restorable until the
 * retention purge. Permanent removal is DELETE /archive/:id (purge).
 */
export async function deleteConversation(id, req) {
  const conversation = await conversationModel.getById(id);
  if (!conversation) throw new AppError('Conversation not found', 404);
  return engineSoftDelete(id, { actorUser: req?.user || null, req });
}

/** Root-only: permanently purge an archived/recycle-binned conversation. */
export async function purgeArchivedConversation(id, req) {
  return enginePurge(id, { actorUser: req?.user || null, req });
}

// ── Archive browsing (root) ──

/**
 * GET /archive list. Enriches the archive rows with live-DB user names (the
 * archive DB has no users table — joining there throws). Also exposes an
 * ids[] short-circuit so a deep-link refresh on a conversation that has
 * since been purged/restored still returns a consistent page.
 */
export async function getArchivedConversations({ search, includeDeleted, page = 1, limit = 50, ids = null }) {
  const db = await getDb();
  let result;
  if (Array.isArray(ids) && ids.length) {
    const conversations = [];
    for (const id of ids) {
      const row = await archiveDb.getConversationById(id);
      if (row) conversations.push(row);
    }
    result = { conversations, total: conversations.length, page: 1, limit: conversations.length || 1 };
  } else {
    result = await archiveDb.listArchived({ search, includeDeleted, page, limit });
  }

  // Name enrichment against the LIVE db (participants + who archived/deleted).
  const allIds = new Set();
  for (const conv of result.conversations) {
    allIds.add(conv.archived_by).add(conv.deleted_by).add(conv.created_by);
  }
  const idList = [...allIds].filter((v) => v != null);
  const nameById = new Map();
  if (idList.length) {
    const placeholders = idList.map(() => '?').join(',');
    const rows = await db.all(`SELECT id, name FROM users WHERE id IN (${placeholders})`, idList);
    for (const r of rows) nameById.set(r.id, r.name);
  }
  const participantNames = new Map();
  for (const conv of result.conversations) {
    const parts = await archiveDb.getParticipants(conv.id).catch(() => []);
    participantNames.set(conv.id, parts.map((p) => nameById.get(p.user_id) || `User #${p.user_id}`).join(', '));
  }
  for (const conv of result.conversations) {
    conv.archived_by_name = nameById.get(conv.archived_by) || null;
    conv.deleted_by_name = nameById.get(conv.deleted_by) || null;
    conv.created_by_name = nameById.get(conv.created_by) || null;
    conv.participant_names = participantNames.get(conv.id) || null;
  }
  return result;
}

/**
 * GET /archive/:id — single archived conversation with enriched participants
 * and a first page of messages (same shape as the active read path).
 */
export async function getArchivedConversation(id, { limit = 50 } = {}) {
  const archived = await archiveDb.getConversationById(Number(id));
  if (!archived) throw new AppError('Conversation not found in archive', 404);

  const db = await getDb();
  const parts = await archiveDb.getParticipants(archived.id).catch(() => []);
  const ids = parts.map((p) => p.user_id);
  const placeholders = ids.length ? ids.map(() => '?').join(',') : 'NULL';
  const userRows = ids.length ? await db.all(`SELECT id, name, email, role FROM users WHERE id IN (${placeholders})`, ids) : [];
  const nameById = new Map(userRows.map((u) => [u.id, u.name]));

  const creator = archived.created_by != null
    ? await db.get('SELECT id, name FROM users WHERE id = ?', [archived.created_by])
    : null;

  const messages = await archiveDb.getMessages(archived.id, { limit });
  // Resolve reaction user names against the live DB (archive has no users).
  const reactionUserIds = [...new Set(messages.flatMap((m) => (m.reactions || []).flatMap((r) => r.users.map((u) => u.id))))];
  let reactionNames = new Map();
  if (reactionUserIds.length) {
    const ph = reactionUserIds.map(() => '?').join(',');
    reactionNames = new Map((await db.all(`SELECT id, name FROM users WHERE id IN (${ph})`, reactionUserIds)).map((u) => [u.id, u.name]));
  }
  for (const m of messages) {
    for (const r of m.reactions || []) {
      for (const u of r.users) u.name = reactionNames.get(u.id) || `User #${u.id}`;
    }
  }

  return {
    ...archived,
    from_archive: true,
    created_by_name: creator?.name || null,
    // Name enrichment against the live DB (archive has no users table).
    archived_by_name: nameById.get(archived.archived_by) || null,
    deleted_by_name: nameById.get(archived.deleted_by) || null,
    participants: parts.map((p) => ({
      ...p,
      name: nameById.get(p.user_id) || `User #${p.user_id}`,
      user: userRows.find((u) => u.id === p.user_id) || null,
    })),
    messages,
  };
}

// ── Oversight (root) ──

export async function getOversightConversations(filters) {
  const result = await oversightModel.listAllForOversight(filters);
  // Enrich archive-side rows (NULL names from the archive DB) in batch.
  const db = await getDb();
  const needNames = result.conversations.filter((c) => c.from_archive === true);
  const participantIds = await Promise.all(needNames.map((c) => archiveDb.getParticipantIds(c.id).catch(() => [])));
  const ids = [...new Set(needNames.flatMap((c, i) => [c.created_by, ...participantIds[i]]).filter((v) => v != null))];
  if (!ids.length) return result;
  const ph = ids.map(() => '?').join(',');
  const userRows = await db.all(`SELECT id, name FROM users WHERE id IN (${ph})`, ids);
  const nameById = new Map(userRows.map((u) => [u.id, u.name]));
  for (const c of needNames) {
    c.created_by_name = nameById.get(c.created_by) || null;
    const pids = participantIds[needNames.indexOf(c)] || [];
    c.participant_names = pids.map((id) => nameById.get(id) || `User #${id}`).join(', ') || null;
  }
  return result;
}

export async function getOversightSummary() {
  return oversightModel.getOversightSummary();
}

export async function getStorageStats() {
  return engineStorageStats();
}

/** Root opened an archived/any conversation in oversight — audit trail. */
export async function logOversightView(conversationId, user, ip) {
  await logChange({
    entityType: 'conversation',
    entityId: String(conversationId),
    action: 'oversight_view',
    userId: user?.id ?? null,
    userName: user?.name ?? null,
    ipAddress: ip ?? null,
    changes: null,
  });
}

/**
 * Root-only bulk archive. Only conversations still in the active DB are
 * moved; per-id failures are reported (never one bad id failing the batch).
 */
export async function bulkArchiveConversations(ids, req) {
  const results = [];
  for (const id of ids) {
    try {
      const conv = await conversationModel.getById(id);
      if (!conv) throw new AppError('Conversation not found', 404);
      const r = await engineArchive(id, { reason: 'bulk', actorUser: req?.user || null, req });
      results.push({ id, ok: true, ...r });
    } catch (err) {
      results.push({ id, ok: false, error: err.message });
    }
  }
  return { results, archived: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

// ── Search (v2: active + archive union for root) ──

export async function searchAllConversations(query, user) {
  const active = await conversationModel.search(query, user.id);
  let archived = [];
  if (user.isRoot && query) {
    archived = await archiveDb.searchArchiveConversations(query).catch(() => []);
  }
  // One type for the marker across the union: archive rows arrive with
  // from_archive: true (archiveDb.searchArchiveConversations), active rows get
  // the matching false here instead of an absent key.
  return [...active.map((c) => ({ ...c, from_archive: false })), ...archived];
}

// ── Conversation bundle export (single + bulk ZIP) ──

/**
 * Build an export bundle for one conversation (active or archived). ZIP
 * contains conversation.json (metadata + participants) and messages.json
 * (full history) plus an attachments/ folder with every file.
 */
export async function buildConversationBundle(id) {
  const { default: AdmZip } = await import('adm-zip');
  const fs = await import('fs');
  const zip = new AdmZip();

  const activeConv = await conversationModel.getById(id);
  let conv, participants, messages;
  const attachmentRows = [];
  if (activeConv) {
    conv = { ...activeConv, from_archive: false };
    participants = await participantModel.getByConversation(id);
    messages = await messageModel.getAllForExport(id);
    attachmentRows.push(...(await attachmentModel.getByConversation(id)));
  } else {
    const archived = await archiveDb.getConversationById(Number(id));
    if (!archived) throw new AppError('Conversation not found', 404);
    conv = { ...archived, from_archive: true };
    participants = (await archiveDb.getParticipants(id).catch(() => []));
    messages = await archiveDb.getMessages(Number(id), { limit: null });
    attachmentRows.push(...(await archiveDb.getAttachments(Number(id)).catch(() => [])));
  }

  const safeTitle = String(conv.title || `conversation-${id}`).replace(/[^\w\-. ]+/g, '_').slice(0, 60) || `conversation-${id}`;
  zip.addFile('conversation.json', Buffer.from(JSON.stringify({ conversation: conv, participants }, null, 2)));
  zip.addFile('messages.json', Buffer.from(JSON.stringify(messages, null, 2)));

  for (const att of attachmentRows) {
    const abs = resolveAttachmentPath(att.file_path);
    try {
      if (fs.default.existsSync(abs)) {
        const name = `${att.id}_${att.filename}`.replace(/[^\w\-. ]+/g, '_');
        zip.addLocalFile(abs, 'attachments', name);
      }
    } catch {}
  }

  return { zip, basename: safeTitle };
}

export async function exportConversationBundle(id) {
  const { zip, basename } = await buildConversationBundle(id);
  return {
    filename: `${basename}-${id}.zip`,
    buffer: zip.toBuffer(),
    contentType: 'application/zip',
  };
}

export async function exportConversationsBundleZip(ids) {
  const { default: AdmZip } = await import('adm-zip');
  const out = new AdmZip();
  const manifest = [];
  for (const id of ids) {
    try {
      const { zip, basename } = await buildConversationBundle(id);
      out.addFile(`${basename}-${id}.zip`, zip.toBuffer());
      manifest.push({ id, ok: true });
    } catch (err) {
      manifest.push({ id, ok: false, error: err.message });
    }
  }
  out.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  return { buffer: out.toBuffer(), contentType: 'application/zip' };
}

export async function addParticipants(conversationId, userIds, _req) {
  await participantModel.addParticipants(conversationId, userIds);
  return participantModel.getByConversation(conversationId);
}

export async function removeParticipant(conversationId, userId, _req) {
  await participantModel.removeParticipant(conversationId, userId);
  return participantModel.getByConversation(conversationId);
}

export async function getParticipants(conversationId) {
  return participantModel.getByConversation(conversationId);
}

export async function getMessages(conversationId, { before, limit }) {
  // Model returns newest-first (cursor pagination fetches the newest page of a
  // window); the chat UI and export expect chronological order.
  const messages = await messageModel.getByConversation(conversationId, { before, limit });
  return messages.reverse();
}

export async function searchConversations(query, userId) {
  return conversationModel.search(query, userId);
}

export async function exportConversation(id, format) {
  const conversation = await conversationModel.getById(id);
  if (!conversation) throw new Error('Conversation not found');

  const messages = await messageModel.getAllForExport(id);
  const participants = await participantModel.getByConversation(id);

  if (format === 'csv') {
    const headers = ['Timestamp', 'Sender', 'Message', 'Internal', 'Attachments'];
    const rows = messages.map(m => [
      m.created_at,
      m.user_name,
      `"${(m.content || '').replace(/"/g, '""')}"`,
      m.is_internal ? 'Yes' : 'No',
      m.attachment_files || ''
    ]);
    return {
      filename: `conversation-${id}-export.csv`,
      content: [headers.join(','), ...rows.map(r => r.join(','))].join('\n'),
      contentType: 'text/csv'
    };
  }

  return {
    filename: `conversation-${id}-export.json`,
    content: JSON.stringify({ conversation, participants, messages }, null, 2),
    contentType: 'application/json'
  };
}

export async function exportAllConversations(format) {
  const conversations = await conversationModel.getAllForExport();

  if (format === 'csv') {
    const headers = ['ID', 'Title', 'Type', 'Ticket ID', 'Created By', 'Created At', 'Archived'];
    const rows = conversations.map(c => [
      c.id,
      `"${(c.title || '').replace(/"/g, '""')}"`,
      c.type,
      c.ticket_id || '',
      c.creator_name || '',
      c.created_at,
      c.is_archived ? 'Yes' : 'No'
    ]);
    return {
      filename: `all-conversations-export.csv`,
      content: [headers.join(','), ...rows.map(r => r.join(','))].join('\n'),
      contentType: 'text/csv'
    };
  }

  return {
    filename: `all-conversations-export.json`,
    content: JSON.stringify(conversations, null, 2),
    contentType: 'application/json'
  };
}
