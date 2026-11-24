import * as userModel from '../models/userModel.js';
import AppError from '../utils/AppError.js';
import { emit } from './notificationEvents.js';
import { logChange } from './activityLogService.js';
// Note: imported by a route file; the requireAdmin import is unused here but
// kept for future audit. getAll(req) is the only export that inspects req.user.
export async function getAll(req) {
  const users = await userModel.getAll();
  // Non-admin callers (Staff, Read-Only) get field-restricted responses:
  // id/name/role/dept_id/department — no email. Admin/root see the full directory.
  const isAdminOrRoot = req && req.user && (req.user.role === 'IT Admin' || req.user.isRoot);
  if (!isAdminOrRoot) {
    return users.map(({ id, name, role, dept_id, department }) => ({ id, name, role, dept_id, department }));
  }
  return users;
}

export async function getAdmins() {
  return userModel.getAdmins();
}

export async function getAssetsByUser(userId) {
  return userModel.getAssetsByUser(userId);
}

export async function create(userData, req) {
  if (!userData.password || userData.password.trim() === '') {
    throw new AppError('An explicit initial password is strictly required.', 400);
  }
  const safeDeptId = (userData.dept_id && userData.dept_id !== 'null' && userData.dept_id !== '') ? userData.dept_id : null;
  const { id: newUserId } = await userModel.create({
    name: userData.name,
    email: userData.email,
    role: userData.role,
    dept_id: safeDeptId,
    password: userData.password,
  });

  await logChange({
    entityType: 'user',
    entityId: userData.email,
    action: 'create',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: {
      name: { old: null, new: userData.name },
      email: { old: null, new: userData.email },
      role: { old: null, new: userData.role },
    },
  }, { logger: req?.log });
  
  // Emit user created event
  await emit('auth:user-created', {
    name: userData.name,
    email: userData.email,
    role: userData.role,
  });

  return { id: newUserId ?? null };
}

export async function update(id, userData, req) {
  const oldUser = await userModel.getById(id);
  const safeDeptId = (userData.dept_id && userData.dept_id !== 'null' && userData.dept_id !== '') ? userData.dept_id : null;
  await userModel.update(id, {
    name: userData.name,
    email: userData.email,
    role: userData.role,
    dept_id: safeDeptId,
    password: userData.password,
  });

  const changes = {};
  if (oldUser?.name !== userData.name) changes.name = { old: oldUser?.name, new: userData.name };
  if (oldUser?.email !== userData.email) changes.email = { old: oldUser?.email, new: userData.email };
  if (oldUser?.role !== userData.role) changes.role = { old: oldUser?.role, new: userData.role };
  if (oldUser?.dept_id !== safeDeptId) changes.dept_id = { old: oldUser?.dept_id, new: safeDeptId };

  await logChange({
    entityType: 'user',
    entityId: String(id),
    action: 'update',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes,
  }, { logger: req?.log });
}

export async function remove(id, req) {
  const user = await userModel.getById(id);
  await userModel.remove(id);

  await logChange({
    entityType: 'user',
    entityId: String(id),
    action: 'delete',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: user ? { name: { old: user.name, new: null }, email: { old: user.email, new: null } } : undefined,
  }, { logger: req?.log });
}