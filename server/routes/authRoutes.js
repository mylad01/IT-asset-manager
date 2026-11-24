import express from 'express';
import * as authController from '../controllers/authController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authLimiter, passwordChangeLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validate.js';
import { loginSchema, changePasswordSchema, updatePreferencesSchema } from '../validators/authValidator.js';

const router = express.Router();

router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.put('/change-password', verifyToken, passwordChangeLimiter, validate(changePasswordSchema), authController.changePassword);

// Per-user preference flags (stored on the users row). Any authenticated
// role may read/update their own — no admin gate.
router.get('/preferences', verifyToken, authController.getPreferences);
router.put('/preferences', verifyToken, validate(updatePreferencesSchema), authController.updatePreferences);

export default router;
