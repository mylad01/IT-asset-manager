import express from 'express';
import * as notificationController from '../controllers/notificationController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import validate from '../middleware/validate.js';
import { calendarQuerySchema, searchQuerySchema } from '../validators/notificationValidator.js';

const router = express.Router();

router.get('/', verifyToken, notificationController.getActive);
router.get('/all', verifyToken, notificationController.getAll);
router.get('/unread-count', verifyToken, notificationController.getUnreadCount);
router.get('/calendar', verifyToken, validate(calendarQuerySchema, 'query'), notificationController.getCalendar);
router.get('/search', verifyToken, validate(searchQuerySchema, 'query'), notificationController.searchNotifications);
router.put('/:id/dismiss', verifyToken, notificationController.dismiss);
router.put('/:id/snooze', verifyToken, notificationController.snooze);
router.put('/mark-all-read', verifyToken, notificationController.markAllRead);

export default router;