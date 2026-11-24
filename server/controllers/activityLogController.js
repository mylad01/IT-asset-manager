import * as activityLogService from '../services/activityLogService.js';

export async function queryLogs(req, res) {
  const result = await activityLogService.getActivityLogs(req.validated);
  res.json(result);
}

export async function exportCsv(req, res) {
  const csv = await activityLogService.exportCsv(req.validated);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="activity_log_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send(csv);
}

export async function getEntityTimeline(req, res) {
  const logs = await activityLogService.getEntityTimeline(req.params.type, req.params.id);
  res.json(logs || []);
}

export async function getFilterOptions(req, res) {
  const users = await activityLogService.getDistinctUsers();
  res.json({ users });
}
