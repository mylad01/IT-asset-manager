import connectionManager from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrations/umzug-instance.js';

if (process.env.NODE_ENV === 'production') {
  console.error('\n❌  Refusing to seed test data in production!');
  process.exit(1);
}

// Shared live-API guard: never race the dev API on its own DB.
{
  const { refuseIfDevApiLive } = await import('../server/utils/liveApiGuard.js');
  const verdict = await refuseIfDevApiLive('seedNotifications');
  if (verdict.refused) process.exit(1);
}

const sampleNotifications = [
  // Ticket notifications
  { type: 'ticket', priority: 'critical', title: 'Ticket Assigned: Workstation crashing during render', message: 'You have been assigned to ticket #1', link: '/helpdesk?ticket=1&highlight=1' },
  { type: 'ticket', priority: 'warning', title: 'New Ticket: Cannot access render farm shares', message: 'staff2 created ticket: Cannot access render farm shares', link: '/helpdesk?ticket=2&highlight=2' },
  { type: 'ticket', priority: 'info', title: 'IT Reply on Ticket #3', message: 'IT team replied to your ticket #3', link: '/my-tickets?t=3&highlight=3' },
  { type: 'ticket', priority: 'warning', title: 'Ticket Status: In Progress', message: 'Your ticket #4 is now In Progress', link: '/my-tickets?t=4&highlight=4' },
  { type: 'ticket', priority: 'info', title: 'New Reply on Ticket #5', message: 'New reply on ticket #5', link: '/helpdesk?ticket=5&highlight=5' },
  { type: 'ticket', priority: 'critical', title: 'Ticket Reassigned: Camera lens mount loose', message: 'Ticket #6 has been reassigned to you', link: '/helpdesk?ticket=6&highlight=6' },

  // Asset notifications
  { type: 'asset', priority: 'info', title: 'Asset Assigned: ARRI Alexa Mini LF', message: 'ARRI Alexa Mini LF has been assigned to you', link: '/assets/1?highlight=1' },
  { type: 'asset', priority: 'info', title: 'Asset Returned: RED V-Raptor 8K', message: 'RED V-Raptor 8K has been returned by staff1', link: '/assets/2?highlight=2' },

  // Consumable notifications
  { type: 'consumable', priority: 'warning', title: 'Low Stock: AA Batteries', message: 'AA Batteries is at or below threshold (3 remaining)', link: '/consumables' },
  { type: 'consumable', priority: 'critical', title: 'Out of Stock: HDMI Cables', message: 'HDMI Cables is out of stock', link: '/consumables' },

  // Auth notifications
  { type: 'auth', priority: 'critical', title: 'Failed Login: unknown@test.com', message: 'Failed login attempt for unknown@test.com from 192.168.1.100', link: '/activity' },
  { type: 'auth', priority: 'info', title: 'New User: john_doe', message: 'New user account created: john_doe (john@studio.com)', link: '/users-admin' },
  { type: 'auth', priority: 'info', title: 'Password Changed', message: 'Your password has been changed', link: '/my-assets' },

  // System/Backup notifications
  { type: 'system', priority: 'info', title: 'Backup Complete', message: 'Backup saved as itame-backup-2026-09-10.zip', link: '/settings' },
  { type: 'backup', priority: 'info', title: 'Backup Started', message: 'On-demand backup has started', link: '/settings' },
  { type: 'backup', priority: 'critical', title: 'Backup Failed', message: 'Backup failed: Network path not accessible', link: '/settings' },

  // Mix of read/unread
  { type: 'ticket', priority: 'info', title: 'Old Ticket Update', message: 'Ticket #8 has been resolved', link: '/my-tickets?t=8&highlight=8', is_read: 1 },
  { type: 'asset', priority: 'info', title: 'Asset Deployed (older)', message: 'Mac Studio M2 Ultra deployed to staff1', link: '/assets/3?highlight=3', is_read: 1 },
  { type: 'system', priority: 'warning', title: 'Scheduled Maintenance', message: 'System maintenance scheduled for Sunday 2am', link: '/settings', is_read: 1 },
  { type: 'auth', priority: 'info', title: 'Login from new device', message: 'New login detected from Chrome on Windows', link: '/activity', is_read: 1 },
  { type: 'ticket', priority: 'medium', title: 'Ticket Closed', message: 'Your ticket #10 has been closed', link: '/my-tickets?t=10&highlight=10', is_read: 1 },

  // Snoozed notifications
  { type: 'consumable', priority: 'info', title: 'Restock Reminder: USB Drives', message: 'USB drives are running low', link: '/consumables', snooze_hours: 48 },
  { type: 'system', priority: 'info', title: 'Weekly Report Ready', message: 'Your weekly IT summary report is available', link: '/dashboard', snooze_hours: 24 },
];

async function seedNotifications() {
  const db = await connectionManager.connect();
  console.log('Connected to database.\n');

  await runMigrations(db);
  console.log('Migrations applied.\n');

  const users = await db.all('SELECT id, name, role FROM users');
  if (users.length === 0) {
    console.error('❌ No users found. Run `npm run seed:users` first.');
    await connectionManager.close();
    process.exit(1);
  }

  const admins = users.filter(u => u.role === 'IT Admin');
  const allUsers = users;

  console.log(`Found ${users.length} users (${admins.length} admins).\n`);

  let created = 0;

  for (const notif of sampleNotifications) {
    // Assign to all admins for admin-type events, or randomly to one user
    const recipients = notif.type === 'auth' && notif.priority === 'critical'
      ? admins
      : notif.type === 'ticket' || notif.type === 'asset'
        ? [allUsers[Math.floor(Math.random() * allUsers.length)]]
        : [allUsers[0]];

    for (const user of recipients) {
      const snoozeUntil = notif.snooze_hours
        ? `datetime('now', '+${notif.snooze_hours} hours')`
        : 'NULL';

      const isRead = notif.is_read || 0;

      try {
        await db.run(
          `INSERT INTO notifications (user_id, type, priority, title, message, link, is_read, snooze_until, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ${snoozeUntil}, datetime('now', '-' || ? || ' hours'))`,
          [user.id, notif.type, notif.priority, notif.title, notif.message, notif.link || null, isRead, Math.floor(Math.random() * 72)]
        );
        created++;
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}`);
      }
    }
  }

  const counts = await db.all(
    'SELECT type, is_read, COUNT(*) as count FROM notifications GROUP BY type, is_read ORDER BY type'
  );

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  NOTIFICATION SEED COMPLETE');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Notifications created: ${created}`);
  console.log('\n  Breakdown:');
  for (const c of counts) {
    const status = c.is_read ? 'read' : 'unread';
    console.log(`    ${c.type.padEnd(12)} ${status.padEnd(8)} ${c.count}`);
  }
  console.log('');

  await connectionManager.close();
  console.log('Database connection closed. Done!\n');
}

seedNotifications().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
