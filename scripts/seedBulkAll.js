import Database from 'better-sqlite3';
import path from 'path';

// ── Safety guard (same as reset:db / seed:*) ──
// Bulk-seeds random hardware — never into a production database.
if (process.env.NODE_ENV === 'production') {
  console.error('\n❌  Refusing to bulk-seed assets in production!');
  console.error('    Set NODE_ENV=development or omit it to run this script.\n');
  process.exit(1);
}

// ── Live-server guard (same block as every other DB-writing script) ──
// Refuses while the dev API serves :3000 OR a ghost node process holds the
// dev DB without a listener — this script bulk-writes with FK checks off.
{
  const { refuseIfDevApiLive } = await import('../server/utils/liveApiGuard.js');
  const verdict = await refuseIfDevApiLive('seedBulkAll');
  if (verdict.refused) process.exit(1);
}

const DB_PATH = path.resolve('./database.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const GEAR = {
  Workstation: ['Mac Studio M2 Ultra', 'HP Z8 Fury', 'Threadripper PRO 5995WX', 'Dell Precision 7920'],
  Camera: ['ARRI Alexa Mini LF', 'RED V-Raptor 8K', 'Sony FX9', 'Blackmagic URSA Mini 12K'],
  Monitor: ['Sony BVM-HX310', 'EIZO ColorEdge CG319X', 'Apple Pro Display XDR'],
  Tablet: ['Wacom Cintiq Pro 24', 'Wacom Intuos Pro L', 'iPad Pro 12.9 M2'],
  Laptop: ['MacBook Pro 16 M3 Max', 'Dell XPS 17', 'Lenovo ThinkPad P16'],
  Lens: ['Zeiss Master Prime 35mm', 'Cooke S4/i 50mm', 'Angenieux Optimo 24-290mm'],
  Lighting: ['ARRI SkyPanel S60-C', 'Aputure LS 1200d Pro', 'Astera Titan Tube Kit'],
};
const ASSET_TYPES = Object.keys(GEAR);
const DEPT_IDS = [1, 2, 3, 4, 5, 6];
const LOCATIONS = ['Stage A','Stage B','Stage C','Edit Suite 1','Edit Suite 2','VFX Lab','Server Room','Color Suite'];
const STATUSES = ['Deployed', 'In Storage', 'In Repair', 'Retired'];
const TICKET_STATUSES = ['Submitted to Manager', 'In Progress', 'Waiting on User', 'Resolved', 'Closed'];
const CATEGORIES = ['Workstation Hardware', 'Software / Plugins', 'Render Farm / Network', 'Production Equipment', 'Other'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

const FIRST = ['James','Sarah','Michael','Emily','David','Jessica','Chris','Amanda','Daniel','Rachel','Matthew','Laura','Andrew','Jennifer','Ryan','Megan','Tyler','Ashley','Brandon','Stephanie','Kevin','Nicole','Jason','Michelle','Brian','Kimberly','Timothy','Lisa','Mark','Karen'];
const LAST = ['Anderson','Thompson','Garcia','Martinez','Robinson','Clark','Lewis','Lee','Walker','Hall','Allen','Young','King','Wright','Scott','Green','Baker','Adams','Nelson','Hill'];

const TICKET_TITLES = [
  'Workstation crashing during render', 'Cannot access render farm shares', 'Adobe After Effects license expired',
  'Camera lens mount loose', 'External monitor color calibration off', 'Wacom tablet pen pressure not detected',
  'Laptop docking station not recognizing displays', 'Slack not connecting on studio network',
  'Need Blender 4.2 installed', 'Keyboard spilling damage', 'VPN disconnects during large file transfers',
  'Request for additional SSD storage', 'Plugin conflict causing crash', 'Production server unreachable — shoot day',
  'DaVinci Resolve color space issue', 'Render farm node 7 not responding', 'RED camera recording artifacts at 8K',
  'Audio sync issue on multi-cam timeline', 'Storage array approaching 90% capacity', 'AVID license server down',
  'ARRI Alexa Mini overheating on set', 'Wireless follow focus dropping', 'Need Nuke license for compositing',
  'G-RAID shuttle not mounting', 'Dailies not syncing to NAS',
];

const CONV_TOPICS = [
  'Camera Dept — RED Focus Issues', 'VFX Render Pipeline Discussion', 'Stage B Lighting Setup',
  'Edit Suite Scheduling', 'Storage Upgrade Planning', 'New Lens Purchase Approval',
  'Audio Equipment Calibration', 'Network Bandwidth Issues', 'Wacom Tablet Replacement', 'Monitor Calibration',
  'RE: Workstation crashing', 'RE: Camera lens mount', 'RE: Storage at 90%', 'RE: Render farm node 7', 'RE: ARRI overheating',
];

const CHAT_MSGS = [
  "Hey team, can someone check the RED camera in Stage A?",
  "The back focus seems off. We might need to recalibrate.",
  "Budget approved for the new Zeiss lenses.",
  "Render farm running at 95% capacity.",
  "Can we schedule a color calibration session?",
  "Just finished the dailies sync — footage looks great.",
  "Note: Insurance claim for damaged ARRI is pending.",
  "Reminder: All workstations need security patch by Friday.",
  "Wacom tablets in Edit Suite 2 are acting up.",
  "Network switch in Stage C was replaced. Test connectivity.",
  "New audio gear arriving tomorrow.",
  "Internal: Evaluating switching from Avid to DaVinci.",
  "Client wants color reference still from RED footage.",
  "Storage at 87%. Archive completed projects.",
  "Can someone help with Blender 4.2 installation?",
  "Grip truck inventory low — missing C-stands.",
  "Lighting rig for Stage B needs re-rigging.",
  "Server room AC acting up.",
  "Netflix delivery format: ProRes 4444, 4K.",
  "Internal: Budget meeting Thursday.",
];

console.log('╔════════════════════════════════════════════════╗');
console.log('║  BULK DATA GENERATOR — Full Test Environment  ║');
console.log('╚════════════════════════════════════════════════╝\n');

try {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN TRANSACTION');

  // 1. USERS
  console.log('👥 Generating users...');
  const insertUser = db.prepare(`INSERT OR IGNORE INTO users (name, email, password_hash, role, dept_id, requires_password_change, is_root) VALUES (?, ?, ?, ?, ?, 0, 0)`);
  let userCount = 0;
  const usedEmails = new Set(db.prepare('SELECT email FROM users').all().map(r => r.email));
  for (let i = 0; i < 50; i++) {
    const name = `${pick(FIRST).toLowerCase()}${rand(1, 99)}`;
    const email = `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}@studio.com`;
    if (usedEmails.has(email)) continue;
    usedEmails.add(email);
    const r = insertUser.run(name, email, '$2b$10$placeholder', pick(['IT Admin', 'Staff']), pick(DEPT_IDS));
    if (r.changes > 0) userCount++;
  }
  console.log(`   ✅ ${userCount} new users`);

  // Get all user IDs
  const userIds = db.prepare('SELECT id FROM users').all().map(r => r.id);
  const adminIds = userIds.slice(0, 3); // first 3 are admins

  // 2. ASSETS
  console.log('📦 Generating assets...');
  const insertAsset = db.prepare(`INSERT OR IGNORE INTO assets (id, type, model, serial_number, purchase_date, purchase_cost, status, dept_id, assigned_to_user_id, image_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '/uploads/dummy-seed.png', ?)`);
  let assetCount = 0;
  for (let i = 0; i < 100; i++) {
    const type = pick(ASSET_TYPES);
    const model = pick(GEAR[type]);
    const assetId = `${type.substring(0, 3).toUpperCase()}-${rand(1000, 9999)}`;
    const status = pick(STATUSES);
    const r = insertAsset.run(assetId, type, model, `SN-${rand(0x100000, 0xFFFFFF).toString(16).toUpperCase()}`, `${rand(2020, 2025)}-${String(rand(1, 12)).padStart(2, '0')}-${String(rand(1, 28)).padStart(2, '0')}`, rand(500, 75000), status, pick(DEPT_IDS), status === 'Deployed' ? pick(userIds) : null, `${model} — ${pick(LOCATIONS)}`);
    if (r.changes > 0) assetCount++;
  }
  console.log(`   ✅ ${assetCount} assets`);

  // 3. TICKETS
  console.log('🎫 Generating tickets...');
  const insertTicket = db.prepare(`INSERT INTO tickets (user_id, asset_id, assigned_admin_id, title, description, category, priority, status, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, datetime('now', ?))`);
  let ticketCount = 0;
  for (let i = 0; i < 50; i++) {
    insertTicket.run(pick(userIds), pick(adminIds), TICKET_TITLES[i % TICKET_TITLES.length] + (i >= TICKET_TITLES.length ? ` #${rand(100, 999)}` : ''), `Description for ticket`, pick(CATEGORIES), pick(PRIORITIES), pick(TICKET_STATUSES), `-${rand(0, 60)} days`);
    ticketCount++;
  }
  console.log(`   ✅ ${ticketCount} tickets`);

  // 4. TICKET COMMENTS
  console.log('💬 Generating ticket comments...');
  const insertComment = db.prepare(`INSERT INTO ticket_comments (ticket_id, user_id, text, is_internal, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))`);
  let commentCount = 0;
  const ticketIds = db.prepare('SELECT id FROM tickets').all().map(r => r.id);
  for (const tId of ticketIds) {
    for (let j = 0; j < rand(1, 3); j++) {
      insertComment.run(tId, pick(userIds), pick(CHAT_MSGS), Math.random() < 0.2 ? 1 : 0, `-${rand(0, 30)} days`);
      commentCount++;
    }
  }
  console.log(`   ✅ ${commentCount} ticket comments`);

  // 5. CONVERSATIONS
  console.log('🗣️ Generating conversations...');
  const insertConv = db.prepare(`INSERT INTO conversations (title, type, ticket_id, created_by, is_archived, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, datetime('now', ?), datetime('now', ?))`);
  let convCount = 0;
  for (let i = 0; i < 30; i++) {
    const archived = i < 2 ? 1 : 0;
    const daysAgo = rand(0, 30);
    // 'standalone' for every row: ticket-linked REQUIRES a real ticket_id
    // (strict CHECK since 20261005000001) and this synthetic seed always
    // passes NULL — the old `i < 15 ? 'standalone' : 'ticket-linked'` ternary
    // crashed the script at row 16 with CHECK constraint failed.
    insertConv.run(CONV_TOPICS[i % CONV_TOPICS.length] + (i >= CONV_TOPICS.length ? ` [${i}]` : ''), 'standalone', pick(adminIds), archived, `-${daysAgo} days`, `-${rand(0, daysAgo)} days`);
    convCount++;
  }
  console.log(`   ✅ ${convCount} conversations`);

  // Get conversation IDs
  const convIds = db.prepare('SELECT id FROM conversations').all().map(r => r.id);

  // 6. PARTICIPANTS
  console.log('👥 Generating participants...');
  const insertParticipant = db.prepare(`INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, datetime('now', ?))`);
  let participantCount = 0;
  for (const convId of convIds) {
    const numP = rand(2, 5);
    const parts = new Set([pick(adminIds)]);
    while (parts.size < numP) parts.add(pick(userIds));
    for (const uid of parts) {
      const r = insertParticipant.run(convId, uid, uid <= 3 ? 'admin' : 'member', `-${rand(0, 7)} days`);
      if (r.changes > 0) participantCount++;
    }
  }
  console.log(`   ✅ ${participantCount} participants`);

  // 7. MESSAGES
  console.log('📨 Generating messages...');
  const insertMsg = db.prepare(`INSERT INTO conversation_messages (conversation_id, user_id, content, is_internal, is_edited, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`);
  let msgCount = 0;
  const allMsgIds = [];
  for (const convId of convIds) {
    for (let j = 0; j < rand(3, 8); j++) {
      const h = rand(0, 168);
      const r = insertMsg.run(convId, pick(userIds), pick(CHAT_MSGS), Math.random() < 0.15 ? 1 : 0, Math.random() < 0.1 ? 1 : 0, `-${h} hours`, `-${Math.max(0, h - rand(0, 2))} hours`);
      if (r.changes > 0) { msgCount++; allMsgIds.push(Number(r.lastInsertRowid)); }
    }
  }
  console.log(`   ✅ ${msgCount} messages`);

  // 8. REACTIONS
  console.log('😊 Generating reactions...');
  const insertReaction = db.prepare(`INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)`);
  let reactionCount = 0;
  const emojis = ['👍', '🔥', '❤️', '👀', '🎉', '💯'];
  for (const msgId of allMsgIds) {
    for (let r = 0; r < rand(0, 3); r++) {
      const res = insertReaction.run(msgId, pick(userIds), pick(emojis));
      if (res.changes > 0) reactionCount++;
    }
  }
  console.log(`   ✅ ${reactionCount} reactions`);

  // 9. READS
  console.log('👁️ Generating reads...');
  const insertRead = db.prepare(`INSERT OR REPLACE INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES (?, ?, datetime('now', ?))`);
  let readCount = 0;
  for (const convId of convIds) {
    for (const uid of userIds.slice(0, 5)) {
      insertRead.run(convId, uid, `-${rand(0, 48)} hours`);
      readCount++;
    }
  }
  console.log(`   ✅ ${readCount} reads`);

  // 10. NOTIFICATIONS
  console.log('🔔 Generating notifications...');
  const insertNotif = db.prepare(`INSERT INTO notifications (user_id, type, title, message, is_read, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`);
  let notifCount = 0;
  const nTypes = ['ticket', 'asset', 'system', 'backup'];
  const nTitles = { ticket: ['Ticket assigned', 'Ticket updated', 'Ticket resolved'], asset: ['Asset assigned', 'Asset returned'], system: ['Backup complete', 'Maintenance scheduled'], backup: ['Backup started', 'Backup done', 'Backup failed'] };
  for (let i = 0; i < 40; i++) {
    const t = pick(nTypes);
    insertNotif.run(pick(userIds.slice(0, 10)), t, pick(nTitles[t]), 'Details', Math.random() < 0.6 ? 1 : 0, pick(['info', 'warning', 'critical']), `-${rand(0, 72)} hours`);
    notifCount++;
  }
  console.log(`   ✅ ${notifCount} notifications`);

  db.exec('PRAGMA foreign_keys = ON');
  db.exec('COMMIT');

  console.log('\n══════════════════════════════════════════════════');
  console.log('📊 DATABASE SUMMARY');
  console.log('══════════════════════════════════════════════════');
  const s = (q) => db.prepare(q).get().c;
  console.log(`  👥 Users:           ${s('SELECT COUNT(*) as c FROM users')}`);
  console.log(`  📦 Assets:          ${s('SELECT COUNT(*) as c FROM assets')}`);
  console.log(`  🎫 Tickets:         ${s('SELECT COUNT(*) as c FROM tickets')}`);
  console.log(`  💬 Comments:        ${commentCount}`);
  console.log(`  🗣️  Conversations:   ${s('SELECT COUNT(*) as c FROM conversations')}`);
  console.log(`  👥 Participants:    ${participantCount}`);
  console.log(`  📨 Messages:        ${msgCount}`);
  console.log(`  😊 Reactions:       ${reactionCount}`);
  console.log(`  👁️  Reads:           ${readCount}`);
  console.log(`  🔔 Notifications:   ${notifCount}`);
  console.log('══════════════════════════════════════════════════');
  console.log('\n🎉 Ready for manual testing!');
  console.log('\n🔑 Login credentials:');
  console.log('  Root Admin:  admin@studio.com / admin');
  console.log('  IT Admin:    admin1@studio.com / 12345678');
  console.log('  IT Admin:    admin2@studio.com / 12345678');
  console.log('  Staff:       staff1@studio.com / 12345678');
  console.log('  Staff:       staff2@studio.com / 12345678');
  console.log('  (New users use password: password)');

} catch (err) {
  db.exec('ROLLBACK');
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
} finally {
  db.close();
}
