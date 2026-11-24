import express from 'express';
import * as activityLogController from '../controllers/activityLogController.js';
import { verifyToken, requireAdminOrReadOnly } from '../middleware/authMiddleware.js';
import validate from '../middleware/validate.js';
import { queryLogsSchema } from '../validators/activityLogValidator.js';

const router = express.Router();

router.get('/', verifyToken, requireAdminOrReadOnly, validate(queryLogsSchema, 'query'), activityLogController.queryLogs);
router.get('/export', verifyToken, requireAdminOrReadOnly, validate(queryLogsSchema, 'query'), activityLogController.exportCsv);
router.get('/filters', verifyToken, requireAdminOrReadOnly, activityLogController.getFilterOptions);
router.get('/entity/:type/:id', verifyToken, activityLogController.getEntityTimeline);

export default router;
