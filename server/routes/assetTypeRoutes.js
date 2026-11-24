import express from 'express';
import * as assetTypeController from '../controllers/assetTypeController.js';
import { verifyToken, requireAdmin } from '../middleware/authMiddleware.js';
import validate from '../middleware/validate.js';
import { createAssetTypeSchema } from '../validators/assetTypeValidator.js';

const router = express.Router();

router.get('/', verifyToken, assetTypeController.getAll);
router.post('/', verifyToken, requireAdmin, validate(createAssetTypeSchema), assetTypeController.create);
router.delete('/:id', verifyToken, requireAdmin, assetTypeController.remove);

export default router;
