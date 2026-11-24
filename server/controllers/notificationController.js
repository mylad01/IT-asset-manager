import * as notificationService from '../services/notificationService.js';

export async function getActive(req, res) {
  const alerts = await notificationService.getActive(req.user.id);
  res.json(alerts);
}

export async function getAll(req, res) {
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;
  const alerts = await notificationService.getAll(req.user.id, limit, offset);
  res.json(alerts);
}

export async function getUnreadCount(req, res) {
  const count = await notificationService.getUnreadCount(req.user.id);
  res.json({ count });
}

export async function dismiss(req, res) {
  await notificationService.dismiss(req.params.id, req.user.id);
  res.json({ message: 'Notification dismissed.' });
}

export async function snooze(req, res) {
  const hours = parseInt(req.body.hours, 10) || 24;
  await notificationService.snooze(req.params.id, req.user.id, hours);
  res.json({ message: 'Notification snoozed.' });
}

export async function markAllRead(req, res) {
  await notificationService.markAllRead(req.user.id);
  res.json({ message: 'All notifications marked as read.' });
}

export async function getCalendar(req, res) {
  const { year, month, day } = req.validated;
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const summary = await notificationService.getByDateRange(req.user.id, startDate, endDate);

  const summaryMap = {};
  for (const row of summary) {
    summaryMap[row.date] = row.count;
  }

  if (day !== undefined) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const details = await notificationService.getByDay(req.user.id, dateStr);
    return res.json({ summary: summaryMap, details });
  }

  res.json({ summary: summaryMap, details: [] });
}

export async function searchNotifications(req, res) {
  const { query, type, from, to, page, limit } = req.validated;
  const data = await notificationService.search(req.user.id, { query, type, from, to, page, limit });
  res.json(data);
}