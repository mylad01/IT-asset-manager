// Migration: conversation workspace v2
//   1. Normalize attachment file_path from absolute to uploads-relative
//      (idempotent — re-running the string surgery on already-relative rows
//      is a no-op because the marker match is the same).
//   2. Soft-delete columns on conversation_messages (root oversight
//      tombstones) — added to the archive schema at creation, retrofitted
//      here for the active DB.
//   3. is_archived/index retained for rollback safety; new behavior no
//      longer writes it (hard-move archive supersedes the flag).
//   4. Settings seeds for auto-archive / retention / quota (all OFF/0).

export async function up(db) {
  // ── 1. Relative attachment paths ──
  // Match any path containing a 'conversations' segment; keep from the LAST
  // occurrence through the basename. Covers:
  //   D:\app\uploads\conversations\abc.png     → conversations/abc.png
  //   /app/uploads/conversations/abc.png       → conversations/abc.png
  //   conversations/abc.png                    → conversations/abc.png (no-op)
  const rows = await db.all(`SELECT id, file_path FROM message_attachments`);
  let normalized = 0;
  for (const row of rows) {
    if (!row.file_path) continue;
    const norm = String(row.file_path).replace(/\\/g, '/');
    const marker = norm.lastIndexOf('conversations/');
    const rel = marker === -1 ? `conversations/${norm.split('/').pop()}` : norm.slice(marker);
    if (rel !== row.file_path) {
      await db.run('UPDATE message_attachments SET file_path = ? WHERE id = ?', [rel, row.id]);
      normalized++;
    }
  }
  if (normalized > 0) {
    console.log(`[migration] Normalized ${normalized} attachment paths to uploads-relative form`);
  }

  // ── 2. Message soft-delete columns (oversight tombstones) ──
  const cols = await db.all(`PRAGMA table_info(conversation_messages)`);
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('deleted_at')) {
    await db.exec(`ALTER TABLE conversation_messages ADD COLUMN deleted_at DATETIME`);
  }
  if (!colNames.has('deleted_by')) {
    await db.exec(`ALTER TABLE conversation_messages ADD COLUMN deleted_by INTEGER`);
  }

  // ── 3. Settings seeds ──
  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['conversation_auto_archive_enabled', '0']);
  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['conversation_auto_archive_days', '90']);
  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['conversation_retention_days', '30']);
  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['conversation_archive_retention_days', '0']);
  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['conversation_storage_quota_mb', '0']);

  // ── 4. Storage trees ──
  const fs = await import('fs');
  const path = await import('path');
  const archiveDir = path.default.join(process.cwd(), 'uploads', 'archive', 'conversations');
  if (!fs.default.existsSync(archiveDir)) {
    fs.default.mkdirSync(archiveDir, { recursive: true });
  }
}

export async function down(db) {
  // Path normalization is not reversed (absolute paths were strictly worse);
  // soft-delete columns and settings are removed.
  await db.exec(`ALTER TABLE conversation_messages DROP COLUMN deleted_at`);
  await db.exec(`ALTER TABLE conversation_messages DROP COLUMN deleted_by`);
  await db.run(`DELETE FROM system_settings WHERE key IN (?, ?, ?, ?, ?)`, [
    'conversation_auto_archive_enabled',
    'conversation_auto_archive_days',
    'conversation_retention_days',
    'conversation_archive_retention_days',
    'conversation_storage_quota_mb',
  ]);
}
