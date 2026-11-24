const Database = require('better-sqlite3');
const db = new Database('database.sqlite');

console.log('=== NOTIFICATIONS TABLE ===');
const notificationsTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notifications'").get();
console.log(notificationsTable?.sql);

console.log('\n=== SYSTEM_SETTINGS TABLE ===');
const settingsTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='system_settings'").get();
console.log(settingsTable?.sql);

console.log('\n=== NOTIFICATIONS INDEXES ===');
const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name LIKE '%notifications%'").all();
indexes.forEach(idx => console.log(idx.sql));

console.log('\n=== SYSTEM_SETTINGS DATA ===');
const settings = db.prepare("SELECT * FROM system_settings").all();
console.table(settings);

console.log('\n=== BACKUP_LOGS TABLE ===');
const backupTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='backup_logs'").get();
console.log(backupTable?.sql);

console.log('\n=== USERS TABLE (check root admin) ===');
const users = db.prepare("SELECT id, name, email, role FROM users WHERE role = 'IT Admin'").all();
console.table(users);