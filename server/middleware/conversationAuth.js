// conversationAuth.js — membership middleware for conversation routes.
//
// Closes a security gap: previously every conversation route only required
// "is an admin", so ANY admin could read ANY conversation (messages,
// attachments, participants) by ID. This middleware loads the conversation +
// participant roster once and enforces:
//   - participants: full access
//   - root (is_root): bypass — this IS the root oversight privilege
//   - everyone else: 403, even other admins
//
// Attaches to req:
//   req.conversation    — the conversation row (or archive row via loader)
//   req.fromArchive     — true when the conversation lives in the archive DB
//   req.isMember        — boolean (true for participants, root included)
//   req.oversightAccess — true when root is NOT a participant (observer)

import { getDb } from '../database.js';
import * as archiveDb from '../db/archiveDb.js';
import AppError from '../utils/AppError.js';

export async function requireMembership(req, _res, next) {
  try {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new AppError('Invalid conversation id.', 400);
    }

    const db = await getDb();
    const conversation = await db.get('SELECT * FROM conversations WHERE id = ?', [conversationId]);

    // Not in the active DB? Root may still be looking at an archived or
    // soft-deleted conversation (read-only). Load from the archive DB and
    // flag it so downstream handlers behave read-only.
    let fromArchive = false;
    if (!conversation) {
      const archived = await archiveDb.getConversationById(conversationId);
      if (archived) {
        Object.defineProperty(req, 'conversation', { value: archived, configurable: true });
        req.fromArchive = true;
        fromArchive = true;
      }
    } else {
      Object.defineProperty(req, 'conversation', { value: conversation, configurable: true });
    }

    if (!conversation && !fromArchive) {
      throw new AppError('Conversation not found', 404);
    }

    if (req.user.isRoot) {
      const row = await db.get(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
        [conversationId, req.user.id]
      );
      req.isMember = !!row;
      req.oversightAccess = !row;
      return next();
    }

    // Regular admins must be participants. Archive access is root-only
    // (archive browsing endpoints explicitly gate themselves).
    if (fromArchive) {
      throw new AppError('Forbidden: archived conversations are only accessible to Root.', 403);
    }

    const row = await db.get(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, req.user.id]
    );
    if (!row) {
      throw new AppError('Forbidden: you are not a participant of this conversation.', 403);
    }
    req.isMember = true;
    req.oversightAccess = false;
    return next();
  } catch (err) {
    next(err);
  }
}

/**
 * Read-only guard for archived conversations: rejects writes with 409.
 * Used on send/edit/react/delete-message routes; the membership middleware
 * has already attached req.fromArchive.
 */
export function rejectArchived(req, _res, next) {
  if (req.fromArchive) {
    return next(new AppError('This conversation is archived and read-only.', 409));
  }
  // Oversight access (root, non-participant) is read-only by design — the
  // UI hides the composer and actions, but the server is the authority:
  // root must JOIN to participate (that join is itself audit-visible).
  if (req.oversightAccess) {
    return next(new AppError('Read-only oversight access — join the conversation to participate.', 403));
  }
  next();
}

/**
 * Membership guard for MESSAGE-scoped routes (the attachment streaming
 * endpoint lives outside the /:id namespace, so requireMembership's
 * req.params.id lookup cannot apply). Resolves the owning conversation
 * from the message id — active DB first, then the archive DB — and
 * enforces the SAME policy as requireMembership:
 *   - participants: access
 *   - root (is_root): bypass (oversight)
 *   - archived messages: root-only (archive surface is root-only everywhere
 *     else; serving bytes to a non-root former participant would contradict
 *     the recycle-bin policy)
 *   - everyone else: 403
 * Previously this check was hand-rolled inside the controller — correct,
 * but invisible to the middleware chain and drifting from the invariant
 * "membership is enforced everywhere via conversationAuth.js".
 *
 * Attaches to req:
 *   req.messageId       — parsed message id
 *   req.conversationId  — the owning conversation (active or archived)
 *   req.fromArchive     — true when the message lives in the archive DB
 */
export async function requireMessageMembership(req, _res, next) {
  try {
    const messageId = Number(req.params.msgId);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      throw new AppError('Invalid message id.', 400);
    }

    const db = await getDb();
    const msg = await db.get('SELECT conversation_id FROM conversation_messages WHERE id = ?', [messageId]);
    let conversationId = null;
    let fromArchive = false;
    if (msg) {
      conversationId = msg.conversation_id;
    } else {
      const archivedMsg = await archiveDb.getMessageById(messageId).catch(() => null);
      if (archivedMsg) {
        conversationId = archivedMsg.conversation_id;
        fromArchive = true;
      }
    }
    if (conversationId == null) throw new AppError('Message not found', 404);

    if (!req.user.isRoot) {
      if (fromArchive) {
        throw new AppError('Forbidden: archived conversations are only accessible to Root.', 403);
      }
      const row = await db.get(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
        [conversationId, req.user.id]
      );
      if (!row) {
        throw new AppError('Forbidden: you are not a participant of this conversation.', 403);
      }
    }

    req.messageId = messageId;
    req.conversationId = conversationId;
    req.fromArchive = fromArchive;
    return next();
  } catch (err) {
    next(err);
  }
}
