// scripts/runMigrations.js // File path definition
import { getDb } from '../server/database.js'; // Import the main database connection manager
import { runMigrations } from '../server/db/migrations/umzug-instance.js'; // Import the Umzug migration runner

// ── Live-server guard (same block as every other DB-writing script) ──
// Refuses while the dev API serves :3000 OR a ghost node process holds the
// dev DB without a listener — migrations must not race a live writer.
{
  const { refuseIfDevApiLive } = await import('../server/utils/liveApiGuard.js');
  const verdict = await refuseIfDevApiLive('runMigrations');
  if (verdict.refused) process.exit(1);
}

const execute = async () => { // Define the main asynchronous execution block
  try { // Begin protected execution block
    console.log('🔌 Connecting to SQLite database...'); // Log the connection attempt to the console
    const db = await getDb(); // Initialize the database and acquire the active connection instance
    
    console.log('🚀 Running pending migrations...'); // Log the start of the migration process
    await runMigrations(db); // Pass the active database instance directly into Umzug to fix the null reference error
    
    console.log('✅ Migrations applied successfully!'); // Log successful completion
    process.exit(0); // Exit the Node process cleanly with a success code
  } catch (error) { // Catch any errors thrown during execution
    console.error('❌ Migration failed to execute:', error); // Log the error message and stack trace
    process.exit(1); // Exit the Node process with a failure code
  } // End try-catch block
}; // End execution function

execute(); // Fire the script immediately when the file is executed