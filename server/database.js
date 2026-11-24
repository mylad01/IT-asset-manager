// database.js - New boot sequence: connect -> migrate -> timeout proxy -> return
// Replaces the old getDb() pattern that ran schema + seed on every startup

import connectionManager from './db/connection.js';
import { runMigrations } from './db/migrations/umzug-instance.js';
import { createTimedDb } from './db/queryTimeout.js';

let dbPromise = null;

export async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      // Step 1: Establish the raw SQLite connection with PRAGMAs and health check
      const rawDb = await connectionManager.connect();
      // Step 2: Run all pending Umzug migrations (schema + seed if needed)
      await runMigrations(rawDb);
      // Step 3: Wrap with timeout-enforced proxy for all query methods
      const timedDb = createTimedDb(rawDb);
      // Return the proxied database for models and services to use
      return timedDb;
    })();
  }
  return dbPromise;
}
