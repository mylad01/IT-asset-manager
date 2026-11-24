// kitService.js - Business logic for kit operations

import * as kitModel from '../models/kitModel.js';
import * as assetModel from '../models/assetModel.js';
import { logChange } from './activityLogService.js';

/**
 * GET /api/kits/:id/preview
 * Returns kit details + available assets for each component type.
 */
export async function getPreview(kitId) {
  const kit = await kitModel.getById(kitId);
  if (!kit) return null;
  const items = await kitModel.getItems(kitId);
  const components = [];
  for (const item of items) {
    const available = await assetModel.getAvailableByTypeFull(item.asset_type, item.quantity + 20);
    components.push({
      asset_type: item.asset_type,
      requested: item.quantity,
      available,
      availableCount: available.length,
      shortfall: Math.max(0, item.quantity - available.length),
    });
  }
  return { id: kit.id, name: kit.name, description: kit.description, components };
}

export async function getAll() {
  return kitModel.getAll();
}

export async function getById(id) {
  return kitModel.getById(id);
}

export async function getItems(kitId) {
  return kitModel.getItems(kitId);
}

export async function create(kitData, req) {
  const { id: kitId } = await kitModel.create({ name: kitData.name, description: kitData.description, items: kitData.items || [] });

  await logChange({
    entityType: 'kit',
    entityId: kitData.name,
    action: 'create',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: {
      name: { old: null, new: kitData.name },
      description: { old: null, new: kitData.description },
    },
  }, { logger: req?.log });
  return { id: kitId ?? null };
}

export async function update(id, kitData, req) {
  const old = await kitModel.getById(id);
  await kitModel.update(id, { name: kitData.name, description: kitData.description });

  await logChange({
    entityType: 'kit',
    entityId: String(id),
    action: 'update',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: {
      name: { old: old?.name ?? null, new: kitData.name },
      description: { old: old?.description ?? null, new: kitData.description },
    },
  }, { logger: req?.log });
}

export async function remove(id, req) {
  const old = await kitModel.getById(id);
  await kitModel.remove(id);

  await logChange({
    entityType: 'kit',
    entityId: String(id),
    action: 'delete',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: {
      name: { old: old?.name ?? null, new: null },
      description: { old: old?.description ?? null, new: null },
    },
  }, { logger: req?.log });
}

export async function deploy(kitId, userId, deptId, logFn, assetSelections, req) {
  const items = await kitModel.getItems(kitId);
  let count = 0;
  const deployed = []; // Track what was deployed
  const missing = []; // Track asset types with insufficient stock
  for (const item of items) {
    // If user provided specific asset IDs for this type, use those
    const selectedIds = assetSelections?.[item.asset_type];
    let assets;
    if (selectedIds && selectedIds.length > 0) {
      // Fetch full asset objects for the selected IDs (verify they exist & are unassigned)
      const db = await (await import('../database.js')).getDb();
      const placeholders = selectedIds.map(() => '?').join(',');
      assets = await db.all(
        `SELECT id FROM assets WHERE id IN (${placeholders}) AND type = ? AND assigned_to_user_id IS NULL`,
        [...selectedIds, item.asset_type]
      );
    } else {
      // Auto-pick (legacy behavior)
      assets = await assetModel.getAvailableByType(item.asset_type, item.quantity);
    }
    for (const asset of assets) {
      await assetModel.updateAssignment(asset.id, userId, deptId, 'Deployed');
      await assetModel.addLogEntry(asset.id, userId, 'deploy', `Deployed via kit bundle`);
      deployed.push({ asset_id: asset.id, asset_type: item.asset_type });
      count++;
    }
    if (assets.length < item.quantity) {
      missing.push({
        asset_type: item.asset_type,
        requested: item.quantity,
        available: assets.length,
        shortfall: item.quantity - assets.length,
      });
    }
  }

  const kit = await kitModel.getById(kitId);
  await logChange({
    entityType: 'kit',
    entityId: String(kitId),
    action: 'assign',
    userId: req?.user?.id,
    userName: req?.user?.name,
    ipAddress: req?.ip,
    changes: {
      deployed_count: { old: 0, new: count },
      assigned_to: { old: null, new: userId },
    },
    metadata: { kit_name: kit?.name, deployed_assets: deployed, missing },
  }, { logger: req?.log });

  return { count, deployed, missing };
}
