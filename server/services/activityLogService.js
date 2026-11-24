import * as activityLogModel from '../models/activityLogModel.js';

const SENSITIVE_FIELDS = new Set(['password', 'password_hash', 'token', 'secret']);

function stripSensitiveFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!SENSITIVE_FIELDS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

export function computeDiff(oldObj, newObj) {
  const old = stripSensitiveFields(oldObj);
  const fresh = stripSensitiveFields(newObj);
  const diff = {};
  const allKeys = new Set([...Object.keys(old), ...Object.keys(fresh)]);

  for (const key of allKeys) {
    const oldVal = old[key] === undefined ? null : old[key];
    const newVal = fresh[key] === undefined ? null : fresh[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }
  return diff;
}

export async function logChange({ entityType, entityId, action, userId, userName, ipAddress, changes, metadata }, { logger } = {}) {
  try {
    await activityLogModel.create({
      entity_type: entityType,
      entity_id: String(entityId),
      action,
      user_id: userId || null,
      user_name: userName || null,
      ip_address: ipAddress || null,
      changes: changes ? JSON.stringify(changes) : null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  } catch (err) {
    if (logger) logger.error({ err, entityType, entityId, action }, 'Activity log write failed');
  }
}

export async function getActivityLogs(filters) {
  return activityLogModel.query(filters);
}

export async function getEntityTimeline(entityType, entityId) {
  return activityLogModel.getByEntity(entityType, entityId);
}

export async function getDistinctUsers() {
  return activityLogModel.getDistinctUsers();
}

export async function exportCsv(filters) {
  const { logs } = await activityLogModel.query({ ...filters, limit: 10000, page: 1 });
  const headers = ['Timestamp', 'User', 'Action', 'Entity Type', 'Entity ID', 'Changes', 'IP Address'];
  const rows = logs.map(log => [
    log.created_at,
    log.user_name || '',
    log.action,
    log.entity_type,
    log.entity_id,
    log.changes ? log.changes.replace(/"/g, '""') : '',
    log.ip_address || '',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
  return csv;
}
