import { getDb } from '../database.js';

export async function logBackup({ filename, sizeBytes, status, errorMessage = null, manifestHashHex = null }) {
  const db = await getDb();
  const result = await db.run(
    'INSERT INTO conversation_backup_logs (filename, size_bytes, status, error_message, manifest_hash_hex) VALUES (?, ?, ?, ?, ?)',
    [filename, sizeBytes, status, errorMessage, manifestHashHex]
  );
  return result.lastID;
}

export async function getBackupHistory(limit = 20) {
  const db = await getDb();
  return db.all(
    'SELECT * FROM conversation_backup_logs ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
}
