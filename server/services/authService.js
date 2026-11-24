import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as userModel from '../models/userModel.js';
import env from '../config/env.js';
import AppError from '../utils/AppError.js';
import { sanitizePrefs } from '../../shared/preferencesRegistry.js';
import { emit } from './notificationEvents.js';
import { logChange } from './activityLogService.js';

export async function login(email, password, ip) {
  const user = await userModel.getByEmail(email);
  if (!user) {
    await emit('auth:failed-login', { email, ip });
    await logChange({
      entityType: 'auth',
      entityId: email,
      action: 'login',
      userId: null,
      userName: email,
      ipAddress: ip,
      changes: { result: { old: null, new: 'failed' } },
      metadata: { reason: 'invalid email' },
    });
    throw new AppError('Invalid email or password.', 401);
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    await emit('auth:failed-login', { email, ip });
    await logChange({
      entityType: 'auth',
      entityId: email,
      action: 'login',
      userId: user.id,
      userName: user.name,
      ipAddress: ip,
      changes: { result: { old: null, new: 'failed' } },
      metadata: { reason: 'invalid password' },
    });
    throw new AppError('Invalid email or password.', 401);
  }

  const isRoot = user.is_root === 1;
  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email, isRoot },
    env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  await logChange({
    entityType: 'auth',
    entityId: email,
    action: 'login',
    userId: user.id,
    userName: user.name,
    ipAddress: ip,
    changes: { result: { old: null, new: 'success' } },
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      email: user.email,
      requires_password_change: user.requires_password_change,
      isRoot,
    },
  };
}

/* Per-user UI preferences persisted on the users row (users.ui_prefs JSON,
   PLAN.MD §13 P1). Exposed through /api/auth/preferences so any
   authenticated user (any role) can read and update their own settings
   without admin rights. The key/type/default list lives in the preferences
   registry (src/config/preferencesRegistry.js); server-side validation is
   its zod mirror in validators/uiPrefsSchema.js. */
export async function getPreferences(userId) {
  const user = await userModel.getById(userId);
  if (!user) throw new AppError('User not found.', 404);

  // Legacy one-time migration: toastBannersEnabled used to live in its own
  // toast_banners_enabled column (20260917-toast-banner-pref). The first
  // read after the ui_prefs column lands folds that value into the blob;
  // the old column stays where it is (harmless, other tooling may read it)
  // but the blob is authoritative from here on.
  let stored = await userModel.getUiPrefs(userId);
  if (stored.toastBannersEnabled === undefined && user.toast_banners_enabled !== undefined) {
    stored = { ...stored, toastBannersEnabled: user.toast_banners_enabled !== 0 };
    await userModel.setUiPrefs(userId, stored);
  }

  // Sanitize through the registry contract: unknown/corrupt keys drop out,
  // explicit values win, defaults fill the rest — the response shape is
  // ALWAYS the full registered set, never a partial blob.
  const { ok, value, errors } = sanitizePrefs(stored);
  if (!ok) {
    const { default: logger } = await import('../utils/logger.js');
    logger.warn({ userId, errors }, 'ui_prefs held invalid keys — sanitized to registry defaults');
  }
  return value;
}

export async function updatePreferences(userId, updates) {
  const current = await getPreferences(userId); // full sanitized baseline
  const merged = sanitizePrefs({ ...current, ...updates });
  if (!merged.ok) {
    throw new AppError(`Invalid preferences: ${merged.errors.join('; ')}`, 400);
  }
  await userModel.setUiPrefs(userId, merged.value);
  return merged.value;
}

export async function changePassword(userId, newPassword, ip) {
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await userModel.updatePassword(userId, hashedPassword);
  
  const user = await userModel.getById(userId);
  if (user) {
    await emit('auth:password-changed', { userId: user.id });
    await logChange({
      entityType: 'auth',
      entityId: String(userId),
      action: 'update',
      userId: user.id,
      userName: user.name,
      ipAddress: ip,
      changes: { password: { old: '***', new: '***' } },
      metadata: { actionType: 'password_change' },
    });
  }
}