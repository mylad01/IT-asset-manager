import express from 'express';
import * as userController from '../controllers/userController.js';
import { verifyToken, requireAdmin } from '../middleware/authMiddleware.js';
import validate from '../middleware/validate.js';
import { createUserSchema, updateUserSchema } from '../validators/userValidator.js';

const router = express.Router();

router.get('/admins', verifyToken, userController.getAdmins);
router.get('/', verifyToken, userController.getAll);
router.get('/:id/assets', verifyToken, userController.getAssetsByUser);
router.post('/', verifyToken, requireAdmin, validate(createUserSchema), userController.create);
router.put('/:id', verifyToken, requireAdmin, validate(updateUserSchema), userController.update);
router.delete('/:id', verifyToken, requireAdmin, userController.remove);

export default router;
