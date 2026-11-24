import * as notificationModel from '../models/notificationModel.js';

export async function getActive(userId) {
  return notificationModel.getActiveByUser(userId);
}

export async function getAll(userId, limit = 50, offset = 0) {
  return notificationModel.getAllByUser(userId, limit, offset);
}

export async function getUnreadCount(userId) {
  return notificationModel.getUnreadCount(userId);
}

export async function dismiss(id, userId) {
  await notificationModel.dismiss(id, userId);
}

export async function snooze(id, userId, hours = 24) {
  await notificationModel.snooze(id, userId, hours);
}

export async function markAllRead(userId) {
  await notificationModel.markAllRead(userId);
}

export async function getByDateRange(userId, startDate, endDate) {
  return notificationModel.getByDateRange(userId, startDate, endDate);
}

export async function getByDay(userId, date) {
  return notificationModel.getByDay(userId, date);
}

export async function create(notification) {
  return notificationModel.create(notification);
}

export async function search(userId, params) {
  return notificationModel.search(userId, params);
}