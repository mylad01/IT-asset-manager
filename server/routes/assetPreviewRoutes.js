import express from 'express';
import { getPreview } from '../controllers/assetPreviewController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Enriched asset preview — available to all authenticated roles
router.get('/:id/preview', verifyToken, getPreview);

export default router;
