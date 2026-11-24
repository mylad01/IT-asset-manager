import express from 'express';
import * as consumableController from '../controllers/consumableController.js';
import { verifyToken, requireAdmin } from '../middleware/authMiddleware.js';
import { writeLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validate.js';
import { createConsumableSchema, adjustStockSchema } from '../validators/consumableValidator.js';

const router = express.Router();

router.get('/', verifyToken, consumableController.getAll);
router.post('/', verifyToken, requireAdmin, writeLimiter, validate(createConsumableSchema), consumableController.create);
router.put('/:id/stock', verifyToken, requireAdmin, writeLimiter, validate(adjustStockSchema), consumableController.adjustStock);
router.delete('/:id', verifyToken, requireAdmin, consumableController.remove);

export default router;
