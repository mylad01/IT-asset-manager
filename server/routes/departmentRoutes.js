import express from 'express';
import * as departmentController from '../controllers/departmentController.js';
import { verifyToken, requireAdmin } from '../middleware/authMiddleware.js';
import validate from '../middleware/validate.js';
import { createDepartmentSchema } from '../validators/departmentValidator.js';

const router = express.Router();

router.get('/', verifyToken, departmentController.getAll);
router.get('/:id/users', verifyToken, departmentController.getUsersByDept);
router.post('/', verifyToken, requireAdmin, validate(createDepartmentSchema), departmentController.create);
router.delete('/:id', verifyToken, requireAdmin, departmentController.remove);

export default router;
