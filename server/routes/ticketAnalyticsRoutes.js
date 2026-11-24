import express from 'express';
import * as ticketAnalyticsController from '../controllers/ticketAnalyticsController.js';
import { verifyToken, requireAdminOrReadOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', verifyToken, requireAdminOrReadOnly, ticketAnalyticsController.getAnalytics);

export default router;
