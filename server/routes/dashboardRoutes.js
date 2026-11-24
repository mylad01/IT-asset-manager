import express from 'express';
import * as dashboardController from '../controllers/dashboardController.js';
import { verifyToken, requireAdminOrReadOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/stats', verifyToken, requireAdminOrReadOnly, dashboardController.getStats);

export default router;
