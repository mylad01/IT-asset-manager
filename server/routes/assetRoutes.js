import express from 'express';
import * as assetController from '../controllers/assetController.js';
import { getPreview } from '../controllers/assetPreviewController.js';
import { verifyToken, requireAdmin } from '../middleware/authMiddleware.js';
import { writeLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validate.js';
import { createAssetSchema, transferAssetSchema, addLogEntrySchema } from '../validators/assetValidator.js';
import upload from '../config/multer.js';
import { verifyUploadedImage } from '../utils/uploadSafety.js';

const router = express.Router();

router.get('/', verifyToken, assetController.getAll);
router.get('/unassigned', verifyToken, assetController.getUnassigned);
// Enriched preview — MUST come before /:id to avoid catch-all interception
router.get('/:id/preview', verifyToken, getPreview);
router.get('/:id', verifyToken, assetController.getById);
router.get('/:id/history', verifyToken, assetController.getHistory);
router.get('/:id/lifecycle', verifyToken, assetController.getLifecycle);
router.post('/:id/log', verifyToken, requireAdmin, writeLimiter, validate(addLogEntrySchema), assetController.addLogEntry);
router.post('/', verifyToken, requireAdmin, writeLimiter, upload.single('image'), verifyUploadedImage(), validate(createAssetSchema), assetController.create);
// Transfer is an admin-only write like create/delete/log — the missing
// requireAdmin here let ANY role reassign assets (security review 2026-10-12 #2).
router.put('/:id/transfer', verifyToken, requireAdmin, writeLimiter, validate(transferAssetSchema), assetController.transfer);
router.delete('/:id', verifyToken, requireAdmin, assetController.remove);

export default router;
