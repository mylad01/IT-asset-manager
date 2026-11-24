// assetService.js - Business logic for asset operations
// Refactored to use withTransaction() for the transfer operation

import { getDb } from '../database.js';
import { withTransaction } from '../db/transactions.js';
import * as assetModel from '../models/assetModel.js';
import * as lifecycleModel from '../models/assetLifecycleModel.js';
import { emit } from './notificationEvents.js';
import { logChange } from './activityLogService.js';

export async function getAll() {
  return assetModel.getAll();
}

export async function getById(id) {
  return assetModel.getById(id);
}

export async function getUnassigned() {
  return assetModel.getUnassigned();
}

export async function getHistory(id) {
  return assetModel.getHistory(id);
}

export async function getLifecycle(id) {
  return lifecycleModel.getLifecycle(id);
}

export async function create(assetData, file, req) {
  const imageUrl = `/uploads/${file.filename}`;
  const safeDeptId = (assetData.dept_id && assetData.dept_id !== 'null' && assetData.dept_id !== '') ? assetData.dept_id : null;
  const safeUserId = (assetData.assigned_to_user_id && assetData.assigned_to_user_id !== 'null' && assetData.assigned_to_user_id !== '') ? assetData.assigned_to_user_id : null;
  await assetModel.create({
    id: assetData.id, type: assetData.type, model: assetData.model,
    serial_number: assetData.serial_number, purchase_date: assetData.purchase_date,
    notes: assetData.notes, custom_attributes: assetData.custom_attributes,
    image_url: imageUrl, dept_id: safeDeptId, assigned_to_user_id: safeUserId,
    status: assetData.status,
  });

  await logChange({
    entityType: 'asset',
    entityId: assetData.id,
    action: 'create',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: { type: { old: null, new: assetData.type }, model: { old: null, new: assetData.model }, status: { old: null, new: assetData.status } },
  }, { logger: req?.log });

  // Emit asset assigned event if assigned to user
  if (safeUserId) {
    await emit('asset:assigned', {
      assetId: assetData.id,
      assetName: `${assetData.type} ${assetData.model}`,
      assignedToUserId: safeUserId,
    });
  }
}

export async function transfer(id, newUserId, newDeptId, transferNotes, logger, req) {
  const targetUserId = (newUserId && newUserId !== '') ? newUserId : null;
  const targetDeptId = (newDeptId && newDeptId !== '') ? newDeptId : null;
  const newStatus = targetUserId ? 'Deployed' : 'In Storage';
  
  const db = await getDb();
  return withTransaction(db, async (_txn) => {
    const oldAsset = await assetModel.getById(id);
    await assetModel.updateAssignment(id, targetUserId, targetDeptId, newStatus);

    const changes = {};
    if (oldAsset.assigned_to_user_id !== targetUserId) {
      changes.assigned_to = { old: oldAsset.assigned_to_user_id, new: targetUserId };
    }
    if (oldAsset.status !== newStatus) {
      changes.status = { old: oldAsset.status, new: newStatus };
    }
    if (oldAsset.dept_id !== targetDeptId) {
      changes.dept_id = { old: oldAsset.dept_id, new: targetDeptId };
    }

    await logChange({
      entityType: 'asset',
      entityId: id,
      action: 'transfer',
      userId: req?.user?.id,
      userName: req?.user?.name,
      ipAddress: req?.ip,
      changes,
      metadata: transferNotes ? { notes: transferNotes } : undefined,
    }, { logger });
    
    // Emit events based on transfer direction
    if (oldAsset.assigned_to_user_id && !targetUserId) {
      // Asset returned
      await emit('asset:returned', {
        assetId: id,
        assetName: `${oldAsset.type} ${oldAsset.model}`,
        userId: oldAsset.assigned_to_user_id,
        name: oldAsset.user_name || 'User',
      });
    } else if (targetUserId && !oldAsset.assigned_to_user_id) {
      // Asset assigned
      await emit('asset:assigned', {
        assetId: id,
        assetName: `${oldAsset.type} ${oldAsset.model}`,
        assignedToUserId: targetUserId,
      });
    } else if (targetUserId && oldAsset.assigned_to_user_id && targetUserId !== oldAsset.assigned_to_user_id) {
      // Asset reassigned - notify both
      await emit('asset:returned', {
        assetId: id,
        assetName: `${oldAsset.type} ${oldAsset.model}`,
        userId: oldAsset.assigned_to_user_id,
        name: oldAsset.user_name || 'User',
      });
      await emit('asset:assigned', {
        assetId: id,
        assetName: `${oldAsset.type} ${oldAsset.model}`,
        assignedToUserId: targetUserId,
      });
    }
  }, { logger });
}

export async function addLogEntry(id, notes, actionType, req) {
  const currentAsset = await assetModel.getCurrentOwner(id);
  const currentOwner = currentAsset ? currentAsset.assigned_to_user_id : null;
  await assetModel.addLogEntry(id, currentOwner, actionType || 'AUDIT_NOTE', notes);

  await logChange({
    entityType: 'asset',
    entityId: id,
    action: 'audit_note',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: { notes: { old: null, new: notes } },
    metadata: { actionType: actionType || 'AUDIT_NOTE' },
  }, { logger: req?.log });
}

export async function remove(id, req) {
  const asset = await assetModel.getById(id);
  await assetModel.remove(id);

  await logChange({
    entityType: 'asset',
    entityId: id,
    action: 'delete',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: asset ? { type: { old: asset.type, new: null }, model: { old: asset.model, new: null } } : undefined,
  }, { logger: req?.log });
}