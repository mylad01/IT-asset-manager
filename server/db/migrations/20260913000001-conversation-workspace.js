export async function up(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'standalone' CHECK(type IN ('standalone', 'ticket-linked')),
      ticket_id INTEGER,
      created_by INTEGER NOT NULL,
      is_archived INTEGER DEFAULT 0,
      archived_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
      FOREIGN KEY(created_by) REFERENCES users(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member' CHECK(role IN ('member', 'admin')),
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id, user_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_internal INTEGER DEFAULT 0,
      is_edited INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, emoji),
      FOREIGN KEY(message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id, user_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_backup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_ticket ON conversations(ticket_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(is_archived)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_participants_conv ON conversation_participants(conversation_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages(conversation_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_messages_user ON conversation_messages(user_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_messages_created ON conversation_messages(created_at DESC)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_msg_attachments_msg ON message_attachments(message_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_msg_reactions_msg ON message_reactions(message_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_reads_conv ON conversation_reads(conversation_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_backup_logs_created ON conversation_backup_logs(created_at DESC)');

  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['conversation_auto_backup', '0']);
  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['conversation_backup_interval', '24']);

  const fs = await import('fs');
  const path = await import('path');
  const uploadsDir = path.default.join(process.cwd(), 'uploads', 'conversations');
  if (!fs.default.existsSync(uploadsDir)) {
    fs.default.mkdirSync(uploadsDir, { recursive: true });
  }
}

export async function down(db) {
  await db.exec('DROP TABLE IF EXISTS conversation_backup_logs');
  await db.exec('DROP TABLE IF EXISTS conversation_reads');
  await db.exec('DROP TABLE IF EXISTS message_reactions');
  await db.exec('DROP TABLE IF EXISTS message_attachments');
  await db.exec('DROP TABLE IF EXISTS conversation_messages');
  await db.exec('DROP TABLE IF EXISTS conversation_participants');
  await db.exec('DROP TABLE IF EXISTS conversations');
  await db.run(`DELETE FROM system_settings WHERE key IN (?, ?)`, ['conversation_auto_backup', 'conversation_backup_interval']);
}
