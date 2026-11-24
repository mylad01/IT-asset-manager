import express from 'express';
import { leaveUpload, MAX_FILES, leaveMulterMessage } from '../config/leaveUpload.js';
import * as leaveRequestController from '../controllers/leaveRequestController.js';
import { verifyToken, requireAdmin, requireLeaveSubmitter, requireLeaveReader, requireLeaveApprover } from '../middleware/authMiddleware.js';
import { writeLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validate.js';
import { discardUploaded } from '../utils/uploadSafety.js';
import { createLeaveSchema, onBehalfSchema, decideSchema, coverageQuerySchema, pendingQuerySchema } from '../validators/leaveRequestValidator.js';

const router = express.Router();

// ── Local multer translation (spec §8) ──
// The central errorHandler's LIMIT_FILE_SIZE text is conversation-flavored
// ("videos up to 50 MB, images up to 25 MB…") and would misstate the 10 MB
// leave cap, so the leave routes answer multer failures themselves:
// 413 for size, 400 for everything else.
function runLeaveUpload(req, res, next) {
  leaveUpload.array('attachments', MAX_FILES)(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: leaveMulterMessage(err.code) });
    }
    next();
  });
}

// Multer has already written files by the time validate() parses — a Zod
// rejection (or any sync throw) would orphan them, so every downstream
// failure deletes the uploaded files BEFORE the error propagates.
function withFileCleanup(mw) {
  return (req, res, next) => {
    const done = (err) => {
      if (err) {
        Promise.all((req.files || []).map(f => discardUploaded(f.path))).finally(() => next(err));
        return;
      }
      next();
    };
    try {
      mw(req, res, done);
    } catch (err) {
      done(err); // validate() parses synchronously — its throw must hit cleanup too
    }
  };
}

// Literal routes MUST precede /:id (Express 5 matches in order) — Task 4
// appends the read/decide routes below, keeping this ordering.
router.post('/',
  verifyToken, requireLeaveSubmitter, writeLimiter,
  runLeaveUpload,
  withFileCleanup(validate(createLeaveSchema)),
  leaveRequestController.submit);
router.post('/on-behalf',
  verifyToken, requireAdmin, writeLimiter,
  runLeaveUpload,
  withFileCleanup(validate(onBehalfSchema)),
  leaveRequestController.submitOnBehalf);
router.get('/mine', verifyToken, leaveRequestController.mine);
router.get('/pending', verifyToken, requireLeaveReader, validate(pendingQuerySchema, 'query'), leaveRequestController.pending);
router.get('/pending-count', verifyToken, leaveRequestController.pendingCount);
router.get('/coverage', verifyToken, requireLeaveReader, validate(coverageQuerySchema, 'query'), leaveRequestController.coverage);
router.put('/:id/decide', verifyToken, requireLeaveApprover, writeLimiter, validate(decideSchema), leaveRequestController.decide);
router.get('/:id', verifyToken, leaveRequestController.getById);
router.get('/:id/attachments/:idx', verifyToken, leaveRequestController.downloadAttachment);

export default router;
