#!/usr/bin/env node
/**
 * scripts/testDatabase.js — Database resilience contract.
 *
 * Behaviours verified:
 *   1. Connect + health check (WAL, integrity, stats)
 *   2. Migrations applied (at least the two foundational ones)
 *   3. Query timeout aborts slow queries (QueryTimeoutError, HTTP 508)
 *   4. Transaction rollback on error leaves DB unchanged
 */

import connectionManager from '../server/db/connection.js';
import { createTimedDb } from '../server/db/queryTimeout.js';
import { withTransaction } from '../server/db/transactions.js';
import { runMigrations } from '../server/db/migrations/umzug-instance.js';
import { QueryTimeoutError } from '../server/utils/AppError.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); } else { failed++; console.error(`  ❌ ${msg}`); }
}

const SLOW = 'WITH RECURSIVE c(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM c WHERE x<1000000) SELECT * FROM c';
const MARKER = '_TEST_ROLLBACK_';

try {
  // 1 ── Connection & Health
  console.log('\n🔌  Connection & Health');
  const db = await connectionManager.connect();
  ok(db !== null, 'connect() returned handle');
  const h = await connectionManager.healthCheck();
  ok(h.healthy === true && h.state === 'ready', `healthy=${h.healthy}, state=${h.state}`);
  const s = await connectionManager.getStats();
  ok(s.pageCount > 0 && s.pageSize > 0 && s.dbSizeBytes > 0, `DB size: ${s.dbSizeBytes} bytes`);

  // 2 ── Migrations
  console.log('\n📋  Migrations');
  await runMigrations(db);
  const rows = await db.all('SELECT name FROM _migrations');
  const names = rows.map(r => r.name);
  ok(names.includes('20260831000001-initial-schema.js'), 'initial-schema applied');
  ok(names.includes('20260831000002-auto-seed.js'), 'auto-seed applied');
  ok(names.length >= 2, `${names.length} migrations total`);

  // 3 ── Query Timeout
  console.log('\n⏱️   Query Timeout (100ms)');
  const timed = createTimedDb(db, 100);
  try {
    await timed.all(SLOW);
    ok(false, 'slow query should have timed out');
  } catch (e) {
    ok(e instanceof QueryTimeoutError, `QueryTimeoutError thrown (${e.name})`);
    ok(e.statusCode === 508 && e.timeoutMs === 100, `statusCode=508, timeoutMs=100`);
  }
  ok((await db.get('SELECT 1 AS n')).n === 1, 'connection usable after timeout');

  // 4 ── Transaction Rollback
  console.log('\n🔄  Transaction Rollback');
  const before = (await db.get('SELECT COUNT(*) AS c FROM departments')).c;
  try {
    await withTransaction(db, async (txn) => {
      await txn.run('INSERT INTO departments (name) VALUES (?)', [MARKER]);
      ok((await txn.get('SELECT COUNT(*) AS c FROM departments WHERE name=?', [MARKER])).c === 1, 'sentinel visible inside txn');
      throw new Error('probe');
    });
    ok(false, 'withTransaction should re-throw');
  } catch (e) {
    ok(e.message === 'probe', 'error propagated');
  }
  ok((await db.get('SELECT COUNT(*) AS c FROM departments')).c === before, 'count unchanged after rollback');
  ok((await db.get('SELECT COUNT(*) AS c FROM departments WHERE name=?', [MARKER])).c === 0, 'sentinel absent after rollback');
} catch (e) {
  console.error('💥 Unexpected:', e); failed++;
} finally {
  await connectionManager.close();
}

console.log(`\n  Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
