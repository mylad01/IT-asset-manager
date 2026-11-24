import * as consumableModel from '../models/consumableModel.js';
import { emit } from './notificationEvents.js';
import { logChange } from './activityLogService.js';

export async function getAll() {
  return consumableModel.getAll();
}

export async function create(item, req) {
  const { id } = await consumableModel.create(item);

  await logChange({
    entityType: 'consumable',
    entityId: String(id || item.name),
    action: 'create',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: {
      name: { old: null, new: item.name },
      quantity: { old: null, new: item.quantity },
    },
  }, { logger: req?.log });
  return { id: id ?? null };
}

export async function adjustStock(id, amount, req) {
  const oldItem = await consumableModel.getById(id);
  const result = await consumableModel.adjustStock(id, amount);

  await logChange({
    entityType: 'consumable',
    entityId: String(id),
    action: 'stock_adjust',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: {
      quantity: { old: oldItem?.quantity, new: result.quantity },
    },
    metadata: { adjustment: amount },
  }, { logger: req?.log });
  
  // Check stock levels after adjustment
  if (result.quantity <= 0) {
    await emit('consumable:out-of-stock', {
      consumableName: result.name,
    });
  } else if (result.quantity <= result.threshold) {
    await emit('consumable:low-stock', {
      consumableName: result.name,
      quantity: result.quantity,
      threshold: result.threshold,
    });
  }
  
  return result.quantity;
}

export async function remove(id, req) {
  const item = await consumableModel.getById(id);
  await consumableModel.remove(id);

  await logChange({
    entityType: 'consumable',
    entityId: String(id),
    action: 'delete',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: item ? { name: { old: item.name, new: null } } : undefined,
  }, { logger: req?.log });
}