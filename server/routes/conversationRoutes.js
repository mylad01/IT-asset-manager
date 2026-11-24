import express from 'express';
import {
  conversationUpload as upload,
  MAX_FILES,
} from '../config/conversationUpload.js';
import * as conversationController from '../controllers/conversationController.js';
import { verifyToken, requireAdmin, requireRoot } from '../middleware/authMiddleware.js';
import { requireMembership, requireMessageMembership, rejectArchived } from '../middleware/conversationAuth.js';
import { writeLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validate.js';
import {
  createConversationSchema,
  updateConversationSchema,
  addMessageSchema,
  editMessageSchema,
  addParticipantsSchema,
  addReactionSchema,
  conversationQuerySchema,
  messageQuerySchema,
  bulkIdsSchema,
  archiveListQuerySchema,
} from '../validators/conversationValidator.js';

const router = express.Router();

// NOTE: no static express.static mount for uploads/conversations — every
// attachment byte must pass through the membership-checked streaming route
// below (static mount = any admin downloads any conversation's files).

// Non-parameterized routes MUST precede /:id (Express 5 matches in order).

// Archive browsing (root-only; scoped by ids/search inside the controller).
router.get('/archive', verifyToken, requireRoot, validate(archiveListQuerySchema, 'query'), conversationController.listArchived);
router.get('/archive/:id', verifyToken, requireRoot, conversationController.getArchived);
router.delete('/archive/:id', verifyToken, requireRoot, conversationController.purgeArchived);

// Oversight (root-only, audit-logged via /:id/oversight-view).
router.get('/oversight', verifyToken, requireRoot, conversationController.oversightList);
router.get('/oversight/summary', verifyToken, requireRoot, conversationController.oversightSummary);
router.get('/storage-stats', verifyToken, requireRoot, conversationController.storageStats);

// Bulk operations (root).
router.post('/bulk/archive', verifyToken, requireRoot, writeLimiter, validate(bulkIdsSchema), conversationController.bulkArchive);
router.post('/bulk/export', verifyToken, requireRoot, validate(bulkIdsSchema), conversationController.bulkExport);

// Search + export-all (pre-/:id).
router.get('/search', verifyToken, requireAdmin, conversationController.search);
router.get('/export-all', verifyToken, requireRoot, conversationController.exportAll);
// Must be declared before /:id so 'unread-count' is not captured as an id.
router.get('/unread-count', verifyToken, requireAdmin, conversationController.getUnreadCount);

router.get('/', verifyToken, requireAdmin, validate(conversationQuerySchema, 'query'), conversationController.list);
router.post('/', verifyToken, requireAdmin, writeLimiter, validate(createConversationSchema), conversationController.create);
router.post('/ticket/:ticketId', verifyToken, requireAdmin, writeLimiter, conversationController.createTicketConversation);

// ── /:id namespace: every route loads conversation + roster once ──
router.get('/:id', verifyToken, requireAdmin, requireMembership, conversationController.getById);
router.put('/:id', verifyToken, requireAdmin, requireMembership, validate(updateConversationSchema), conversationController.update);
router.put('/:id/archive', verifyToken, requireAdmin, requireMembership, conversationController.archive);
// Restore is root-only by design: after a hard-move there is no participant
// roster left in the active DB, so requireMembership cannot be evaluated.
router.put('/:id/unarchive', verifyToken, requireRoot, conversationController.unarchive);
router.delete('/:id', verifyToken, requireAdmin, requireMembership, conversationController.remove);

router.get('/:id/participants', verifyToken, requireAdmin, requireMembership, conversationController.listParticipants);
router.post('/:id/participants', verifyToken, requireAdmin, requireMembership, writeLimiter, validate(addParticipantsSchema), conversationController.addParticipants);
router.delete('/:id/participants/:userId', verifyToken, requireAdmin, requireMembership, conversationController.removeParticipant);

// Archived conversations are root-only reads (requireMembership 403s
// non-root with fromArchive); the archive branch serves pages from the
// archive DB so history survives the hard-move.
router.get('/:id/messages', verifyToken, requireAdmin, requireMembership, validate(messageQuerySchema, 'query'), (req, res, next) => {
  if (req.fromArchive) return conversationController.getArchivedMessages(req, res, next);
  conversationController.getMessages(req, res, next);
});
// upload MUST run before validate: only multer populates req.body for
// multipart/form-data (the UI always sends FormData), so validating first
// would parse an empty body and reject every real message with a 400.
router.post('/:id/messages',
  verifyToken, requireAdmin, requireMembership, writeLimiter,
  upload.array('attachments', MAX_FILES),
  validate(addMessageSchema),
  rejectArchived,
  conversationController.sendMessage
);
router.put('/:id/messages/:msgId', verifyToken, requireAdmin, requireMembership, rejectArchived, validate(editMessageSchema), conversationController.editMessage);
router.delete('/:id/messages/:msgId', verifyToken, requireAdmin, requireMembership, rejectArchived, conversationController.deleteMessage);

router.post('/:id/messages/:msgId/reactions', verifyToken, requireAdmin, requireMembership, rejectArchived, writeLimiter, validate(addReactionSchema), conversationController.addReaction);
router.delete('/:id/messages/:msgId/reactions/:emoji', verifyToken, requireAdmin, requireMembership, rejectArchived, conversationController.removeReaction);

// Attachment streaming under /messages/:msgId/attachments/:attachmentId —
// outside the /:id namespace so ':id' never captures a message id. This is
// the ONLY path that serves attachment bytes. requireMessageMembership
// (not requireMembership — there is no :id param) resolves the owning
// conversation from the message id and enforces the same policy:
// participants + root oversight; archived messages are root-only.
router.get('/messages/:msgId/attachments/:attachmentId', verifyToken, requireAdmin, requireMessageMembership, conversationController.streamAttachment);

router.put('/:id/read', verifyToken, requireAdmin, requireMembership, conversationController.markAsRead);
router.get('/:id/export', verifyToken, requireAdmin, requireMembership, conversationController.exportConversation);

// Oversight audit trail for opening a conversation.
router.post('/:id/oversight-view', verifyToken, requireRoot, conversationController.oversightView);

router.post('/backup', verifyToken, requireRoot, conversationController.backup);
router.get('/backup/history', verifyToken, requireRoot, conversationController.backupHistory);

export default router;
