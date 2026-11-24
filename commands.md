cd it-asset-manager
node server/index.js
npm run dev




Development (two terminals required)

npm start          # API server on http://localhost:3000
npm run dev        # Vite frontend on http://localhost:5173 with HMR
Lint & Build
npm run lint       # Run oxlint
npm run build      # Build frontend to dist/

Database

npm run reset:db        # Wipe + recreate schema + full reseed (not in production)
npm run db:migrate      # Run pending migrations (also runs on server boot)
npm run db:migrate:status  # Check migration status
npm run seed:users      # Seed test users
npm run seed:tickets    # Seed test tickets
npm run seed:bulk       # Bulk seed data
npm run reseed:admin    # Reseed admin user

Verification Scripts

node scripts/testDatabase.js         # DB connection, migrations, transactions
node scripts/testLogging.js          # Pino logging, redaction
node scripts/testSecurity.js         # Validation, auth, rate limiting (needs server running)
node scripts/testProcessManagement.js # PM2 lifecycle
.\test-security.ps1                  # PowerShell security sweep

Production (PM2)

npm run start:prod   # Start in production mode
npm run reload       # Zero-downtime reload
npm run stop         # Stop production server
npm run restart      # Restart production server
npm run status       # Show PM2 status
npm run logs         # View PM2 logs
npm run monit        # PM2 monitoring

Load Testing

npm run test:server  # Isolated server on :3100
npm run load:read    # Read load test
npm run load:write   # Write load test
npm run load:auth    # Auth load test
