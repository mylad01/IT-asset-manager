// ticketService.js - Business logic for ticket operations
// Refactored to use withTransaction() instead of manual BEGIN/COMMIT/ROLLBACK

import { getDb } from '../database.js';
import { withTransaction } from '../db/transactions.js';
import * as ticketModel from '../models/ticketModel.js';
import * as ticketCommentModel from '../models/ticketCommentModel.js';
import { emit } from './notificationEvents.js';
import { logChange } from './activityLogService.js';

export async function getMyTickets(userId) {
  return ticketModel.getByUserId(userId);
}

export async function getAllTickets(userId, isRoot) {
  if (isRoot) {
    return ticketModel.getAllForAdmin(userId);
  }
  return ticketModel.getAllForStandardAdmin(userId);
}

export async function create(ticketData, logger, req) {
  const safeAssetId = (ticketData.asset_id && ticketData.asset_id !== '') ? ticketData.asset_id : null;
  const db = await getDb();
  const rootAdmin = await db.get('SELECT id FROM users WHERE is_root = 1 LIMIT 1');
  const rootAdminId = rootAdmin?.id || null;
  let createdId;
  return withTransaction(db, async (txn) => {
    createdId = await ticketModel.create({
      user_id: ticketData.user_id,
      asset_id: safeAssetId,
      assigned_admin_id: rootAdminId,
      title: ticketData.title,
      description: ticketData.description,
      category: ticketData.category,
      priority: ticketData.priority,
    });
    
    await emit('ticket:created', {
      ticketId: createdId,
      title: ticketData.title,
      userId: ticketData.user_id,
      name: ticketData.user_name || 'User',
    }, txn);
    
    if (rootAdminId) {
      await emit('ticket:assigned', {
        ticketId: createdId,
        title: ticketData.title,
        assignedAdminId: rootAdminId,
      }, txn);
    }
  }, { logger }).then(async () => {
    await logChange({
      entityType: 'ticket',
      entityId: String(createdId),
      action: 'create',
      userId: req?.user?.id,
      userName: req?.user?.name,
      ipAddress: req?.ip,
      changes: {
        title: { old: null, new: ticketData.title },
        category: { old: null, new: ticketData.category },
        priority: { old: null, new: ticketData.priority },
        assigned_admin_id: { old: null, new: rootAdminId },
      },
    }, { logger });
    // Surface the created ticket id so the 201 body is immediately usable
    // (deep-link, client-side navigation) without a re-list round-trip.
    return { id: createdId ?? null };
  });
}

export async function assignAdmin(id, assignedAdminId, logger, req) {
  const safeAdminId = (assignedAdminId && assignedAdminId !== '') ? assignedAdminId : null;
  const oldTicket = await ticketModel.getById(id);
  const newStatus = 'Submitted to Helpdesk Administrator';
  const db = await getDb();
  return withTransaction(db, async (txn) => {
    await ticketModel.assignAdmin(id, safeAdminId);
    if (safeAdminId && oldTicket.status === 'Submitted to Manager') {
      await ticketModel.updateStatus(id, newStatus);
    }
    
    if (safeAdminId) {
      if (oldTicket.assigned_admin_id && oldTicket.assigned_admin_id !== safeAdminId) {
        await emit('ticket:dispatched', {
          ticketId: id,
          title: oldTicket.title,
          assignedAdminId: safeAdminId,
          previousAdminId: oldTicket.assigned_admin_id,
        }, txn);
      } else {
        await emit('ticket:assigned', {
          ticketId: id,
          title: oldTicket.title,
          assignedAdminId: safeAdminId,
        }, txn);
      }
    }
  }, { logger }).then(async () => {
    const changes = { assigned_admin_id: { old: oldTicket?.assigned_admin_id, new: safeAdminId } };
    if (safeAdminId && oldTicket.status === 'Submitted to Manager') {
      changes.status = { old: oldTicket.status, new: newStatus };
    }
    await logChange({
      entityType: 'ticket',
      entityId: String(id),
      action: 'dispatch',
      userId: req?.user?.id,
      userName: req?.user?.name,
      ipAddress: req?.ip,
      changes,
    }, { logger });
  });
}

export async function updateStatus(id, status, logger, req) {
  const oldTicket = await ticketModel.getById(id);
  const db = await getDb();
  return withTransaction(db, async (txn) => {
    await ticketModel.updateStatus(id, status);
    
    if (oldTicket) {
      await emit('ticket:status-changed', {
        ticketId: id,
        title: oldTicket.title,
        status,
        userId: oldTicket.user_id,
      }, txn);
    }
  }, { logger }).then(async () => {
    await logChange({
      entityType: 'ticket',
      entityId: String(id),
      action: 'status_change',
      userId: req?.user?.id,
      userName: req?.user?.name,
      ipAddress: req?.ip,
      changes: { status: { old: oldTicket?.status, new: status } },
    }, { logger });
  });
}

export async function getComments(ticketId, isITAdmin) {
  return ticketCommentModel.getByTicketId(ticketId, isITAdmin);
}

export async function addComment(ticketId, userId, text, isInternal, logger, req) {
  const db = await getDb();
  return withTransaction(db, async (txn) => {
    await ticketCommentModel.markAsRead(ticketId, userId);
    await ticketCommentModel.create({ ticket_id: ticketId, user_id: userId, text, is_internal: isInternal });
    const ticket = await ticketModel.getById(ticketId);
    
    if (ticket && !isInternal) {
      if (ticket.user_id !== userId && ticket.assigned_admin_id === userId) {
        await emit('ticket:it-replied', {
          ticketId,
          title: ticket.title,
          userId: ticket.user_id,
        }, txn);
      } 
      else if (ticket.assigned_admin_id && ticket.assigned_admin_id !== userId) {
        await emit('ticket:new-reply', {
          ticketId,
          title: ticket.title,
          userId: ticket.assigned_admin_id,
        }, txn);
      }
    }
  }, { logger }).then(async () => {
    await logChange({
      entityType: 'ticket',
      entityId: String(ticketId),
      action: 'comment',
      userId: req?.user?.id,
      userName: req?.user?.name,
      ipAddress: req?.ip,
      changes: { text: { old: null, new: text.substring(0, 100) }, is_internal: { old: null, new: isInternal } },
    }, { logger });
  });
}