// umzug-instance.js - Bootstraps Umzug migration runner with SQLite storage adapter
// Tracks applied migrations in a _migrations table

import { Umzug } from 'umzug';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SqliteStorage: Custom Umzug storage backend using a _migrations table
class SqliteStorage {
  constructor({ connection }) { this.connection = connection; }

  // Log that a migration has been applied
  async logMigration({ name }) {
    await this.connection.run(
      'INSERT OR IGNORE INTO _migrations (name, created_at) VALUES (?, ?)',
      [name, new Date().toISOString()]
    );
  }

  // Remove a migration from the tracking table
  async unlogMigration({ name }) {
    await this.connection.run('DELETE FROM _migrations WHERE name = ?', [name]);
  }

  // Return list of all applied migration names
  async executed() {
    await this.connection.exec(
      'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)'
    );
    const rows = await this.connection.all('SELECT name FROM _migrations ORDER BY created_at ASC');
    return rows.map((r) => r.name);
  }
}

// ESM-compatible resolver using dynamic import() instead of require()
// Converts absolute paths to file:// URLs for cross-platform ESM compatibility
function esmResolver({ name, path: filePath }) {
  // On Windows, absolute paths (e.g. D:\...) must be converted to file:// URLs
  // for dynamic import() to work. pathToFileURL handles this correctly on all OS.
  const fileUrl = path.isAbsolute(filePath) ? pathToFileURL(filePath).href : filePath;
  // Umzug calls migration.up({ name, path, context }) — a single params object.
  // We must destructure { context } from that object to pass the raw DB handle
  // to the migration module's up(db) function.
  // The resolver MUST return { name, up, down } — Umzug merges this into the
  // migration object (line 355 of umzug.js) and uses `name` for _migrations tracking.
  return {
    name,
    up: async ({ context } = {}) => { const mod = await import(fileUrl); return mod.up(context); },
    down: async ({ context } = {}) => {
      const mod = await import(fileUrl);
      if (mod.down) return mod.down(context);
      throw new Error('Migration ' + name + ' does not define a down() function');
    },
  };
}

// Create a configured Umzug instance with SQLite storage
export function createUmzug(db) {
  return new Umzug({
    storage: new SqliteStorage({ connection: db }),
    migrations: { glob: [path.join(__dirname, '*.js').replace(/\\/g, '/'), { ignore: ['**/umzug-instance.js'] }], resolve: esmResolver },
    context: db,
    logger: console,
  });
}

// Execute all pending migrations
export async function runMigrations(db) {
  const umzug = createUmzug(db);
  await umzug.up();
  console.log('[migrations] All pending migrations applied successfully');
}

// List executed and pending migrations
export async function getMigrationStatus(db) {
  const umzug = createUmzug(db);
  const executed = await umzug.executed();
  const pending = await umzug.pending();
  return { executed: executed.map((m) => m.name), pending: pending.map((m) => m.name) };
}
