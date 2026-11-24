#!/usr/bin/env node
/**
 * scripts/testConversationTypeContract.js — conversations.type schema ⇄
 * validator contract (no server, in-memory DB).
 *
 * The 2026-09-20 bulletproof rebuild renamed the app's ticket-chat
 * vocabulary (`ticket-linked` → `ticket`) and downgraded every legacy
 * `ticket-linked` row to `standalone` (keeping its ticket_id), while the
 * whole app kept writing `ticket-linked` — the split-brain. Migration
 * 20261005000001 reconciles both sides; this suite pins the contract:
 *
 *   S1  bulletproof-era DB: up() runs WITHOUT throwing (the old CHECK must
 *       not be violated mid-flight), downgraded rows (standalone + ticket_id)
 *       and interim `ticket` rows are RESTORED to `ticket-linked`, duplicate
 *       ticket chats are unlinked (oldest kept, rows never deleted), the
 *       rebuilt table carries the strict vocabulary CHECK, and
 *       uq_conversations_ticket exists (partial unique). Behavioral
 *       enforcement: legacy `ticket` rejected, ticket-linked w/o ticket_id
 *       rejected, ticket-linked + ticket_id accepted, duplicate ticket_id
 *       rejected, plain standalone accepted. up() twice = no-op.
 *   S2  fresh lenient DB (20260913 CHECK): orphan ticket-linked rows fall
 *       back to standalone, everything else survives.
 *   S3  down()/up() round trip: down() must run without throwing (it used
 *       to rewrite rows under the wrong CHECK), speak the legacy `ticket`
 *       vocabulary, drop the unique index — and up() must fully restore.
 *   V   schema ⇄ zod vocabulary contract: for every candidate type ×
 *       {ticketId present, absent}, createConversationSchema.safeParse and
 *       a real INSERT against the migrated table must AGREE on every cell;
 *       the CHECK literals, the create enum, and the query-filter enum must
 *       be the same set. This is the split-brain detector: it fails
 *       whenever the schema and the app disagree about what `type` is.
 *
 * Run: node scripts/testConversationTypeContract.js
 *      (registered in scripts/testAll.js)
 */

import Database from 'better-sqlite3';
import { createConversationSchema, conversationQuerySchema } from '../server/validators/conversationValidator.js';
import { up, down } from '../server/db/migrations/20261005000001-conversation-type-vocabulary.js';

let passed = 0;
let failed = 0;

function check(cond, msg) {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (cond) passed++;
  else failed++;
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

/** Migration-facing adapter over better-sqlite3 (sync driver, promise-shaped API). */
function adapt(raw) {
  return {
    get: (sql, p = []) => raw.prepare(sql).get(...p),
    all: (sql, p = []) => raw.prepare(sql).all(...p),
    run: (sql, p = []) => raw.prepare(sql).run(...p),
    exec: (sql) => raw.exec(sql),
  };
}

const USERS_TICKETS = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE tickets (id INTEGER PRIMARY KEY, title TEXT);
`;

/** The pre-migration schema families up() must survive. */
const CHECKS = {
  // 20260920 bulletproof (+ 20260921 AUTOINCREMENT) — the shape that
  // rejects `ticket-linked` outright, so any pre-rebuild rewrite throws.
  bulletproof: `CONSTRAINT chk_ticket_logic CHECK (type = 'standalone' OR (type = 'ticket' AND ticket_id IS NOT NULL))`,
  // 20260913 workspace — lenient, no ticket_id requirement (fresh DBs).
  lenient: `CHECK(type IN ('standalone', 'ticket-linked'))`,
};

function createLegacyDb(checkClause) {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  raw.exec(`
    ${USERS_TICKETS}
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'standalone',
      ticket_id INTEGER,
      created_by INTEGER NOT NULL,
      is_archived INTEGER DEFAULT 0,
      archived_at DATETIME,
      archived_by INTEGER,
      archive_reason TEXT,
      deleted_at DATETIME,
      deleted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      ${checkClause}
    )
  `);
  raw.exec(`INSERT INTO users (id, name) VALUES (1, 'contract');`);
  raw.exec(`INSERT INTO tickets (id, title) VALUES (1, 't-one'), (2, 't-two'), (3, 't-three'), (7, 't-seven');`);
  return raw;
}

function seedLegacyRows(raw) {
  // Six rows — none may be lost by the migration.
  const ins = raw.prepare(`INSERT INTO conversations (id, title, type, ticket_id, created_by) VALUES (?, ?, ?, ?, 1)`);
  ins.run(101, 'plain standalone', 'standalone', null);
  ins.run(102, 'downgraded by bulletproof', 'standalone', 1); // was ticket-linked pre-20260920
  ins.run(103, 'interim ticket vocab', 'ticket', 2);
  ins.run(104, 'dup keep', 'ticket', 3);
  ins.run(105, 'dup loser', 'ticket', 3);
  ins.run(106, 'plain standalone 2', 'standalone', null);
}

function rowsById(raw) {
  return Object.fromEntries(
    raw.prepare(`SELECT id, type, ticket_id FROM conversations ORDER BY id`).all()
      .map((r) => [r.id, { type: r.type, ticket_id: r.ticket_id }])
  );
}

function tableSql(raw, name = 'conversations') {
  return raw.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`).get(name)?.sql || '';
}

function indexRow(raw, name) {
  return raw.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name = ?`).get(name) || null;
}

/** quoted literals inside the chk_ticket_logic CHECK clause. */
function checkLiterals(sql) {
  const idx = sql.indexOf('CONSTRAINT chk_ticket_logic');
  if (idx < 0) return null;
  return [...new Set([...sql.slice(idx).matchAll(/'([^']+)'/g)].map((m) => m[1]))].sort();
}

function tryInsert(raw, { id, type, tid }) {
  try {
    raw.prepare(`INSERT INTO conversations (id, title, type, ticket_id, created_by) VALUES (?, 'probe', ?, ?, 1)`)
      .run(id, type, tid ?? null);
    raw.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────────── S1: bulletproof-era DB ─────────────────────────────
section('S1: bulletproof-era DB — up() restores, dedupes, rebuilds');

const s1 = createLegacyDb(CHECKS.bulletproof);
seedLegacyRows(s1);
let s1UpThrew = null;
try {
  await up(adapt(s1));
} catch (err) {
  s1UpThrew = err;
}
check(s1UpThrew === null, `up() completes on a bulletproof-era DB${s1UpThrew ? ` — threw: ${s1UpThrew.message}` : ''}`);

if (s1UpThrew === null) {
  const after = rowsById(s1);
  check(Object.keys(after).length === 6, `no rows lost — got ${Object.keys(after).length}/6`);
  check(after[102]?.type === 'ticket-linked', `downgraded row restored: 102 standalone+ticket_id → ${after[102]?.type}`);
  check(after[103]?.type === 'ticket-linked', `interim 'ticket' row mapped: 103 → ${after[103]?.type}`);
  check(after[104]?.type === 'ticket-linked' && after[104]?.ticket_id === 3, `duplicate oldest keeps the link: 104 → ${after[104]?.type} tid=${after[104]?.ticket_id}`);
  check(after[105]?.type === 'standalone' && after[105]?.ticket_id === null, `duplicate loser unlinked (row kept): 105 → ${after[105]?.type} tid=${after[105]?.ticket_id}`);
  check(after[101]?.type === 'standalone' && after[106]?.type === 'standalone', `untouched standalone rows unchanged`);

  const sql = tableSql(s1);
  check(/'ticket-linked'\s+AND\s+ticket_id\s+IS\s+NOT\s+NULL/i.test(sql), `rebuilt table carries the strict vocabulary CHECK`);
  const uq = indexRow(s1, 'uq_conversations_ticket');
  check(!!uq && /UNIQUE/i.test(uq.sql) && /ticket_id/.test(uq.sql) && /WHERE ticket_id IS NOT NULL/i.test(uq.sql),
    `uq_conversations_ticket exists as a partial unique index${uq ? '' : ' — missing'}`);
  const fkc = s1.prepare('PRAGMA foreign_key_check').all();
  check(fkc.length === 0, `PRAGMA foreign_key_check clean (${fkc.length} violations)`);

  // Behavioral enforcement of the rebuilt schema.
  check(!tryInsert(s1, { id: 901, type: 'ticket', tid: 1 }), `legacy type 'ticket' rejected by CHECK`);
  check(!tryInsert(s1, { id: 902, type: 'ticket-linked', tid: null }), `'ticket-linked' without ticket_id rejected by CHECK`);
  check(tryInsert(s1, { id: 903, type: 'ticket-linked', tid: 7 }), `'ticket-linked' with ticket_id accepted`);
  check(!tryInsert(s1, { id: 904, type: 'ticket-linked', tid: 3 }), `duplicate ticket_id rejected by uq_conversations_ticket`);
  check(tryInsert(s1, { id: 905, type: 'standalone', tid: null }), `plain standalone accepted`);

  // Idempotency: second up() is a no-op.
  const before = JSON.stringify(rowsById(s1));
  try {
    await up(adapt(s1));
    check(JSON.stringify(rowsById(s1)) === before, `up() twice is a no-op (skip path)`);
  } catch (err) {
    check(false, `up() twice is a no-op — threw: ${err.message}`);
  }
}

// ───────────────────────────── S2: fresh lenient DB ─────────────────────────────
section('S2: fresh lenient DB (20260913 CHECK) — orphans fall back');

const s2 = createLegacyDb(CHECKS.lenient);
{
  const ins = s2.prepare(`INSERT INTO conversations (id, title, type, ticket_id, created_by) VALUES (?, ?, ?, ?, 1)`);
  ins.run(201, 'orphan linked', 'ticket-linked', null);
  ins.run(202, 'real linked', 'ticket-linked', 1);
  ins.run(203, 'plain', 'standalone', null);
}
let s2UpThrew = null;
try {
  await up(adapt(s2));
} catch (err) {
  s2UpThrew = err;
}
check(s2UpThrew === null, `up() completes on a fresh lenient DB${s2UpThrew ? ` — threw: ${s2UpThrew.message}` : ''}`);
if (s2UpThrew === null) {
  const after = rowsById(s2);
  check(after[201]?.type === 'standalone', `orphan ticket-linked (no ticket_id) downgraded → ${after[201]?.type}`);
  check(after[202]?.type === 'ticket-linked' && after[202]?.ticket_id === 1, `real linked row preserved → ${after[202]?.type}`);
  check(/'ticket-linked'\s+AND\s+ticket_id\s+IS\s+NOT\s+NULL/i.test(tableSql(s2)), `fresh DB also rebuilt to the strict CHECK`);
  check(!!indexRow(s2, 'uq_conversations_ticket'), `fresh DB gets uq_conversations_ticket`);
}

// ───────────────────────────── S3: down()/up() round trip ─────────────────────────────
section('S3: down()/up() round trip — reversible without CHECK collisions');

// Own DB: reach the strict table first (the premise — if up() cannot build
// it, every down() assertion below would be vacuous), then round-trip.
const s3 = createLegacyDb(CHECKS.bulletproof);
seedLegacyRows(s3);
let s3Premise = null;
try {
  await up(adapt(s3));
} catch (err) {
  s3Premise = err;
}
const s3PremiseOk = s3Premise === null && /'ticket-linked'\s+AND\s+ticket_id\s+IS\s+NOT\s+NULL/i.test(tableSql(s3));
check(s3PremiseOk, `S3 premise: up() reaches the strict table${s3Premise ? ` — threw: ${s3Premise.message}` : ''}`);

let s3UpThrew = null;
if (s3PremiseOk) {
  try {
    await down(adapt(s3));
  } catch (err) {
    s3UpThrew = err;
  }
}
check(s3PremiseOk === false || s3UpThrew === null,
  `down() completes on a DB holding ticket-linked rows${s3UpThrew ? ` — threw: ${s3UpThrew.message}` : ''}`);
if (s3PremiseOk && s3UpThrew === null) {
  const after = rowsById(s3);
  const linked = Object.values(after).filter((r) => r.type === 'ticket-linked');
  const legacyTicket = Object.values(after).filter((r) => r.type === 'ticket');
  check(linked.length === 0 && legacyTicket.length > 0,
    `all ticket-linked rows rewritten to legacy 'ticket' (linked=${linked.length}, ticket=${legacyTicket.length})`);
  check(/type = 'standalone' OR \(type = 'ticket' AND ticket_id IS NOT NULL\)/.test(tableSql(s3)),
    `downgraded table speaks the legacy bulletproof CHECK`);
  check(indexRow(s3, 'uq_conversations_ticket') === null, `uq_conversations_ticket dropped by down()`);
  check(!tryInsert(s3, { id: 911, type: 'ticket-linked', tid: 1 }), `'ticket-linked' rejected after down() (vocabulary reverted)`);
  check(tryInsert(s3, { id: 912, type: 'ticket', tid: 1 }), `'ticket' + ticket_id accepted after down()`);

  let upAgain = null;
  try {
    await up(adapt(s3));
  } catch (err) {
    upAgain = err;
  }
  check(upAgain === null, `up() after down() re-migrates${upAgain ? ` — threw: ${upAgain.message}` : ''}`);
  if (upAgain === null) {
    const back = rowsById(s3);
    check(Object.values(back).every((r) => r.type === 'standalone' || (r.type === 'ticket-linked' && r.ticket_id != null)),
      `round-tripped rows all satisfy the strict vocabulary`);
    check(!!indexRow(s3, 'uq_conversations_ticket'), `unique index restored after up()-again`);
  }
}

// ───────────────────────────── V: schema ⇄ zod vocabulary ─────────────────────────────
section('V: schema ⇄ validator vocabulary contract');

const strictDb = createLegacyDb(CHECKS.bulletproof);
seedLegacyRows(strictDb);
let vPremise = null;
try {
  await up(adapt(strictDb));
} catch (err) {
  vPremise = err;
}
check(vPremise === null, `V premise: up() builds the strict table${vPremise ? ` — threw: ${vPremise.message}` : ''}`);

const strictSql = tableSql(strictDb);
const dbLiterals = checkLiterals(strictSql);
check(dbLiterals !== null, `chk_ticket_logic found in rebuilt table SQL`);
check(JSON.stringify(dbLiterals) === JSON.stringify(['standalone', 'ticket-linked']),
  `CHECK vocabulary is exactly ['standalone','ticket-linked'] — got ${JSON.stringify(dbLiterals)}`);

// Default agreement: table DEFAULT vs validator .default('standalone').
const typeCol = strictDb.prepare(`SELECT dflt_value FROM pragma_table_info('conversations') WHERE name='type'`).get();
const validatorDefault = createConversationSchema.parse({ title: 'default probe' }).type;
check(typeCol?.dflt_value === "'standalone'" && validatorDefault === 'standalone',
  `default agreement: table=${typeCol?.dflt_value} validator=${validatorDefault}`);

// The matrix: validator and DB must agree on EVERY (type × ticketId) cell.
const universe = [...new Set([...(dbLiterals || []), 'ticket', 'group', ''])];
let disagreements = [];
for (const typeVal of universe) {
  for (const withTid of [true, false]) {
    const payload = { title: 'contract probe', type: typeVal, ...(withTid ? { ticketId: 7 } : {}) };
    const validatorOk = createConversationSchema.safeParse(payload).success;
    const dbOk = tryInsert(strictDb, { id: 920, type: typeVal, tid: withTid ? 7 : null });
    if (validatorOk !== dbOk) disagreements.push(`type=${JSON.stringify(typeVal)} tid=${withTid}: validator=${validatorOk} db=${dbOk}`);
  }
}
check(disagreements.length === 0,
  `validator ⇄ DB agree on all ${universe.length * 2} (type × ticketId) cells${disagreements.length ? ` — disagree: ${disagreements.join('; ')}` : ''}`);

// Named split-brain sentinels (the exact regression that shipped broken).
// Title is ≥2 chars so a rejection is attributable to the type/ticketId
// rule alone, never to title.min(2).
check(createConversationSchema.safeParse({ title: 'probe', type: 'ticket' }).success === false,
  `validator rejects legacy type 'ticket'`);
check(createConversationSchema.safeParse({ title: 'probe', type: 'ticket-linked' }).success === false,
  `validator rejects ticket-linked without ticketId (400, not DB 500)`);
check(createConversationSchema.safeParse({ title: 'probe', type: 'ticket-linked', ticketId: 7 }).success === true,
  `validator accepts ticket-linked with ticketId`);

// Query-filter vocabulary (getByTicketId / ?type= filter) must speak the same set.
const filterAccepted = universe.filter((t) => conversationQuerySchema.safeParse({ type: t }).success);
check(JSON.stringify(filterAccepted) === JSON.stringify(dbLiterals),
  `query-filter enum === CHECK vocabulary — filter=${JSON.stringify(filterAccepted)} db=${JSON.stringify(dbLiterals)}`);

console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
process.exitCode = failed > 0 ? 1 : 0;
