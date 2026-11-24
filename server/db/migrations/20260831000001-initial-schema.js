// Migration 20260831000001-initial-schema
// Creates all 11 tables and 13 indexes
// Uses CREATE TABLE IF NOT EXISTS for idempotency

export async function up(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS asset_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT, role TEXT DEFAULT 'Staff', dept_id INTEGER, requires_password_change INTEGER DEFAULT 1, FOREIGN KEY(dept_id) REFERENCES departments(id) ON DELETE SET NULL)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, type TEXT NOT NULL, model TEXT NOT NULL, serial_number TEXT, purchase_date DATE, purchase_cost REAL, notes TEXT, custom_attributes TEXT, image_url TEXT NOT NULL DEFAULT '', status TEXT DEFAULT 'In Storage', dept_id INTEGER, assigned_to_user_id INTEGER, FOREIGN KEY(type) REFERENCES asset_types(name) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY(dept_id) REFERENCES departments(id) ON DELETE SET NULL, FOREIGN KEY(assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, asset_id TEXT, assigned_admin_id INTEGER, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, priority TEXT DEFAULT 'Medium', status TEXT DEFAULT 'Open', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE SET NULL, FOREIGN KEY(assigned_admin_id) REFERENCES users(id) ON DELETE SET NULL)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS ticket_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, user_id INTEGER NOT NULL, text TEXT NOT NULL, is_internal INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS ticket_reads (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, user_id INTEGER NOT NULL, last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(ticket_id, user_id), FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, message TEXT NOT NULL, is_read INTEGER DEFAULT 0, snooze_until DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT, user_id INTEGER, action_type TEXT NOT NULL, notes TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE SET NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS consumables (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, quantity INTEGER DEFAULT 0, threshold INTEGER DEFAULT 5)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS kits (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS kit_items (id INTEGER PRIMARY KEY AUTOINCREMENT, kit_id INTEGER, asset_type TEXT, quantity INTEGER DEFAULT 1, FOREIGN KEY(kit_id) REFERENCES kits(id) ON DELETE CASCADE)`);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(assigned_to_user_id);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_time ON transactions(timestamp);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_admin ON tickets(assigned_admin_id);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_asset ON transactions(asset_id);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_assets_dept ON assets(dept_id);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_kit_items_kit ON kit_items(kit_id);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_assets_type_unassigned ON assets(type, assigned_to_user_id) WHERE assigned_to_user_id IS NULL;');
}

export async function down(db) {
  await db.exec('PRAGMA foreign_keys = OFF');
  await db.exec('DROP TABLE IF EXISTS kit_items');
  await db.exec('DROP TABLE IF EXISTS kits');
  await db.exec('DROP TABLE IF EXISTS consumables');
  await db.exec('DROP TABLE IF EXISTS transactions');
  await db.exec('DROP TABLE IF EXISTS notifications');
  await db.exec('DROP TABLE IF EXISTS ticket_reads');
  await db.exec('DROP TABLE IF EXISTS ticket_comments');
  await db.exec('DROP TABLE IF EXISTS tickets');
  await db.exec('DROP TABLE IF EXISTS assets');
  await db.exec('DROP TABLE IF EXISTS users');
  await db.exec('DROP TABLE IF EXISTS asset_types');
  await db.exec('DROP TABLE IF EXISTS departments');
  await db.exec('PRAGMA foreign_keys = ON');
}
