import * as conversationService from '../services/conversationService.js';
import * as conversationBackupService from '../services/conversationBackupService.js';
import * as archiveDb from '../db/archiveDb.js';
import { resolveAttachmentPath } from '../utils/uploadPaths.js';
import { findOverCapFiles } from '../config/conversationUpload.js';
import { getDb } from '../database.js';
import AppError from '../utils/AppError.js';

export async function list(req, res) {
  const result = await conversationService.getConversations(req.user.id, req.validated);
  res.json(result);
}

/**
 * GET /archive — root-only list of hard-moved + recycle-binned
 * conversations. Browsing the archive IS the root capability (the route is
 * already requireRoot), so no ids/search scoping beyond pagination.
 */
export async function listArchived(req, res) {
  let ids = null;
  if (req.query.ids) {
    ids = String(req.query.ids).split(',').map((v) => parseInt(v, 10)).filter(Number.isInteger);
  }
  const result = await conversationService.getArchivedConversations({
    search: req.query.search || undefined,
    includeDeleted: req.query.includeDeleted === 'true',
    page: parseInt(req.query.page, 10) || 1,
    limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
    ids,
  });
  res.json(result);
}

export async function getArchived(req, res) {
  const detail = await conversationService.getArchivedConversation(req.params.id, {
    limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
  });
  // ArchiveBrowser contract: { conversation: {…}, messages: […] }
  const { messages, ...conversation } = detail;
  res.json({ conversation, messages });
}

export async function purgeArchived(req, res) {
  await conversationService.purgeArchivedConversation(req.params.id, req);
  res.json({ message: 'Conversation permanently deleted' });
}

export async function getById(req, res) {
  const conversation = await conversationService.getConversationById(req.params.id);
  // v2: archived conversations remain openable via deep link (the UI calls
  // GET /:id for archived items too) — serve the archive copy read-only.
  if (!conversation) {
    const archived = await conversationService.getArchivedConversation(req.params.id, {
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
    }).catch(() => null);
    if (archived) return res.json(archived);
  }
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  res.json(conversation);
}

export async function create(req, res) {
  const conversation = await conversationService.createConversation({
    ...req.validated,
    createdBy: req.user.id,
  }, req);
  res.status(201).json(conversation);
}

export async function createTicketConversation(req, res) {
  const conversation = await conversationService.createTicketConversation(req.params.ticketId, req);
  if (!conversation) throw new AppError('Ticket not found', 404);
  res.status(201).json(conversation);
}

export async function update(req, res) {
  const existing = await conversationService.getConversationById(req.params.id);
  if (!existing) throw new AppError('Conversation not found', 404);
  const conversation = await conversationService.updateConversation(req.params.id, req.validated);
  res.json(conversation);
}

export async function archive(req, res) {
  await conversationService.archiveConversation(req.params.id, req);
  res.json({ message: 'Conversation archived' });
}

export async function unarchive(req, res) {
  await conversationService.unarchiveConversation(req.params.id, req);
  res.json({ message: 'Conversation unarchived' });
}

export async function remove(req, res) {
  // v2: delete = recycle-bin soft delete (rows + files move to the archive
  // DB with a tombstone; restorable until retention purge).
  await conversationService.deleteConversation(req.params.id, req);
  res.json({ message: 'Conversation moved to recycle bin' });
}

export async function search(req, res) {
  const results = await conversationService.searchAllConversations(req.query.q || '', req.user);
  res.json(results);
}

export async function listParticipants(req, res) {
  const participants = await conversationService.getParticipants(req.params.id);
  res.json(participants);
}

export async function addParticipants(req, res) {
  const participants = await conversationService.addParticipants(req.params.id, req.validated.userIds, req);
  res.json(participants);
}

export async function removeParticipant(req, res) {
  const participants = await conversationService.removeParticipant(req.params.id, req.params.userId, req);
  res.json(participants);
}

export async function getMessages(req, res) {
  const messages = await conversationService.getMessages(req.params.id, req.validated);
  res.json(messages);
}

/**
 * GET /:id/messages for ARCHIVED conversations — requireMembership attached
 * req.fromArchive; serve a page from the archive DB (root-only by the
 * middleware's archive rule).
 */
export async function getArchivedMessages(req, res) {
  const result = await archiveDb.getMessages(Number(req.params.id), {
    before: req.validated.before,
    limit: req.validated.limit,
  });
  res.json(result);
}

export async function sendMessage(req, res) {
  // Multer has already written uploads to disk by the time anything after it
  // runs; hand the files to the service so attachment rows get persisted.
  const files = req.files || [];
  // Per-kind size caps are enforced here (not in fileFilter) because multer
  // streams the body before sizes are known. Over-cap files are removed.
  const over = findOverCapFiles(files);
  try {
    if (over.length) {
      const fs = await import('fs');
      for (const { file } of over) {
        try { fs.default.unlinkSync(file.path); } catch {}
      }
      const kindLabel = { image: '25 MB', video: '50 MB', doc: '10 MB' };
      throw new AppError(`File too large — ${over[0].file.originalname} exceeds the ${kindLabel[over[0].kind]} limit.`, 413);
    }
    const { message, participantIds, mentionedUserIds } = await conversationService.sendMessage(
      req.params.id,
      req.user.id,
      req.validated,
      { req, files }
    );
    res.status(201).json({ message, participantIds, mentionedUserIds });
  } catch (err) {
    // The message was rejected (validation, permissions, size, …) — the
    // already-uploaded files would otherwise be orphaned on disk forever.
    // Over-cap files were already unlinked above; never double-unlink.
    const overPaths = new Set(over.map(({ file }) => file.path));
    const fs = await import('fs');
    for (const f of files) {
      if (overPaths.has(f.path)) continue;
      try { fs.default.unlinkSync(f.path); } catch {}
    }
    throw err;
  }
}

export async function editMessage(req, res) {
  const message = await conversationService.editMessage(req.params.msgId, req.user.id, req.validated.content, req);
  res.json(message);
}

export async function deleteMessage(req, res) {
  const message = await conversationService.deleteMessage(req.params.msgId, req);
  res.json({ message: 'Message deleted', conversationId: message.conversation_id });
}

export async function addReaction(req, res) {
  const result = await conversationService.addReaction(req.params.msgId, req.user.id, req.validated.emoji);
  res.json(result);
}

export async function removeReaction(req, res) {
  const result = await conversationService.removeReaction(req.params.msgId, req.user.id, req.params.emoji);
  res.json(result);
}

export async function markAsRead(req, res) {
  await conversationService.markAsRead(req.params.id, req.user.id);
  res.json({ message: 'Marked as read' });
}

export async function getUnreadCount(req, res) {
  const count = await conversationService.getUnreadCount(req.user.id);
  res.json({ count });
}

export async function exportConversation(req, res) {
  const { format = 'json' } = req.query;
  if (format === 'zip') {
    const { filename, buffer, contentType } = await conversationService.exportConversationBundle(req.params.id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  }
  const result = await conversationService.exportConversation(req.params.id, format);
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.content);
}

export async function exportAll(req, res) {
  const { format = 'json' } = req.query;
  const result = await conversationService.exportAllConversations(format);
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.content);
}

export async function backup(req, res) {
  const result = await conversationBackupService.runConversationBackup(req.user.id);
  res.json(result);
}

export async function backupHistory(req, res) {
  const limit = parseInt(req.query.limit) || 20;
  const history = await conversationBackupService.getBackupHistory(limit);
  res.json(history);
}

// ── v2: oversight + bulk + attachment streaming ──

export async function oversightList(req, res) {
  const result = await conversationService.getOversightConversations({
    search: req.query.search || undefined,
    type: req.query.type || undefined,
    participantId: req.query.participantId ? parseInt(req.query.participantId, 10) : undefined,
    hasAttachments: req.query.hasAttachments === 'true' ? true : undefined,
    page: parseInt(req.query.page, 10) || 1,
    limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
  });
  res.json(result);
}

export async function oversightSummary(req, res) {
  res.json(await conversationService.getOversightSummary());
}

export async function storageStats(req, res) {
  res.json(await conversationService.getStorageStats());
}

export async function oversightView(req, res) {
  await conversationService.logOversightView(req.params.id, req.user, req.ip);
  res.json({ ok: true });
}

export async function bulkArchive(req, res) {
  const result = await conversationService.bulkArchiveConversations(req.validated.ids, req);
  res.json(result);
}

export async function bulkExport(req, res) {
  const { buffer } = await conversationService.exportConversationsBundleZip(req.validated.ids);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="conversations-export.zip"');
  res.send(buffer);
}

/** * GET /messages/:msgId/attachments/:attachmentId — authenticated,
 * membership-checked attachment download with Range support (video seek).
 * Membership is enforced upstream by the requireMessageMembership
 * middleware (conversationAuth.js) — same policy as every other
 * conversation route: participants + root oversight, archived root-only.
 * This handler stays authoritative for the ATTACHMENT↔MESSAGE pairing and
 * serves from the active tree or the archive tree (per req.fromArchive;
 * conversationArchiveService moves files between them without rewriting
 * DB paths).
 */
export async function streamAttachment(req, res, next) {
  try {
    const msgId = req.messageId;                       // Set by requireMessageMembership
    const attId = parseInt(req.params.attachmentId, 10);
    if (!Number.isInteger(attId)) throw new AppError('Invalid attachment reference.', 400);
    const db = await getDb();
    let att = null;
    if (!req.fromArchive) {
      att = await db.get('SELECT * FROM message_attachments WHERE id = ? AND message_id = ?', [attId, msgId]);
    } else {
      att = await archiveDb.getAttachmentById(attId);
      if (att && att.message_id !== msgId) att = null;
    }
    if (!att) throw new AppError('Attachment not found', 404);

    const abs = resolveAttachmentPath(att.file_path);
    const fs = await import('fs');
    if (!fs.default.existsSync(abs)) throw new AppError('Attachment file missing', 404);
    const stat = fs.default.statSync(abs);
    const mime = att.mime_type || 'application/octet-stream';

    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.filename)}"`);

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        let start = m[1] === '' ? null : parseInt(m[1], 10);
        let end = m[2] === '' ? null : parseInt(m[2], 10);
        if (start == null && end != null) {
          // suffix range: last N bytes
          start = Math.max(0, stat.size - end);
          end = stat.size - 1;
        } else {
          if (start == null) start = 0;
          if (end == null || end >= stat.size) end = stat.size - 1;
        }
        if (start > end || start >= stat.size) {
          res.setHeader('Content-Range', `bytes */${stat.size}`);
          return res.status(416).json({ error: 'Range not satisfiable' });
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        const { createReadStream } = await import('fs');
        const stream = createReadStream(abs, { start, end });
        stream.on('error', (e) => {
          res.destroy();
          next(e);
        });
        return stream.pipe(res);
      }
    }

    res.setHeader('Content-Length', String(stat.size));
    const { createReadStream } = await import('fs');
    const stream = createReadStream(abs);
    stream.on('error', (e) => {
      res.destroy();
      next(e);
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}
