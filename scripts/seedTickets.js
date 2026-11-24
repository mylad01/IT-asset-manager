import connectionManager from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrations/umzug-instance.js';

// ── Safety guard ────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  console.error('\n❌  Refusing to seed test data in production!');
  console.error('    Set NODE_ENV=development or omit it to run this script.\n');
  process.exit(1);
}

// Shared live-API guard: never race the dev API on its own DB.
{
  const { refuseIfDevApiLive } = await import('../server/utils/liveApiGuard.js');
  const verdict = await refuseIfDevApiLive('seedTickets');
  if (verdict.refused) process.exit(1);
}

/**
 * Seed Sample Tickets Script
 *
 * Generates realistic helpdesk tickets covering:
 *   - All ticket statuses: Submitted to Manager, Submitted to Helpdesk Administrator, In Progress, Waiting on User, Resolved
 *   - All priorities: Low, Medium, High, Critical
 *   - All categories: Workstation Hardware, Software / Plugins, Render Farm / Network, Production Equipment, Other
 *   - Assigned and unassigned tickets
 *   - Tickets linked to assets
 *   - Comment threads (including internal-only admin notes)
 *
 * Run: node scripts/seedTickets.js
 *   or: npm run seed:tickets
 */

// ── Ticket definitions ──────────────────────────────────────────
const sampleTickets = [
  // ── Submitted to Manager tickets (new, awaiting dispatch) ──────────
  {
    user: 'staff1',
    title: 'Workstation crashing during render',
    description: 'My Mac Studio keeps kernel panicking when rendering 4K sequences in DaVinci Resolve. Happens consistently after 20 minutes of rendering. I have a deadline tomorrow.',
    category: 'Workstation Hardware',
    priority: 'Critical',
    status: 'Submitted to Manager',
    asset_type: 'Workstation',
    comments: [],
  },
  {
    user: 'staff2',
    title: 'Cannot access render farm shares',
    description: 'Getting permission denied errors when trying to mount //renderfarm/projects from my workstation. I need access to the VFX shot folder for today\'s session.',
    category: 'Render Farm / Network',
    priority: 'High',
    status: 'Submitted to Manager',
    comments: [],
  },
  {
    user: 'staff1',
    title: 'Adobe After Effects license expired',
    description: 'After Effects says my license is expired. I\'m unable to open any project files. This is blocking my compositing work.',
    category: 'Software / Plugins',
    priority: 'High',
    status: 'Submitted to Manager',
    assigned_admin: 'admin1',
    comments: [
      { user: 'admin1', text: 'Looking into the Adobe license pool now. Will update you shortly.', is_internal: false },
    ],
  },

  // ── In Progress tickets (actively being worked on) ────────────
  {
    user: 'staff2',
    title: 'Camera lens mount loose on ARRI Alexa',
    description: 'The PL mount on our ARRI Alexa Mini LF (SN-3A4F82) has developed play. Lens wobbles slightly when attached. This needs to be serviced before the shoot on Friday.',
    category: 'Production Equipment',
    priority: 'High',
    status: 'In Progress',
    assigned_admin: 'admin',
    asset_type: 'Camera',
    comments: [
      { user: 'admin', text: 'We have a backup PL mount adapter. I\'ll swap it out today.', is_internal: false },
      { user: 'admin', text: 'Ordered replacement mount from ARRI — expected delivery in 3 days.', is_internal: true },
    ],
  },
  {
    user: 'staff1',
    title: 'External monitor color calibration off',
    description: 'The Sony BVM-HX310 in Suite A is showing a noticeable green tint compared to my calibrated reference. All other monitors in the room look correct.',
    category: 'Workstation Hardware',
    priority: 'Medium',
    status: 'In Progress',
    assigned_admin: 'admin2',
    asset_type: 'Monitor',
    comments: [
      { user: 'admin2', text: 'Scheduled a calibration session for tomorrow morning. Please don\'t use it for color-critical work until then.', is_internal: false },
    ],
  },
  {
    user: 'staff2',
    title: 'Wacom tablet pen pressure not detected',
    description: 'My Wacom Cintiq Pro 24 pen pressure is not being detected in Photoshop or Blender. Reinstalled drivers but issue persists. It works fine on my personal laptop.',
    category: 'Workstation Hardware',
    priority: 'Medium',
    status: 'In Progress',
    assigned_admin: 'admin1',
    asset_type: 'Tablet',
    comments: [
      { user: 'admin1', text: 'This sounds like a driver conflict. Can you check which Wacom driver version is installed?', is_internal: false },
      { user: 'staff2', text: 'Driver version 6.4.5-1. Let me know if that helps.', is_internal: false },
      { user: 'admin1', text: 'Known issue with that version. Pushing 6.4.7-2 to your machine now.', is_internal: true },
    ],
  },

  // ── Waiting on User tickets (need more info or action) ────────
  {
    user: 'staff1',
    title: 'Request access to project archive storage',
    description: 'I need read access to the //nas/archive/2025-projects folder for a retrospective presentation next week.',
    category: 'Other',
    priority: 'Low',
    status: 'Waiting on User',
    assigned_admin: 'admin',
    comments: [
      { user: 'admin', text: 'I can set this up, but I need manager approval first. Can you forward the approval email?', is_internal: false },
    ],
  },
  {
    user: 'staff2',
    title: 'Laptop docking station not recognizing second display',
    description: 'When I dock my HP ZBook, the second monitor via DisplayPort is not detected. HDMI works fine but DP does not.',
    category: 'Workstation Hardware',
    priority: 'Medium',
    status: 'Waiting on User',
    assigned_admin: 'admin2',
    comments: [
      { user: 'admin2', text: 'Could you try a different DP cable? The ones in storage room B should work.', is_internal: false },
      { user: 'admin2', text: 'Also check if the monitor input is set to DP — I had this exact issue last month.', is_internal: true },
    ],
  },

  // ── Resolved tickets (fixed, pending close) ───────────────────
  {
    user: 'staff1',
    title: 'Slack not connecting on studio network',
    description: 'Slack desktop app shows "Connecting..." indefinitely when on the studio Wi-Fi. Works fine on my phone hotspot. Other apps work fine on studio network.',
    category: 'Render Farm / Network',
    priority: 'Medium',
    status: 'Resolved',
    assigned_admin: 'admin1',
    comments: [
      { user: 'admin1', text: 'This was a firewall rule issue. We updated the proxy config and it should work now.', is_internal: false },
      { user: 'staff1', text: 'Confirmed working now. Thanks!', is_internal: false },
    ],
  },
  {
    user: 'staff2',
    title: 'Need Blender 4.2 installed on workstation',
    description: 'Our current Blender version is 3.6 but the new pipeline requires 4.2 for Geometry Nodes compatibility.',
    category: 'Software / Plugins',
    priority: 'Medium',
    status: 'Resolved',
    assigned_admin: 'admin',
    comments: [
      { user: 'admin', text: 'Blender 4.2 LTS installed alongside 3.6. Both versions available in the Start menu.', is_internal: false },
      { user: 'staff2', text: 'Works perfectly, thank you!', is_internal: false },
    ],
  },

  // ── Resolved tickets (completed) ──────────────────────────
  {
    user: 'staff1',
    title: 'Keyboard spilling damage — replacement needed',
    description: 'Coffee was spilled on my keyboard during lunch. Several keys are sticking and the spacebar no longer registers. Need a replacement asap.',
    category: 'Workstation Hardware',
    priority: 'Low',
    status: 'Resolved',
    assigned_admin: 'admin2',
    comments: [
      { user: 'admin2', text: 'Replacement keyboard delivered to your desk. Old one disposed per e-waste policy.', is_internal: false },
      { user: 'staff1', text: 'Got it, all working. Closing this.', is_internal: false },
    ],
  },
  {
    user: 'staff2',
    title: 'VPN disconnects during large file transfers',
    description: 'When transferring files over 2GB through the VPN, the connection drops after about 5 minutes. Smaller files work fine.',
    category: 'Render Farm / Network',
    priority: 'Low',
    status: 'Resolved',
    assigned_admin: 'admin1',
    comments: [
      { user: 'admin1', text: 'Increased the VPN MTU and idle timeout settings. Should handle large transfers now.', is_internal: false },
      { user: 'staff2', text: 'Tested with a 5GB file and it completed without issue. Thanks!', is_internal: false },
    ],
  },

  // ── Unassigned tickets (submitted, not yet dispatched) ────────────
  {
    user: 'staff1',
    title: 'Request for additional SSD storage',
    description: 'My workstation is running low on storage (only 50GB free). I need at least 500GB more for the current project. Can we add an internal SSD?',
    category: 'Workstation Hardware',
    priority: 'Low',
    status: 'Submitted to Manager',
    comments: [],
  },
  {
    user: 'staff2',
    title: 'Plugin conflict causing Blender crash',
    description: 'Blender 4.2 crashes on startup when the Agora plugin is enabled. Disabling the plugin works around it but I need the plugin for motion capture import.',
    category: 'Software / Plugins',
    priority: 'Medium',
    status: 'Submitted to Manager',
    comments: [
      { user: 'staff2', text: 'Crash log attached to the ticket. Let me know if you need anything else.', is_internal: false },
    ],
  },

  // ── Critical priority edge case ───────────────────────────────
  {
    user: 'staff1',
    title: 'Production server unreachable — shoot day',
    description: 'The shared storage NAS is completely unreachable from all workstations. Multiple departments affected. This is blocking the entire production floor. URGENT.',
    category: 'Render Farm / Network',
    priority: 'Critical',
    status: 'In Progress',
    assigned_admin: 'admin',
    comments: [
      { user: 'admin', text: 'Investigating now. Looks like the NAS IP changed after last night\'s maintenance.', is_internal: false },
      { user: 'admin', text: 'NAS rebooted and DNS updated. All mounts restored.', is_internal: false },
      { user: 'staff1', text: 'Confirmed — I can access the shares again. Thank you for the quick turnaround!', is_internal: false },
      { user: 'admin', text: 'Adding NAS IP to DHCP reservation to prevent this from happening again.', is_internal: true },
    ],
  },
];

// ── Helpers ─────────────────────────────────────────────────────
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function getUserMap(db) {
  const rows = await db.all('SELECT id, name FROM users');
  const map = {};
  for (const r of rows) map[r.name] = r.id;
  return map;
}

async function getAssetIdsByType(db, type) {
  if (!type) return [];
  const rows = await db.all('SELECT id FROM assets WHERE type = ? LIMIT 1', [type]);
  return rows.map(r => r.id);
}

// ── Main ────────────────────────────────────────────────────────
async function seedTickets() {
  const db = await connectionManager.connect();
  console.log('Connected to database.\n');

  await runMigrations(db);
  console.log('Migrations applied.\n');

  const userMap = await getUserMap(db);
  const admins = Object.keys(userMap).filter(n => n.startsWith('admin'));
  const staff  = Object.keys(userMap).filter(n => n.startsWith('staff'));

  if (staff.length === 0) {
    console.error('❌ No staff users found. Run `npm run seed:users` first.');
    await connectionManager.close();
    process.exit(1);
  }

  console.log(`Found ${Object.keys(userMap).length} users (${admins.length} admins, ${staff.length} staff).\n`);

  let ticketsCreated = 0;
  let commentsCreated = 0;

  for (const t of sampleTickets) {
    const userId = userMap[t.user];
    if (!userId) {
      console.error(`  ✗ User "${t.user}" not found — skipping ticket "${t.title}"`);
      continue;
    }

    // Resolve assigned admin
    let assignedAdminId = null;
    if (t.assigned_admin) {
      assignedAdminId = userMap[t.assigned_admin] || null;
    } else if (t.status !== 'Submitted to Manager' || Math.random() > 0.5) {
      // Auto-assign some unassigned tickets for realism
      assignedAdminId = userMap[pickRandom(admins)];
    }

    // Resolve asset link
    let assetId = null;
    if (t.asset_type) {
      const ids = await getAssetIdsByType(db, t.asset_type);
      if (ids.length > 0) assetId = pickRandom(ids);
    }

    // Insert ticket
    try {
      await db.run(
        `INSERT INTO tickets (user_id, asset_id, assigned_admin_id, title, description, category, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, assetId, assignedAdminId, t.title, t.description, t.category, t.priority, t.status]
      );

      // Get the inserted ticket ID
      const row = await db.get('SELECT last_insert_rowid() as id');
      const ticketId = row.id;

      ticketsCreated++;
      const statusIcon = { 'Submitted to Manager': '🟢', 'Submitted to Helpdesk Administrator': '🔵', 'In Progress': '🔵', 'Waiting on User': '🟡', 'Resolved': '✅' };
      const icon = statusIcon[t.status] || '⚪';
      console.log(`  ${icon} #${ticketId} [${t.priority.padEnd(8)}] ${t.title}`);

      // Insert comments
      for (const c of t.comments) {
        const commentUserId = userMap[c.user] || userId;
        await db.run(
          'INSERT INTO ticket_comments (ticket_id, user_id, text, is_internal) VALUES (?, ?, ?, ?)',
          [ticketId, commentUserId, c.text, c.is_internal ? 1 : 0]
        );
        commentsCreated++;
      }
    } catch (err) {
      console.error(`  ✗ Failed to create ticket "${t.title}": ${err.message}`);
    }
  }

  // Summary
  const statusCounts = await db.all(
    'SELECT status, COUNT(*) as count FROM tickets GROUP BY status ORDER BY count DESC'
  );
  const priorityCounts = await db.all(
    'SELECT priority, COUNT(*) as count FROM tickets GROUP BY priority ORDER BY count DESC'
  );

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  TICKET SEED COMPLETE');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Tickets created : ${ticketsCreated}`);
  console.log(`  Comments created: ${commentsCreated}`);

  console.log('\n  By Status:');
  for (const s of statusCounts) {
    const bar = '█'.repeat(Math.min(s.count, 30));
    console.log(`    ${s.status.padEnd(18)} ${bar} ${s.count}`);
  }

  console.log('\n  By Priority:');
  for (const p of priorityCounts) {
    const bar = '█'.repeat(Math.min(p.count, 30));
    console.log(`    ${p.priority.padEnd(18)} ${bar} ${p.count}`);
  }

  console.log('\n  Workflow Overview:');
  console.log('  ┌──────────────────────────────────┬────────────────────────────────────────────────────┐');
  console.log('  │ Status                           │ What to test                                      │');
  console.log('  ├──────────────────────────────────┼────────────────────────────────────────────────────┤');
  console.log('  │ Submitted to Manager             │ Root admin dispatches to helpdesk admin           │');
  console.log('  │ Submitted to Helpdesk Admin      │ Admin begins working on ticket                    │');
  console.log('  │ In Progress                      │ Admin adds comments, requests info from user      │');
  console.log('  │ Waiting on User                  │ Staff responds, admin continues resolution        │');
  console.log('  │ Resolved                         │ Staff confirms fix, ticket is done                │');
  console.log('  └──────────────────────────────────┴────────────────────────────────────────────────────┘');
  console.log('');

  await connectionManager.close();
  console.log('Database connection closed. Done!\n');
}

seedTickets().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
