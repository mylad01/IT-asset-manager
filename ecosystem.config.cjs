// ecosystem.config.cjs — PM2 Process Management Configuration
// ──────────────────────────────────────────────────────────────
// This file must be CommonJS (.cjs) because the project uses ESM ("type": "module")
// and PM2's ecosystem loader requires CommonJS module.exports.

module.exports = {
  apps: [
    {
      // ── Application Identity ──
      name: 'it-asset-manager',       // Unique process name used by all pm2 CLI commands (start, stop, reload, logs)
      script: 'server/index.js',      // Entry point script executed by Node.js — relative to project root

      // ── Runtime Configuration ──
      interpreter: 'node',            // Explicitly use node as the interpreter (avoids pm2 using a system default)
      node_args: '--max-old-space-size=512', // V8 heap cap of 512MB — hard ceiling before OOM, works with max_memory_restart

      // ── Execution Mode ──
      // Fork mode (single instance) is mandatory: SQLite WAL allows only one writer.
      // Cluster mode would fork multiple processes all writing to the same .sqlite file, causing SQLITE_BUSY deadlocks.
      instances: 1,                   // Single instance — SQLite single-writer constraint
      exec_mode: 'fork',              // Fork mode instead of cluster — each instance is an independent process

      // ── Environment Variables ──
      // PM2 merges the selected env block into process.env at startup.
      // Use --env production with `pm2 start ecosystem.config.cjs --env production` to select this block.
      env_production: {
        NODE_ENV: 'production',        // Signals production mode to Pino (multistream) and Express (stricter error handling)
        PORT: 3000,                    // HTTP listen port — must match your deployment target
      },

      // ── Restart Policy ──
      autorestart: true,              // PM2 automatically restarts the process if it exits for any reason (crash, uncaught exception, etc.)
      max_restarts: 10,               // Maximum consecutive restart attempts before PM2 gives up — prevents infinite restart loops
      min_uptime: '5s',               // Process must survive at least 5 seconds to be considered "started" — crashes before this trigger backoff
      restart_delay: 3000,            // Wait 3 seconds between restarts — gives the OS time to release the port and file locks
      exp_backoff_restart_delay: 100, // Exponential backoff starting at 100ms — each failed start doubles the delay (100, 200, 400, 800...)

      // ── Memory Safety ──
      max_memory_restart: '400M',     // PM2 kills and restarts the process if RSS exceeds 400MB — catches memory leaks before they OOM the host
                                      // Tune this: 256M for 1GB VPS, 400M for 2-4GB, 512M for 8GB+

      // ── Graceful Shutdown ──
      kill_timeout: 10000,            // 10 seconds — PM2 sends SIGINT first, waits this long for graceful exit, then sends SIGKILL
                                      // Must exceed the time connectionManager.close() needs (WAL TRUNCATE + db.close)
                                      // For databases >1GB, consider increasing to 15000
      listen_timeout: 8000,           // 8 seconds — PM2 waits this long for the app to emit "listening" before marking it as started
                                      // Covers the time for DB connect + migrations + server.listen()

      // ── Logging Configuration ──
      // PM2 file logs are set to /dev/null because Pino handles all file rotation via pino-roll.
      // PM2's out/error files would duplicate what Pino already writes to app.log and error.log.
      // Use `pm2 logs` for live terminal tailing of the merged stdout stream.
      out_file: '/dev/null',          // Suppress PM2 stdout file logging — Pino multistream owns file rotation
      error_file: '/dev/null',        // Suppress PM2 stderr file logging — Pino multistream owns file rotation
      merge_logs: true,               // Merge stdout/stderr from all instances into a single stream (future-proofs for cluster mode)
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS', // ISO-8601 timestamp format for PM2's own lifecycle log messages
      log_type: 'json',               // Output logs as JSON — matches Pino's structured log format for consistent parsing

      // ── Error Handling ──
      // PM2 monitors uncaught exceptions and unhandled rejections by default.
      // With autorestart: true, any uncaught error causes a clean restart with backoff.

      // ── Watch & Reload (disabled for production) ──
      watch: false,                   // Do NOT watch files in production — file watching adds fs event overhead and is for dev only
      ignore_watch: [                 // Paths to ignore if watch is ever enabled (useful for pm2-dev or development overrides)
        'node_modules',               // Ignore dependency tree — massive file count
        'logs',                       // Ignore log directory — pino-roll creates/deletes files constantly
        '.git',                       // Ignore git internals
        'uploads',                    // Ignore user-uploaded files
        'database.sqlite',            // Ignore the SQLite database file
        'dist',                       // Ignore Vite build output
      ],
    },
  ],
};
