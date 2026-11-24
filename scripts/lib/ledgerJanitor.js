#!/usr/bin/env node
/**
 * scripts/lib/ledgerJanitor.js — removes QA-suite noise from the dev DB's
 * asset ledger after a sweep.
 *
 * Two deletion classes, deliberately different scopes:
 *
 *   1. Sweep-written noise — activity_logs rows matching the exact
 *      signatures the QA suites write (testAllApi's "Testing transfer
 *      functionality" transfer cycle, "Returning to storage", "Routine
 *      check" maintenance log, testUiJourney's "Journey timeline seed N").
 *      These are matched ONLY for rows created at/after a `since`
 *      timestamp, so a human's real maintenance note from yesterday —
 *      identical string by coincidence or not — can never be deleted by
 *      a sweep from last week's window. The sweep passes its own start
 *      time; CLI callers get `--since <ISO>` or a 30-day default cap.
 *
 *   2. Orphaned logs — entity rows whose asset no longer exists (e.g. a
 *      seeded probe that was create+delete'd). Always garbage regardless
 *      of age; cleaned at any age.
 *
 * Safety rails: dry-run report unless --apply (CLI) or { apply: true }
 * (API); full online backup (better-sqlite3 .backup, WAL-safe) is written
 * to scripts/.runtime/ before any destructive step; short IMMEDIATE
 * transaction; busy_timeout for the concurrent dev server.
 *
 * Env: TEST_ALL_NO_LEDGER_JANITOR=1 disables the sweep step entirely.
 * The janitor only ever runs against the DEV database (env.DB_PATH after
 * mode resolution) — never a load-test DB.
 *
 * CLI: node scripts/lib/ledgerJanitor.js [--apply] [--since <ISO>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// The QA signatures, verbatim from the suites that write them.
const NOISE_SIGNATURES = [
  '%Testing transfer functionality%',   // testAllApi transfer_notes
  '%Returning to storage%',             // testAllApi transfer-back
  '%Routine check%',                    // testAllApi maintenance log
  '%Journey timeline seed %',           // testUiJourney step 7b self-seed
];

/** Build the parameterized WHERE for one deletion class. */
function noiseWhere(sinceIso) {
  const likes = NOISE_SIGNATURES.map(() => `COALESCE(changes,'') LIKE ? OR COALESCE(metadata,'') LIKE ?`).join(' OR ');
  const params = NOISE_SIGNATURES.flatMap((p) => [p, p]);
  let where = `entity_type='asset' AND (${likes})`;
  if (sinceIso) {
    where += ` AND created_at >= ?`;
    params.push(sinceIso);
  }
  return { where, params };
}

/**
 * Clean the dev DB's asset ledger.
 * @param {object} opts
 * @param {string} [opts.sinceIso] delete noise rows created at/after this ISO time
 * @param {boolean} [opts.apply] perform deletions (default: dry run)
 * @param {boolean} [opts.backup] write a pre-clean backup before deleting (default: true)
 * @returns {{total, matched, orphans, deleted, backupPath}} report
 */
export async function cleanLedger({ sinceIso = null, apply = false, backup = true } = {}) {
  // env.js resolves DB_PATH (dev vs load-test mode) — janitor follows it.
  // createRequire's base is THIS file's dir (scripts/lib/) → two levels up.
  const { default: env } = require('../../server/config/env.js');
  const dbPath = path.isAbsolute(env.DB_PATH) ? env.DB_PATH : path.join(ROOT, env.DB_PATH);
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');

  const total = db.prepare(`SELECT COUNT(*) n FROM activity_logs WHERE entity_type='asset'`).get().n;

  const noise = noiseWhere(sinceIso);
  // Orphans: logs whose asset row is gone, any age.
  const orphanIds = db.prepare(
    `SELECT DISTINCT l.entity_id FROM activity_logs l
     LEFT JOIN assets a ON a.id = l.entity_id
     WHERE l.entity_type='asset' AND a.id IS NULL`
  ).all().map((r) => r.entity_id);
  const orphanWhere = orphanIds.length ? `entity_type='asset' AND entity_id IN (${orphanIds.map(() => '?').join(',')})` : null;

  const combined = [noise.where, orphanWhere].filter(Boolean).join(' OR ');
  const allParams = [...noise.params, ...orphanIds];
  const matched = db.prepare(`SELECT COUNT(*) n FROM activity_logs WHERE ${combined}`).all(...allParams)[0].n;
  const byAsset = db.prepare(
    `SELECT entity_id, action, COUNT(*) n FROM activity_logs WHERE ${combined} GROUP BY entity_id, action ORDER BY entity_id`
  ).all(...allParams);

  const report = { total, matched, orphans: orphanIds.length, deleted: 0, backupPath: null };
  console.log(`[ledger-janitor] asset ledger: ${total} rows, ${matched} candidate(s)${sinceIso ? ` (created >= ${sinceIso})` : ' (orphan class: any age)'}`);
  for (const r of byAsset) console.log(`[ledger-janitor]   ${r.entity_id}  ${r.action.padEnd(12)} x${r.n}`);

  if (!apply || matched === 0) {
    if (!apply) console.log('[ledger-janitor] dry run — no changes.');
    db.close();
    return report;
  }

  if (backup) {
    fs.mkdirSync(path.join(ROOT, 'scripts', '.runtime'), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    report.backupPath = path.join(ROOT, 'scripts', '.runtime', `database.sqlite.pre-janitor.${stamp}.bak`);
    await db.backup(report.backupPath);   // awaited: backup MUST complete before any DELETE
    console.log(`[ledger-janitor] backup: ${path.relative(ROOT, report.backupPath)}`);
  }

  const info = db.transaction(() =>
    db.prepare(`DELETE FROM activity_logs WHERE ${combined}`).run(...allParams),
  ).immediate();
  report.deleted = info.changes;
  const after = db.prepare(`SELECT COUNT(*) n FROM activity_logs WHERE entity_type='asset'`).get().n;
  console.log(`[ledger-janitor] deleted ${report.deleted} row(s); asset ledger now ${after}.`);
  db.close();
  return report;
}

/* ── CLI ─────────────────────────────────────────────────────────────── */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const sinceFlag = args.indexOf('--since');
  // Default cap: 30 days. The sweep passes its own (much tighter) start time.
  const sinceIso = sinceFlag >= 0 ? args[sinceFlag + 1]
    : new Date(Date.now() - 30 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  cleanLedger({ sinceIso, apply });
}
