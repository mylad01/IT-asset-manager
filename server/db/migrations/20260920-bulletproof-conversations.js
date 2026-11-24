// server/db/migrations/20260920-bulletproof-conversations.js // File path definition
export const up = async (db) => { // Export the up migration function receiving the database instance
  await db.exec('PRAGMA foreign_keys = OFF;'); // Temporarily disable foreign keys so we can rebuild tables safely
  await db.exec('BEGIN TRANSACTION;'); // Start a database transaction to ensure atomicity

  await db.exec(` -- Execute raw SQL query for creating the new conversations table
    CREATE TABLE conversations_new ( -- Create a fresh table with our bulletproof constraints
      id INTEGER PRIMARY KEY, -- Primary key for the conversation record
      title TEXT NOT NULL, -- Conversation title, mandatory
      type TEXT NOT NULL DEFAULT 'standalone', -- Type of chat, defaults to standalone
      ticket_id INTEGER, -- Optional ticket ID reference
      created_by INTEGER NOT NULL, -- Creator user ID
      is_archived INTEGER DEFAULT 0, -- Archive flag (0 = active; 1 = hidden from the default list)
      archived_at DATETIME, -- Archival timestamp
      archived_by INTEGER, -- User who archived the chat
      archive_reason TEXT, -- Text description of why it was archived
      deleted_at DATETIME, -- Soft delete timestamp
      deleted_by INTEGER, -- User who deleted it
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Creation time default
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Update time default
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT, -- Enforce that the creator exists
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE, -- If the parent ticket is deleted, delete the conversation
      CONSTRAINT chk_ticket_logic CHECK (type = 'standalone' OR (type = 'ticket' AND ticket_id IS NOT NULL)) -- Core logic fix: A ticket conversation MUST have a ticket_id
    ); -- Close table creation
  `); // Close table creation execution

  // CLEANUP: Fix dirty legacy data so the constraint doesn't fail during the copy
  await db.exec(`
    UPDATE conversations SET type = 'standalone' WHERE type = 'ticket' AND ticket_id IS NULL; -- Fix orphan ticket chats
    UPDATE conversations SET type = 'standalone' WHERE type NOT IN ('standalone', 'ticket'); -- Fix rogue types
  `);

  const convCols = await db.all('PRAGMA table_info(conversations)'); // Dynamically fetch actual columns from the old conversations table
  const convColNames = convCols.map(c => c.name).join(', '); // Extract and join the column names to handle the schema count mismatch
  await db.run(`INSERT INTO conversations_new (${convColNames}) SELECT ${convColNames} FROM conversations;`); // Safely map and copy only the columns that actually exist
  
  await db.exec('DROP TABLE conversations;'); // Destroy the old unprotected table
  await db.exec('ALTER TABLE conversations_new RENAME TO conversations;'); // Rename our bulletproof table to the standard name

  await db.exec(` -- Execute raw SQL query for creating the new messages table
    CREATE TABLE conversation_messages_new ( -- Create a fresh table for messages
      id INTEGER PRIMARY KEY, -- Primary key for the message
      conversation_id INTEGER NOT NULL, -- ID of the conversation it belongs to
      user_id INTEGER NOT NULL, -- ID of the user who sent it
      content TEXT NOT NULL, -- Message payload
      is_internal INTEGER DEFAULT 0, -- Internal staff note flag
      is_edited INTEGER DEFAULT 0, -- Flag indicating message edit
      deleted_at DATETIME, -- Soft delete timestamp
      deleted_by INTEGER, -- User who soft deleted it
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Message creation time
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Message update time
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE, -- Cascade delete messages if the conversation is destroyed
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE -- Cascade delete messages if the user is destroyed
    ); -- Close table creation
  `); // Close table creation execution

  const msgCols = await db.all('PRAGMA table_info(conversation_messages)'); // Dynamically fetch actual columns from the old messages table
  const msgColNames = msgCols.map(c => c.name).join(', '); // Extract and join the column names to handle schema differences
  await db.run(`INSERT INTO conversation_messages_new (${msgColNames}) SELECT ${msgColNames} FROM conversation_messages;`); // Safely map and copy only the existing columns

  await db.exec('DROP TABLE conversation_messages;'); // Destroy old unprotected messages table
  await db.exec('ALTER TABLE conversation_messages_new RENAME TO conversation_messages;'); // Rename to standard name

  await db.exec('COMMIT;'); // Save all transaction changes to disk
  await db.exec('PRAGMA foreign_keys = ON;'); // Re-enable strict foreign key enforcement
}; // Close up function

export const down = async (db) => { // Export down migration for rollbacks
  // Provide basic fallback queries here if required // Down migration placeholder
}; // Close down function