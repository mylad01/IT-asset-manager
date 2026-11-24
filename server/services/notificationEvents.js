import { getDb } from '../database.js';
import * as notificationModel from '../models/notificationModel.js';
import { pushToUser } from './wsServer.js';

// Event definitions: eventName -> { recipients: 'all-admins' | 'root' | 'user' | 'assignee' | 'participants' | 'owner', priority: 'critical' | 'warning' | 'info' }
const EVENT_REGISTRY = {
  'ticket:created': { recipients: 'all-admins', priority: 'warning' },
  'ticket:assigned': { recipients: 'assignee', priority: 'critical' },
  'ticket:dispatched': { recipients: 'assignee', priority: 'critical' },
  'ticket:status-changed': { recipients: 'owner+admins', priority: 'warning' },
  'ticket:it-replied': { recipients: 'owner', priority: 'info' },
  'ticket:new-reply': { recipients: 'participants', priority: 'info' },
  'asset:assigned': { recipients: 'assignee+admins', priority: 'info' },
  'asset:returned': { recipients: 'returner+admins', priority: 'info' },
  'consumable:low-stock': { recipients: 'all-admins', priority: 'warning' },
  'consumable:out-of-stock': { recipients: 'all-admins', priority: 'critical' },
  'auth:failed-login': { recipients: 'root', priority: 'critical' },
  'auth:user-created': { recipients: 'root', priority: 'info' },
  'auth:password-changed': { recipients: 'user+root', priority: 'info' },
  'asset:scan-mismatch': { recipients: 'all-admins', priority: 'warning' },
  'backup:started': { recipients: 'root', priority: 'info' },
  'backup:progress': { recipients: 'root', priority: 'info' },
  'backup:complete': { recipients: 'root', priority: 'info' },
  'backup:failed': { recipients: 'root', priority: 'critical' },
  'conversation:message': { recipients: 'user', priority: 'info' },
  // Lifecycle batch summaries go to root only — retention/quota are root
  // concerns (the run-now route is requireRoot, settings are root-managed).
  'conversation:retention-purged': { recipients: 'root', priority: 'warning' },
  'conversation:archive-retention-purged': { recipients: 'root', priority: 'warning' },
  'conversation:quota-warning': { recipients: 'root', priority: 'warning' },
  // Direct @mention: the mentioned user is the recipient. Priority 'warning'
  // (amber) so mentions stand out from ordinary message notifications.
  'conversation:mentioned': { recipients: 'user', priority: 'warning' },
  // Leave requests (spec: 2026-10-13 design §6). submitted routes to the
  // requester's own department's managers, with an admin fallback below.
  'leave:submitted': { recipients: 'dept-managers', priority: 'warning' },
  'leave:approved': { recipients: 'user', priority: 'info' },
  'leave:denied': { recipients: 'user', priority: 'warning' },
};

export async function emit(eventName, payload, txn) {
  const event = EVENT_REGISTRY[eventName];
  if (!event) {
    console.warn(`Unknown notification event: ${eventName}`);
    return;
  }

  const recipients = await computeRecipients(event.recipients, payload);
  if (!recipients.length) return;

  const notifications = recipients.map(userId => ({
    user_id: userId,
    type: getEventType(eventName),
    priority: event.priority,
    title: getEventTitle(eventName, payload),
    message: getEventMessage(eventName, payload),
    link: getEventLink(eventName, payload),
  }));

  // Write notifications in the same transaction. The model attaches real
  // ids/created_at onto these objects (client dismiss/snooze need them).
  if (txn) {
    await notificationModel.createManyInTxn(txn, notifications);
  } else {
    await notificationModel.createMany(notifications);
  }

  // Push via WebSocket (outside transaction)
  for (const notif of notifications) {
    pushToUser(notif.user_id, notif);
  }
}

async function computeRecipients(recipientType, payload) {
  const db = await getDb();
  
  switch (recipientType) {
    case 'all-admins': {
      const admins = await db.all('SELECT id FROM users WHERE role = "IT Admin"');
      return admins.map(a => a.id);
    }
    case 'root': {
      const roots = await db.all('SELECT id FROM users WHERE is_root = 1');
      return roots.map(r => r.id);
    }
    case 'user': {
      return payload.userId ? [payload.userId] : [];
    }
    case 'dept-managers': {
      if (payload.deptId != null) {
        const mgrs = await db.all(
          `SELECT id FROM users WHERE role = 'Department Manager' AND dept_id = ?`,
          [payload.deptId]
        );
        if (mgrs.length) return mgrs.map(m => m.id);
      }
      // Managerless (or dept-less) submission must never die silently: the
      // inbox's admin fallback picks it up (spec §6).
      const admins = await db.all(`SELECT id FROM users WHERE role = 'IT Admin'`);
      return admins.map(a => a.id);
    }
    case 'assignee': {
      return payload.assignedAdminId ? [payload.assignedAdminId] : [];
    }
    case 'assignee+admins': {
      const admins = await db.all('SELECT id FROM users WHERE role = "IT Admin"');
      const adminIds = admins.map(a => a.id);
      if (payload.assignedToUserId && !adminIds.includes(payload.assignedToUserId)) {
        adminIds.push(payload.assignedToUserId);
      }
      return adminIds;
    }
    case 'owner': {
      return payload.userId ? [payload.userId] : [];
    }
    case 'owner+admins': {
      const admins = await db.all('SELECT id FROM users WHERE role = "IT Admin"');
      const adminIds = admins.map(a => a.id);
      if (payload.userId && !adminIds.includes(payload.userId)) {
        adminIds.push(payload.userId);
      }
      return adminIds;
    }
    case 'returner+admins': {
      const admins = await db.all('SELECT id FROM users WHERE role = "IT Admin"');
      const adminIds = admins.map(a => a.id);
      if (payload.userId && !adminIds.includes(payload.userId)) {
        adminIds.push(payload.userId);
      }
      return adminIds;
    }
    case 'participants': {
      // Other participants on the ticket (excluding the commenter)
      const participantIds = await db.all(
        `SELECT DISTINCT user_id FROM ticket_comments WHERE ticket_id = ? AND user_id != ?`,
        [payload.ticketId, payload.userId]
      );
      return participantIds.map(p => p.user_id);
    }
    case 'user+root': {
      const roots = await db.all('SELECT id FROM users WHERE is_root = 1');
      const ids = [];
      if (payload.userId) ids.push(payload.userId);
      for (const r of roots) ids.push(r.id);
      return ids;
    }
    default:
      return [];
  }
}

function getEventType(eventName) {
  if (eventName.startsWith('ticket:')) return 'ticket';
  if (eventName.startsWith('asset:')) return 'asset';
  if (eventName.startsWith('consumable:')) return 'consumable';
  if (eventName.startsWith('auth:')) return 'auth';
  if (eventName.startsWith('backup:')) return 'backup';
  if (eventName.startsWith('conversation:')) return 'conversation';
  if (eventName.startsWith('leave:')) return 'leave';
  return 'system';
}

function getEventTitle(eventName, payload) {
  const titles = {
    'ticket:created': `New Ticket Submitted: ${payload.title}`,
    'ticket:assigned': `Ticket Assigned: ${payload.title}`,
    'ticket:dispatched': `Ticket Dispatched: ${payload.title}`,
    'ticket:status-changed': `Ticket Status Updated: ${payload.status}`,
    'ticket:it-replied': `IT Reply on Ticket #${payload.ticketId}`,
    'ticket:new-reply': `New Reply on Ticket #${payload.ticketId}`,
    'asset:assigned': `Asset Assigned: ${payload.assetName}`,
    'asset:returned': `Asset Returned: ${payload.assetName}`,
    'consumable:low-stock': `Low Stock: ${payload.consumableName}`,
    'consumable:out-of-stock': `Out of Stock: ${payload.consumableName}`,
    'auth:failed-login': `Failed Login: ${payload.email}`,
    'auth:user-created': `New User: ${payload.name}`,
    'auth:password-changed': 'Password Changed',
    'asset:scan-mismatch': `Scan Mismatch: ${payload.assetName}`,
    'backup:started': 'Backup Started',
    'backup:progress': `Backup Progress: ${payload.progress}%`,
    'backup:complete': `Backup Complete: ${payload.filename}`,
    'backup:failed': `Backup Failed: ${payload.error}`,
    'conversation:message': `New Message: ${payload.conversationTitle}`,
    'conversation:mentioned': `${payload.senderName} mentioned you in ${payload.conversationTitle}`,
    'conversation:retention-purged': `Recycle bin purged: ${payload.purgedCount} conversation${payload.purgedCount === 1 ? '' : 's'}`,
    'conversation:archive-retention-purged': `Archive retention purge: ${payload.purgedCount} conversation${payload.purgedCount === 1 ? '' : 's'}`,
    'conversation:quota-warning': `Conversation storage at ${Math.round((payload.usageRatio || 0) * 100)}% of quota`,
    // titles
    'leave:submitted': `Leave Request: ${payload.start} → ${payload.end}`,
    'leave:approved': `Leave Approved: ${payload.start} → ${payload.end}`,
    'leave:denied': `Leave Denied: ${payload.start} → ${payload.end}`,
  };
  return titles[eventName] || 'Notification';
}

function getEventMessage(eventName, payload) {
  const messages = {
    'ticket:created': `${payload.name} submitted a new ticket: ${payload.title}`,
    'ticket:assigned': `You have been assigned to ticket #${payload.ticketId}: ${payload.title}`,
    'ticket:dispatched': `Ticket #${payload.ticketId} has been dispatched to you: ${payload.title}`,
    'ticket:status-changed': `Ticket #${payload.ticketId} status changed to ${payload.status}`,
    'ticket:it-replied': `IT team replied to your ticket #${payload.ticketId}`,
    'ticket:new-reply': `New reply on ticket #${payload.ticketId}`,
    'asset:assigned': `${payload.assetName} has been assigned to you`,
    'asset:returned': `${payload.assetName} has been returned by ${payload.name}`,
    'consumable:low-stock': `${payload.consumableName} is at or below threshold (${payload.quantity} remaining)`,
    'consumable:out-of-stock': `${payload.consumableName} is out of stock`,
    'auth:failed-login': `Failed login attempt for ${payload.email} from ${payload.ip}`,
    'auth:user-created': `New user account created: ${payload.name} (${payload.email})`,
    'auth:password-changed': `Your password has been changed`,
    'asset:scan-mismatch': `Scanned asset ${payload.assetName} does not match expected location`,
    'backup:started': 'On-demand backup has started',
    'backup:progress': `Backup is ${payload.progress}% complete`,
    'backup:complete': `Backup saved as ${payload.filename}`,
    'backup:failed': `Backup failed: ${payload.error}`,
    'conversation:message': `${payload.senderName} sent a message in ${payload.conversationTitle}`,
    'conversation:mentioned': (payload.messagePreview || '').slice(0, 140),
    'conversation:retention-purged': `${payload.purgedCount} deleted conversation${payload.purgedCount === 1 ? '' : 's'} passed the ${payload.retentionDays}-day retention and were permanently purged`,
    'conversation:archive-retention-purged': `${payload.purgedCount} archived conversation${payload.purgedCount === 1 ? '' : 's'} passed the ${payload.retentionDays}-day archive retention and were permanently purged`,
    'conversation:quota-warning': `${payload.usedMb} MB of ${payload.quotaMb} MB attachment storage used — consider archiving or raising the quota`,
    // messages
    'leave:submitted': `${payload.requesterName} requested leave ${payload.start} → ${payload.end}`,
    'leave:approved': `Your leave ${payload.start} → ${payload.end} was approved`,
    'leave:denied': `Your leave ${payload.start} → ${payload.end} was denied`,
  };
  return messages[eventName] || '';
}

function getEventLink(eventName, payload) {
  const links = {
    'ticket:created': `/helpdesk?ticket=${payload.ticketId}&highlight=${payload.ticketId}`,
    'ticket:assigned': `/helpdesk?ticket=${payload.ticketId}&highlight=${payload.ticketId}`,
    'ticket:dispatched': `/helpdesk?ticket=${payload.ticketId}&highlight=${payload.ticketId}`,
    'ticket:status-changed': `/my-tickets?t=${payload.ticketId}&highlight=${payload.ticketId}`,
    'ticket:it-replied': `/my-tickets?t=${payload.ticketId}&highlight=${payload.ticketId}`,
    'ticket:new-reply': `/helpdesk?ticket=${payload.ticketId}&highlight=${payload.ticketId}`,
    'asset:assigned': `/assets/${payload.assetId}?highlight=${payload.assetId}`,
    'asset:returned': `/assets/${payload.assetId}?highlight=${payload.assetId}`,
    'consumable:low-stock': `/consumables`,
    'consumable:out-of-stock': `/consumables`,
    'auth:failed-login': `/activity`,
    'auth:user-created': `/users-admin`,
    'auth:password-changed': `/my-assets`,
    'asset:scan-mismatch': `/scan`,
    'backup:started': `/settings`,
    'backup:progress': `/settings`,
    'backup:complete': `/settings`,
    'backup:failed': `/settings`,
    // m=<messageId> deep-links into the conversation workspace and highlights
    // the referenced message (ChatPanel pages back through history until the
    // message is mounted, scrolls it into view, and ring-highlights it).
    'conversation:message': `/conversations?c=${payload.conversationId}&m=${payload.messageId}`,
    'conversation:mentioned': `/conversations?c=${payload.conversationId}&m=${payload.messageId}`,
    'conversation:retention-purged': `/settings`,
    'conversation:archive-retention-purged': `/settings`,
    'conversation:quota-warning': `/settings`,
    // links (deep links consumed by the pages in Tasks 8–9)
    'leave:submitted': `/leave-approvals?req=${payload.requestId}`,
    'leave:approved': `/leave?req=${payload.requestId}`,
    'leave:denied': `/leave?req=${payload.requestId}`,
  };
  return links[eventName] || null;
}