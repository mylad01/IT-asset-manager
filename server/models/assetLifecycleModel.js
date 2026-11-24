// assetLifecycleModel.js — assembles the full lifecycle timeline for an asset.
// Combines purchase data, warranty info, and all activity_log events into a
// single chronological array of milestone objects.

import { getDb } from '../database.js';

/**
 * Build the lifecycle timeline for one asset.
 * Returns { asset, milestones } where milestones is sorted oldest-first.
 *
 * Milestone shape:
 *   { date, type, label, detail, icon, color }
 */
export async function getLifecycle(assetId) {
  const db = await getDb();

  const asset = await db.get(`
    SELECT a.*, d.name as dept, u.name as assigned_to
    FROM assets a
    LEFT JOIN departments d ON a.dept_id = d.id
    LEFT JOIN users u ON a.assigned_to_user_id = u.id
    WHERE a.id = ?
  `, [assetId]);

  if (!asset) return null;

  const milestones = [];

  // ── Purchase milestone ──────────────────────────────────────────
  if (asset.purchase_date) {
    milestones.push({
      date: asset.purchase_date,
      type: 'purchase',
      label: 'Purchased',
      detail: asset.notes || `Asset acquired${asset.purchase_cost ? ` for $${asset.purchase_cost}` : ''}`,
      icon: 'ShoppingCart',
      color: 'emerald',
    });
  }

  // ── Warranty milestone (start + expiry) ─────────────────────────
  if (asset.warranty_expiry) {
    milestones.push({
      date: asset.warranty_expiry,
      type: 'warranty_expiry',
      label: 'Warranty Expires',
      detail: formatWarrantyDetail(asset.purchase_date, asset.warranty_expiry),
      icon: 'Shield',
      color: isExpired(asset.warranty_expiry) ? 'red' : 'amber',
    });
  }

  // ── Activity log events ─────────────────────────────────────────
  const logs = await db.all(`
    SELECT action, user_name, changes, metadata, created_at
    FROM activity_logs
    WHERE entity_type = 'asset' AND entity_id = ?
    ORDER BY created_at ASC
  `, [assetId]);

  for (const log of logs) {
    const parsed = parseLogEntry(log);
    if (parsed) milestones.push(parsed);
  }

  // Sort oldest first
  milestones.sort((a, b) => new Date(a.date) - new Date(b.date));

  return { asset, milestones };
}

function parseLogEntry(log) {
  const action = (log.action || '').toLowerCase();
  const date = log.created_at;
  const changes = safeJson(log.changes);
  const meta = safeJson(log.metadata);

  switch (action) {
    case 'create':
      return {
        date,
        type: 'create',
        label: 'Asset Created',
        detail: `Added to inventory by ${log.user_name || 'system'}`,
        icon: 'Plus',
        color: 'blue',
      };

    case 'transfer':
    case 'assign': {
      const toUser = changes?.assigned_to?.new || changes?.user_name?.new;
      const fromUser = changes?.assigned_to?.old || changes?.user_name?.old;
      const notes = meta?.notes || changes?.notes?.new;
      if (fromUser && toUser) {
        return {
          date,
          type: 'transfer',
          label: 'Transferred',
          detail: `From → To${notes ? `: ${notes}` : ''}`,
          icon: 'ArrowRightLeft',
          color: 'purple',
        };
      }
      if (toUser) {
        return {
          date,
          type: 'deploy',
          label: 'Deployed',
          detail: `Assigned to ${toUser}${notes ? `: ${notes}` : ''}`,
          icon: 'Rocket',
          color: 'green',
        };
      }
      // Return to storage
      return {
        date,
        type: 'return',
        label: 'Returned to Storage',
        detail: notes || `Returned by ${fromUser || 'user'}`,
        icon: 'Archive',
        color: 'gray',
      };
    }

    case 'audit_note':
    case 'maintenancelog': {
      const notes = meta?.notes || changes?.notes?.new;
      const actionType = (meta?.actionType || 'AUDIT_NOTE').toUpperCase();
      return {
        date,
        type: actionType === 'MAINTENANCE' ? 'maintenance' : 'note',
        label: actionType === 'MAINTENANCE' ? 'Maintenance' : 'Audit Note',
        detail: notes || 'No details',
        icon: actionType === 'MAINTENANCE' ? 'Wrench' : 'FileText',
        color: actionType === 'MAINTENANCE' ? 'orange' : 'slate',
      };
    }

    case 'update':
      return {
        date,
        type: 'update',
        label: 'Updated',
        detail: describeChanges(changes),
        icon: 'Pencil',
        color: 'slate',
      };

    case 'delete':
      return {
        date,
        type: 'delete',
        label: 'Asset Deleted',
        detail: `Removed from inventory by ${log.user_name || 'system'}`,
        icon: 'Trash2',
        color: 'red',
      };

    default:
      return {
        date,
        type: 'event',
        label: action || 'Event',
        detail: log.user_name || '',
        icon: 'Circle',
        color: 'slate',
      };
  }
}

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function formatWarrantyDetail(purchaseDate, expiryDate) {
  if (!purchaseDate) return `Warranty ends ${formatDate(expiryDate)}`;
  const days = Math.ceil((new Date(expiryDate) - new Date(purchaseDate)) / 86400000);
  const months = Math.round(days / 30);
  return `${months >= 12 ? `${Math.floor(months / 12)}y ${months % 12}m` : `${months}m`} coverage from ${formatDate(purchaseDate)}`;
}

function isExpired(dateStr) {
  return new Date(dateStr) < new Date();
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { dateStyle: 'medium' });
}

function describeChanges(changes) {
  if (!changes) return 'Updated';
  const parts = [];
  if (changes.status) parts.push(`Status: ${changes.status.old} → ${changes.status.new}`);
  if (changes.type) parts.push(`Type: ${changes.type.old} → ${changes.type.new}`);
  if (changes.model) parts.push(`Model: ${changes.model.old} → ${changes.model.new}`);
  return parts.join(', ') || 'Updated';
}
