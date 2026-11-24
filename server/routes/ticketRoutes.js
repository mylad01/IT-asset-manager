import express from 'express';
import * as ticketController from '../controllers/ticketController.js';
import { verifyToken, requireAdmin } from '../middleware/authMiddleware.js';
import { writeLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validate.js';
import { createTicketSchema, assignAdminSchema, updateTicketStatusSchema, addCommentSchema } from '../validators/ticketValidator.js';

const router = express.Router();

router.get('/my-tickets', verifyToken, ticketController.getMyTickets);
router.post('/', verifyToken, writeLimiter, validate(createTicketSchema), ticketController.create);
router.get('/', verifyToken, requireAdmin, ticketController.getAll);
router.put('/:id/assign', verifyToken, requireAdmin, validate(assignAdminSchema), ticketController.assignAdmin);
router.put('/:id', verifyToken, requireAdmin, validate(updateTicketStatusSchema), ticketController.updateStatus);
router.get('/:id/comments', verifyToken, ticketController.getComments);
router.post('/:id/comments', verifyToken, writeLimiter, validate(addCommentSchema), ticketController.addComment);

export default router;
