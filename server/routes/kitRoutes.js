import express from 'express';
import * as kitController from '../controllers/kitController.js';
import { verifyToken, requireAdmin, requireAdminOrReadOnly } from '../middleware/authMiddleware.js';
import { writeLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validate.js';
import { createKitSchema, deployKitSchema } from '../validators/kitValidator.js';

const router = express.Router();

router.get('/', verifyToken, requireAdminOrReadOnly, kitController.getAll);
router.get('/:id/preview', verifyToken, requireAdminOrReadOnly, kitController.getPreview);
router.post('/', verifyToken, requireAdmin, writeLimiter, validate(createKitSchema), kitController.create);
router.post('/:id/deploy', verifyToken, requireAdmin, writeLimiter, validate(deployKitSchema), kitController.deploy);
router.delete('/:id', verifyToken, requireAdmin, kitController.remove);

export default router;
