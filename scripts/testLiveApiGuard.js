#!/usr/bin/env node
/**
 * scripts/testLiveApiGuard.js — regression suite for the handle-aware
 * live-API guard (server/utils/liveApiGuard.js + listNodeCommands /
 * parseWmicList in server/utils/appLock.js).
 *
 * The guard's ghost sweep (layer 2) is exercised against the REAL process
 * table: the suite spawns real node children whose command lines embed the
 * server entry / dev DB path strings — exactly what a crashed server or a
 * script mid-reset looks like to wmic — with no listener on any port. A
 * pure port check cannot see these; this suite proves the guard now does.
 *
 * Sections:
 *   A. parseWmicList ground truth — NUL-stripped wmic /format:list blocks,
 *      key-order independence, empty CommandLine, multi-key blocks.
 *   B. listNodeCommands on the real host — sane rows; the sweep finds THIS
 *      suite's own process with the right pid/command (end-to-end proof
 *      that wmic or the PowerShell fallback works here).
 *   C. Guard baseline — with :3000 expected free (DEV_API_PORT pinned to
 *      3999 to stay deterministic), a real unrelated node child (the
 *      figjam-mcp/Vite analogue) is NOT flagged. Assertions are
 *      DECOY-RELATIVE (pid-scoped) so they hold both standalone and
 *      under `test:all`, where the real dev API is legitimately a holder
 *      (the pin blinds only the port layer).
 *   D. Ghost detection — real children embedding `server/index.js`
 *      (server-entry via) or the resolved DB path (db-path via) are
 *      flagged with refused=true and holders=[{pid, via}]; a foreign
 *      checkout's `d:\...\server/index.js` string is NOT flagged;
 *      RESET_DB_ALLOW_LIVE=1 proceeds despite a real holder.
 *   E. Doctor guard-coverage heuristic — sandboxed scripts/ tree:
 *      strong (connection import) / weak (better-sqlite3) / excluded
 *      (test*, liveApiGuard import, unrelated helpers).
 *   F. Doctor layering check (check #12) — real trees clean; sandboxed
 *      upward imports flagged; fixture strings, comments and
 *      page.evaluate browser-context imports exempt.
 *   G. Doctor import-cycle check (check #13) — real server graph acyclic
 *      with lazy edges present; static/lazy classification ground truth;
 *      end-to-end filesystem cycle via sandbox.
 *   H. Doctor import-resolution check (check #14) — every relative import
 *      in the real server/, scripts/ and src/ trees resolves to a real
 *      file; sandboxed broken specifiers (static, dynamic, deep,
 *      directory-without-index) are flagged while directory-index, npm and
 *      node: imports, fixture strings and comments pass untouched; the
 *      severity split holds (server miss ⇒ fail, tooling/frontend miss ⇒
 *      warn).
 *   I. scripts/verifyBackup.js (`npm run verify:backup`) — usage error ⇒
 *      exit 2; a good ZIP with sidecar + matching history row ⇒ exit 0
 *      TRUSTED (all 3 stores); a tampered payload entry, a diverging
 *      sidecar and a mismatching DB hash each ⇒ exit 1 FAILED naming the
 *      store; the newest real backup on disk verifies end-to-end when one
 *      exists (skip note otherwise).
 *   J. Doctor first-boot seed check (sandboxed) — check #17: the real repo
 *      never fails it; a sandbox proves each verdict — clean ⇒ ok,
 *      missing `seed:bulk` or an auto-seed that inserts assets ⇒ fail,
 *      README section gone ⇒ warn, dev-DB asset count 0 ⇒ warn (the
 *      first-boot state) while a seeded count ⇒ ok.
 *
 * No server, no listener, no dev-DB writes (section J plants a throwaway
 * SQLite file under scripts/.runtime/) — run anywhere:
 *   node scripts/testLiveApiGuard.js
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import AdmZip from 'adm-zip';

// Pin the port probe away from any possibly-live :3000 BEFORE the guard
// module is imported (it reads DEV_API_PORT at load). The original value is
// restored on exit — the test:all runner passes process.env to every later
// suite, so this pin must not leak beyond this file.
const ORIG_DEV_API_PORT = process.env.DEV_API_PORT;
process.env.DEV_API_PORT = process.env.DEV_API_PORT || '3999';

let passed = 0, failed = 0;
function assert(cond, msg, detail = '') {
  if (cond) { console.log(`PASS - ${msg}`); passed++; }
  else { console.log(`FAIL - ${msg}${detail ? ` — ${detail}` : ''}`); failed++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Spawn a long-lived node child whose command line embeds `extra` (a
 *  string the guard's sweep must match or ignore). Resolves after a short
 *  settle so wmic's snapshot is near-certain to include it. Returns the
 *  ChildProcess (kill via stopChild). */
function spawnDecoy(extra) {
  const script = `const s = ${JSON.stringify(extra)}; setInterval(() => {}, 1e6);`;
  const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore', windowsHide: true });
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 2000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

async function main() {
  console.log('════════════════════════════════════════════════════');
  console.log('  LIVE-API GUARD SUITE (handle-aware ghost detection)');
  console.log('════════════════════════════════════════════════════');

  // ── A. parseWmicList ground truth ──────────────────────────────────
  {
    const { parseWmicList } = await import('../server/utils/appLock.js');
    const sample = [
      '',
      'Name=node.exe',
      `CommandLine="C:\\Program Files\\nodejs\\node.exe" server/index.js`,
      'ProcessId=11111',
      '',
      `CommandLine="C:\\Program Files\\nodejs\\node.exe" -e setInterval(() => {}, 1e6)`,
      'ProcessId=22222',
      '',
      'ProcessId=33333',
      'CommandLine=',                      // empty command line (system-adjacent edge)
      '',
    ].join('\r\n');
    const parsed = parseWmicList(sample);
    assert(Array.isArray(parsed) && parsed.length === 3, 'A1: three wmic blocks parsed', JSON.stringify(parsed));
    assert(parsed[0]?.pid === 11111 && parsed[0]?.command.includes('server/index.js'),
      'A2: server-entry block parsed with pid + command', JSON.stringify(parsed[0]));
    assert(parsed[1]?.pid === 22222 && parsed[1]?.command.includes('setinterval'),
      'A3: commands are lowercased (case-insensitive matching)', JSON.stringify(parsed[1]));
    assert(parsed[2]?.pid === 33333 && parsed[2]?.command === '',
      'A4: empty CommandLine → empty string (never a match, never a crash)', JSON.stringify(parsed[2]));
    // Key-order independence: wmic does not guarantee key order.
    const reordered = parseWmicList('ProcessId=4444\r\nCommandLine=node server/index.js\r\n\r\n');
    assert(reordered.length === 1 && reordered[0].pid === 4444 && reordered[0].command.includes('server/index.js'),
      'A5: ProcessId-before-CommandLine order also pairs correctly', JSON.stringify(reordered));
  }

  // ── B. listNodeCommands on the real host ───────────────────────────
  {
    const { listNodeCommands } = await import('../server/utils/appLock.js');
    const sweep = await listNodeCommands();
    assert(Array.isArray(sweep) && sweep.length >= 1,
      `B1: real-host sweep returns rows (${Array.isArray(sweep) ? sweep.length : typeof sweep})`);
    const sane = sweep.every((p) => Number.isInteger(p.pid) && p.pid > 0 && typeof p.command === 'string');
    assert(sane, 'B2: every row has an integer pid and a string command', JSON.stringify(sweep.slice(0, 2)));
    const self = sweep.find((p) => p.pid === process.pid);
    assert(!!self, 'B3: sweep finds this suite process (pid attribution works end-to-end)');
    assert(!!self && self.command.includes('testliveapiguard'),
      'B4: self command line carries the suite name (real wmic/PowerShell parse)', self?.command);
  }

  // ── C + D. Guard end-to-end with real children ─────────────────────
  {
    const { refuseIfDevApiLive } = await import('../server/utils/liveApiGuard.js');

    // C1. Baseline: an unrelated long-running node child (MCP/Vite
    // analogue — no server-entry or DB-path strings) is never flagged.
    // Assertions are DECOY-RELATIVE (pid-scoped): under `test:all` the
    // real dev API (node server/index.js on :3000) legitimately appears
    // in holders (the :3999 pin blinds only the port layer), so absolute
    // "no holders" baselines would fail mid-sweep. What must hold in BOTH
    // environments: the innocent decoy and the suite itself are absent.
    const innocent = spawnDecoy('totally-unrelated-helper');
    await sleep(700);
    const c1 = await refuseIfDevApiLive('suite');
    assert(!c1.holders.some((h) => h.pid === innocent.pid),
      'C1: unrelated node child (decoy) NOT flagged', JSON.stringify(c1.holders));
    assert(c1.checked === true, 'C1b: checked=true — the port probe ran (contract preserved)');
    assert(!c1.holders.some((h) => h.pid === process.pid),
      'C1c: the suite itself is never flagged either');

    // D1. Real ghost holder: command line embeds `server/index.js`, no
    // listener anywhere — the exact "crashed server" signature.
    const ghostServer = spawnDecoy('node server/index.js --ghost');
    await sleep(700);
    const d1 = await refuseIfDevApiLive('suite');
    assert(d1.refused === true, 'D1: ghost server-entry holder ⇒ refused=true', JSON.stringify(d1));
    assert(d1.holders.some((h) => h.pid === ghostServer.pid && h.via === 'server-entry'),
      'D1b: holder detail carries the real pid + via=server-entry', JSON.stringify(d1.holders));

    // D2. Opt-out: RESET_DB_ALLOW_LIVE=1 proceeds despite the real holder.
    process.env.RESET_DB_ALLOW_LIVE = '1';
    const d2 = await refuseIfDevApiLive('suite');
    delete process.env.RESET_DB_ALLOW_LIVE;
    assert(d2.refused === false && d2.holders.some((h) => h.pid === ghostServer.pid),
      'D2: RESET_DB_ALLOW_LIVE=1 proceeds despite a real holder (still reported in holders)', JSON.stringify(d2));

    // D3. Foreign checkout: a `d:\other-repo\server/index.js` string in a
    // command line is NOT our server — must not be flagged (db-path and
    // server-entry checks must not merge). Pid-scoped: other holders
    // (e.g. the real dev API mid-sweep) do not affect this assertion.
    await stopChild(ghostServer);
    const foreign = spawnDecoy(`node d:\\totally-foreign-checkout\\server/index.js`);
    await sleep(700);
    const d3 = await refuseIfDevApiLive('suite');
    assert(!d3.holders.some((h) => h.pid === foreign.pid),
      'D3: foreign checkout server/index.js NOT flagged (path-segment check excludes it)', JSON.stringify(d3.holders));
    await stopChild(foreign);

    // D4. DB-path via: a child embedding the resolved dev DB path is
    // flagged even though it is not the server (scripts mid-reset). The
    // path must reach the command line VERBATIM (single backslashes):
    // JSON.stringify would escape each one and the sweep would see
    // --db=d:\\… — a string no real process produces.
    const dbPath = (await import('../server/utils/liveApiGuard.js')).resolveDevDbPath();
    const dbSrc = `const s = "node scripts/resetDb.js --db=${dbPath}"; setInterval(() => {}, 1e6);`;
    const dbHolder = spawn(process.execPath, ['-e', dbSrc], { stdio: 'ignore', windowsHide: true });
    await sleep(700);
    const d4 = await refuseIfDevApiLive('suite');
    assert(d4.refused === true && d4.holders.some((h) => h.pid === dbHolder.pid && h.via === 'db-path'),
      'D4: DB-path holder flagged via=db-path (works when DB_PATH is set)', JSON.stringify(d4.holders));
    await stopChild(dbHolder);

    // C2. After all decoys are gone NONE of them is flagged anymore
    // (pid-scoped cleanup proof; the host may still legitimately hold
    // its own dev API mid-sweep).
    await sleep(700);
    const c2 = await refuseIfDevApiLive('suite');
    const decoyPids = [innocent, ghostServer, foreign, dbHolder].map((c) => c?.pid).filter(Number.isInteger);
    assert(!c2.holders.some((h) => decoyPids.includes(h.pid)),
      'C2: after cleanup no decoy is flagged anymore (no stale attribution)', JSON.stringify(c2.holders));
    await stopChild(innocent);
  }

  // ── E. Doctor guard-coverage heuristic (sandboxed) ────────────────
  {
    const { collectUnguardedDbScripts } = await import('./doctor.js');
    const sandbox = path.resolve('scripts/.runtime/liveguard-gcov');
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.mkdirSync(path.join(sandbox, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'scripts', 'seedUnguarded.js'), "import x from '../server/db/connection.js';\n");
    fs.writeFileSync(path.join(sandbox, 'scripts', 'plainHelper.js'), "console.log('plain');\n");
    fs.writeFileSync(path.join(sandbox, 'scripts', 'maybeReadOnly.js'), "import Database from 'better-sqlite3';\n");
    fs.writeFileSync(path.join(sandbox, 'scripts', 'testSelf.js'), "import Database from 'better-sqlite3';\n");
    fs.writeFileSync(path.join(sandbox, 'scripts', 'alreadyGuarded.js'), "import { refuseIfDevApiLive } from '../lib/liveApiGuard.js';\n");
    const r = collectUnguardedDbScripts(sandbox);
    assert(r.strong.length === 1 && r.strong[0] === 'scripts/seedUnguarded.js',
      'E1: connection-layer import ⇒ strong [fail] classification', JSON.stringify(r.strong));
    assert(r.weak.length === 1 && r.weak[0] === 'scripts/maybeReadOnly.js',
      'E2: better-sqlite3-only file ⇒ weak [warn] classification', JSON.stringify(r.weak));
    assert(![...r.strong, ...r.weak].some((s) => s.includes('plainHelper')),
      'E3: unrelated helper not flagged');
    assert(![...r.strong, ...r.weak].some((s) => s.startsWith('scripts/test')),
      'E4: test* suites excluded (sandboxed DBs by design)');
    assert(![...r.strong, ...r.weak].some((s) => s.includes('alreadyGuarded')),
      'E5: liveApiGuard import ⇒ passes the scan');
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  // ── F. Doctor layering check (sandboxed) — check #12 ──────────────
  {
    const { collectUpwardImports } = await import('./doctor.js');

    // F1. The REAL trees are clean: server/ never imports scripts/ or src/;
    // src/ never imports server/ or scripts/; scripts/ never imports src/
    // (the testDiskStatusBanner page.evaluate import is browser-context and
    // must NOT be flagged — that is F6's regression).
    const real = collectUpwardImports();
    assert(real.violations.length === 0 && real.scanned > 250,
      `F1: real trees clean (${real.scanned} files across server/ src/ scripts/, 0 violations)`, JSON.stringify(real.violations));

    // Sandbox with ALL THREE trees; each case names the expectation.
    const sandbox = path.resolve('scripts/.runtime/liveguard-layering');
    fs.rmSync(sandbox, { recursive: true, force: true });
    for (const t of ['server', 'src', 'scripts']) fs.mkdirSync(path.join(sandbox, t), { recursive: true });
    const w = (tree, name, content) => fs.writeFileSync(path.join(sandbox, tree, name), content);

    // F2. server/ tree: static + dynamic upward imports flagged; benign kept.
    w('server', 'badDynamic.js', "const { g } = await import('../../scripts/lib/liveApiGuard.js');\n");
    w('server', 'badStatic.js', "import x from '../../scripts/lib/nope.js';\n");
    w('server', 'good.js', "import y from './sibling.js';\nimport fs from 'node:fs';\n");

    // F3. src/ tree: relative imports of server/ or scripts/ flagged; HTTP is
    // the allowed coupling, node/bare specifiers are npm.
    w('src', 'badServer.js', "import { getDb } from '../../server/database.js';\n");
    w('src', 'badScripts.js', "import { stop } from '../../scripts/lib/appLock.js';\n");
    w('src', 'good.js', "import { api } from './utils/apiClient.js';\nimport dayjs from 'dayjs';\n");

    // F4. scripts/ tree: relative AND Vite-absolute src/ imports flagged
    // OUTSIDE evaluate; comments and fixture-strings must NOT be flagged.
    w('scripts', 'badRel.js', "import mod from '../src/utils/apiClient.js';\n");
    w('scripts', 'badVite.js', "const mod = await import('/src/utils/nope.js');\n");
    // Fixture-string + comment look-alikes (the two REAL false-positive
    // classes that forced the lexer approach):
    w('scripts', 'fixtureString.js', `import fs from 'node:fs';\nconst body = "import x from '../../src/utils/apiClient.js';\\n";\nfs.writeFileSync('f.js', body);\n`);
    w('scripts', 'commentOnly.js', "// import x from '../src/utils/nope.js';\n");
    // Browser-context: /src/ import inside page.evaluate — allowed.
    w('scripts', 'evaluateImport.js', "test('t', async () => { await page.evaluate(async () => { const m = await import('/src/utils/apiClient.js'); return m.default; }); });\n");

    const r = collectUpwardImports(sandbox);
    const hit = (file) => r.violations.filter((v) => v.file.endsWith(file));
    assert(r.scanned === 11, 'F2–F4: sandbox scan covers every planted file', `scanned ${r.scanned}`);
    assert(r.violations.length === 6,
      'F2–F4: exactly the 6 planted violations flagged', JSON.stringify(r.violations));
    assert(hit('badDynamic.js').length === 1 && hit('badStatic.js').length === 1,
      'F2: server → scripts/ flagged (static + dynamic)');
    assert(hit('badServer.js').length === 1 && hit('badScripts.js').length === 1,
      'F3: src → server/ and src → scripts/ flagged');
    assert(hit('badRel.js').length === 1 && hit('badVite.js').length === 1,
      'F4: scripts → src/ flagged (relative + Vite-absolute, outside evaluate)');
    assert(hit('fixtureString.js').length === 0 && hit('commentOnly.js').length === 0,
      'F5: fixture strings and comments never flagged (lexer, not regex)');
    assert(hit('evaluateImport.js').length === 0,
      'F6: /src/ import INSIDE page.evaluate is browser-context — not flagged');
    assert(r.violations.every((v) => v.why && v.fix),
      'violations carry why + fix guidance', JSON.stringify(r.violations[0]));
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  // ── G. Doctor import-cycle check (sandboxed) — check #13 ──────────
  {
    const { collectServerImportGraph, detectImportCycles } = await import('./doctor.js');

    // G1. The REAL server graph: acyclic (this is the invariant the check
    // guards), fully scanned, and its lazy edges are the documented
    // break-cycle convention.
    const real = collectServerImportGraph();
    assert(real.nodes.length > 100 && real.edges.length > 100,
      `G1: real server graph built (${real.nodes.length} modules, ${real.edges.length} edges)`, 'graph suspiciously small');
    assert(detectImportCycles(real.edges).length === 0,
      'G1: real server graph has NO import cycles');
    assert(real.edges.some((e) => e.lazy),
      'G1: lazy dynamic edges detected in the real graph (the break-cycle convention exists)');

    // G2/G3/G4. Detector ground truth on synthetic graphs (no fs needed).
    const twoStatic = detectImportCycles([{ from: 'a', to: 'b', lazy: false }, { from: 'b', to: 'a', lazy: false }]);
    assert(twoStatic.length === 1 && twoStatic[0].kind === 'static' && twoStatic[0].nodes.join(',') === 'a,b,a',
      'G2: two-node static cycle detected, canonical rotation a→b→a', JSON.stringify(twoStatic));
    const threeLazy = detectImportCycles([{ from: 'a', to: 'b', lazy: true }, { from: 'b', to: 'c', lazy: true }, { from: 'c', to: 'a', lazy: true }]);
    assert(threeLazy.length === 1 && threeLazy[0].kind === 'lazy' && threeLazy[0].nodes.join(',') === 'a,b,c,a',
      'G3: three-node lazy-only cycle detected, kind lazy', JSON.stringify(threeLazy));
    const mixed = detectImportCycles([{ from: 'a', to: 'b', lazy: false }, { from: 'b', to: 'c', lazy: true }, { from: 'c', to: 'a', lazy: true }]);
    assert(mixed.length === 1 && mixed[0].kind === 'static',
      'G4: mixed cycle (one static edge) classifies static — init hazard present', JSON.stringify(mixed));
    const acyclic = detectImportCycles([{ from: 'a', to: 'b', lazy: false }, { from: 'b', to: 'c', lazy: false }]);
    assert(acyclic.length === 0, 'G4: acyclic graph yields no cycles');

    // G5. END-TO-END: a filesystem cycle (a↔b via STATIC imports) is found
    // by collectServerImportGraph through the real lexer pipeline.
    const sandbox = path.resolve('scripts/.runtime/liveguard-cycles');
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.mkdirSync(path.join(sandbox, 'server', 'db'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'server', 'a.js'), "import { b } from './b.js';\nexport const a = 1;\n");
    fs.writeFileSync(path.join(sandbox, 'server', 'b.js'), "import { a } from './a.js';\nexport const b = 2;\n");
    const g = collectServerImportGraph(sandbox);
    assert(g.nodes.length === 2 && g.edges.length === 2, 'G5: sandbox graph built (2 modules, 2 edges)', JSON.stringify(g));
    const found = detectImportCycles(g.edges);
    assert(found.length === 1 && found[0].kind === 'static' && found[0].nodes.join(',') === 'server/a.js,server/b.js,server/a.js',
      'G5: filesystem static cycle a↔b detected end-to-end', JSON.stringify(found));
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  // ── H. Doctor import-resolution check (sandboxed) — check #14 ─────
  {
    const { collectUnresolvedImports } = await import('./doctor.js');

    // H1. The REAL trees: every relative import — static and lazy — in
    // server/, scripts/ AND src/ resolves to a real module file (this is
    // the invariant the check guards; a regression here fails the sweep
    // before anything else runs).
    const real = collectUnresolvedImports();
    assert(real.missing.length === 0 && real.scanned > 250 && real.edges > 500,
      `H1: all three real trees fully resolve (${real.scanned} modules, ${real.edges} relative imports — server ${real.byTree.server.scanned}/${real.byTree.server.edges}, scripts ${real.byTree.scripts.scanned}/${real.byTree.scripts.edges}, src ${real.byTree.src.scanned}/${real.byTree.src.edges}, 0 missing)`, JSON.stringify(real.missing));

    // Sandbox: broken specifiers in every shape, planted next to the
    // resolvable and must-ignore forms. Target files exist so only the
    // typos themselves can produce misses.
    const sandbox = path.resolve('scripts/.runtime/liveguard-resolution');
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.mkdirSync(path.join(sandbox, 'server', 'utils'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'server', 'services'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'server', 'utils', 'logger.js'), '');
    fs.writeFileSync(path.join(sandbox, 'server', 'services', 'realService.js'), '');
    fs.writeFileSync(path.join(sandbox, 'server', 'services', 'index.js'), '');
    const w = (name, content) => fs.writeFileSync(path.join(sandbox, 'server', name), content);
    w('typoStatic.js', "import { x } from './utils/loger.js';\n");                    // H2: static typo
    w('typoDynamic.js', "const { y } = await import('./utils/loger.js');\n");         // H3: lazy-dynamic typo
    w('deepChain.js', "import { z } from '../utils/nopeDir/nope.js';\n");             // H4: deeper relative chain
    // H5: dir spec WITHOUT an index — noIndexDir must exist NOWHERE, else
    // the extensionless probe (<spec>.js/.jsx, <spec>/index.*) resolves via
    // a sibling file (realService.js exists — planting that name here would
    // make the import legitimately resolvable instead of broken).
    w('bareDir.js', "import { d } from './services/noIndexDir';\n");
    w('indexOnly.js', "import { d } from './services';\n");                           // H6: dir spec WITH index.js
    w('good.js', "import l from './utils/logger.js';\nimport r from './services/realService.js';\n"); // H7: exact files
    w('npmImports.js', "import express from 'express';\nimport fs from 'node:fs';\nconst zip = await import('adm-zip');\n"); // H8: not file-checkable
    w('fixtureString.js', `import fs from 'node:fs';\nconst body = "import x from './utils/loger.js';\\n";\n`); // H9: fixture text
    w('commentOnly.js', "// import x from './utils/loger.js';\n");                    // H10: comment

    const r = collectUnresolvedImports(sandbox);
    const hit = (file) => r.missing.filter((x) => x.file.endsWith(file));
    assert(r.scanned === 12, 'H2–H10: sandbox scan covers every planted file (incl. targets)', `scanned ${r.scanned}`);
    assert(r.missing.length === 4, 'H2–H5: exactly the 4 broken specifiers flagged', JSON.stringify(r.missing));
    assert(hit('typoStatic.js').length === 1 && hit('typoDynamic.js').length === 1,
      'H2–H3: static and lazy-dynamic typos both flagged');
    assert(hit('deepChain.js').length === 1 && hit('deepChain.js')[0].resolved.includes('nopeDir/nope.js'),
      'H4: deeper relative chain flagged with resolved target');
    assert(hit('bareDir.js').length === 1,
      'H5: directory spec without index.js is NOT silently resolved');
    assert(hit('indexOnly.js').length === 0 && hit('good.js').length === 0,
      'H6–H7: directory index.js and exact files resolve clean');
    assert(hit('npmImports.js').length === 0,
      'H8: npm/builtin specifiers (express, node:fs, adm-zip) ignored — not file-checkable');
    assert(hit('fixtureString.js').length === 0 && hit('commentOnly.js').length === 0,
      'H9–H10: fixture strings and comments never flagged (lexer, not regex)');
    assert(r.missing.every((x) => x.file && x.spec && x.resolved),
      'missing rows carry file/spec/resolved for the doctor detail line', JSON.stringify(r.missing[0]));
    assert(r.missing.every((x) => x.tree === 'server'),
      'missing rows carry the tree tag (severity split input)', JSON.stringify(r.missing[0]));
    fs.rmSync(sandbox, { recursive: true, force: true });

    // H11. Severity split, end-to-end through checkImportResolution(root):
    // a server/ miss keeps the [fail] verdict (production boot hazard);
    // the same miss under scripts/ is only a [warn] (the broken QA script
    // fails loudly at its own runtime — it must not gate the sweep).
    const { checkImportResolution } = await import('./doctor.js');
    const failBox = path.resolve('scripts/.runtime/liveguard-resolution-fail');
    const warnBox = path.resolve('scripts/.runtime/liveguard-resolution-warn');
    fs.rmSync(failBox, { recursive: true, force: true });
    fs.rmSync(warnBox, { recursive: true, force: true });
    fs.mkdirSync(path.join(failBox, 'server'), { recursive: true });
    fs.mkdirSync(path.join(warnBox, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(failBox, 'server', 'broken.js'), "import { x } from './nope.js';\n");
    fs.writeFileSync(path.join(warnBox, 'scripts', 'broken.js'), "import { x } from './nope.js';\n");
    assert(checkImportResolution(failBox) === 'fail',
      'H11: server-tree miss ⇒ [fail] verdict (production boot hazard)');
    assert(checkImportResolution(warnBox) === 'warn',
      'H11: scripts-tree miss ⇒ [warn] verdict (tooling failure, not a server outage)');
    fs.rmSync(failBox, { recursive: true, force: true });
    fs.rmSync(warnBox, { recursive: true, force: true });
  }

  // ── I. verifyBackup CLI (backup tamper-evidence, three stores) ─────
  {
    const { MANIFEST_NAME, SIDECAR_SUFFIX, manifestHashHex, buildChecksumsManifest } = await import('../server/utils/backupChecksums.js');
    const { default: Database } = await import('better-sqlite3');

    /** Run the CLI as a real child process — exit codes are part of the
     *  contract (0 trusted / 1 failed / 2 usage). `env` overlays DB_PATH.
     *  No-arg runs pass NO second argv element: spawnSync would stringify
     *  undefined into the literal argument "undefined", which the CLI would
     *  dutifully treat as a (missing) filename instead of a usage error. */
    const cliPath = path.resolve('scripts/verifyBackup.js');
    const runCli = (arg, env = {}) => spawnSync(process.execPath,
      arg === undefined ? [cliPath] : [cliPath, arg],
      { encoding: 'utf-8', windowsHide: true, timeout: 30_000, env: { ...process.env, ...env } });

    // I1. Usage error ⇒ exit 2 (not 0, not 1 — a distinct contract).
    const usage = runCli();
    assert(usage.status === 2 && /Usage:/.test(usage.stderr),
      `I1: no argument ⇒ exit 2 with usage line`, `status ${usage.status}, stderr: ${usage.stderr.slice(0, 120)}`);

    // Sandbox: a good backup (2 payload entries + uploads + manifest), a
    // byte-exact sidecar, and a history DB whose row logs the manifest's
    // own hash. Every store starts in agreement.
    const sandbox = path.resolve('scripts/.runtime/liveguard-verify');
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.mkdirSync(sandbox, { recursive: true });
    const buildGoodZip = (name) => {
      const zip = new AdmZip();
      zip.addFile('conversations.sqlite', Buffer.from('fake-db-bytes'));
      zip.addFile('conversations-archive.sqlite', Buffer.from('fake-archive-bytes'));
      zip.addFile('uploads/conversations/a.txt', Buffer.from('attachment'));
      zip.addFile(MANIFEST_NAME, Buffer.from(buildChecksumsManifest(zip), 'utf-8'));
      const zipPath = path.join(sandbox, name);
      fs.writeFileSync(zipPath, zip.toBuffer());
      fs.writeFileSync(`${zipPath}${SIDECAR_SUFFIX}`, zip.getEntry(MANIFEST_NAME).getData());
      return zipPath;
    };

    // History DB with the schema the CLI peeks (both tables it queries).
    const dbPath = path.join(sandbox, 'history.sqlite');
    const db = new Database(dbPath);
    db.exec("CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT)");
    db.exec("CREATE TABLE conversation_backup_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, status TEXT, manifest_hash_hex TEXT)");
    const insertRow = (filename, hash) => db.prepare(
      "INSERT INTO conversation_backup_logs (filename, status, manifest_hash_hex) VALUES (?, 'success', ?)"
    ).run(filename, hash);

    // I2. All three stores agree ⇒ exit 0, TRUSTED verdict, 3/3 stores.
    const goodZip = buildGoodZip('conversations-backup-good.zip');
    insertRow(path.basename(goodZip), manifestHashHex(new AdmZip(goodZip).getEntry(MANIFEST_NAME).getData()));
    const trusted = runCli(goodZip, { DB_PATH: dbPath });
    assert(trusted.status === 0,
      'I2: good backup + sidecar + matching history hash ⇒ exit 0', `status ${trusted.status}, stderr: ${trusted.stderr.slice(0, 200)}`);
    assert(/TRUSTED/.test(trusted.stdout) && /3 stores agree|all 3/.test(trusted.stdout),
      'I2: verdict is TRUSTED with all three stores agreeing', trusted.stdout.slice(-160));

    // I3. Tampered payload under the ORIGINAL manifest — hash agreement of
    // the out-of-band stores is irrelevant: entry verification must fail
    // and name the entry (the 2c-3 trap, from the CLI's side).
    const tampZipPath = path.join(sandbox, 'conversations-backup-tampered.zip');
    const tamp = new AdmZip();
    tamp.addFile('conversations.sqlite', Buffer.from('fake-db-bytes'));
    tamp.addFile('conversations-archive.sqlite', Buffer.from('fake-archive-bytes'));
    tamp.addFile('uploads/conversations/a.txt', Buffer.from('TAMPERED'));
    tamp.addFile(MANIFEST_NAME, new AdmZip(goodZip).getEntry(MANIFEST_NAME).getData());   // ORIGINAL manifest
    fs.writeFileSync(tampZipPath, tamp.toBuffer());
    fs.writeFileSync(`${tampZipPath}${SIDECAR_SUFFIX}`, tamp.getEntry(MANIFEST_NAME).getData());   // consistent sidecar
    const tampRun = runCli(tampZipPath, { DB_PATH: dbPath });
    assert(tampRun.status === 1,
      'I3: tampered entry under the original manifest ⇒ exit 1', `status ${tampRun.status}`);
    assert(/uploads\/conversations\/a\.txt/.test(tampRun.stderr) && /manifest hash mismatch/.test(tampRun.stderr) && /VERDICT: FAILED/.test(tampRun.stderr),
      'I3: failure names the tampered entry and the FAILED verdict', tampRun.stderr.slice(-200));

    // I4. Sidecar divergence — the out-of-band copy is never rewritten by
    // the service, so a difference is proof of post-backup modification.
    const staleZip = buildGoodZip('conversations-backup-stale-sidecar.zip');
    fs.writeFileSync(`${staleZip}${SIDECAR_SUFFIX}`, 'not-the-manifest\n');
    const staleRun = runCli(staleZip, { DB_PATH: dbPath });
    assert(staleRun.status === 1 && /DIVERGES/.test(staleRun.stderr),
      'I4: diverging sidecar ⇒ exit 1, DIVERGES named', `status ${staleRun.status}, stderr: ${staleRun.stderr.slice(-160)}`);

    // I5. History-DB agreement through the real DB store: a fresh good ZIP
    // whose row hash matches ⇒ exit 0 with the row id named.
    const rowZip = buildGoodZip('conversations-backup-row.zip');
    insertRow(path.basename(rowZip), manifestHashHex(new AdmZip(rowZip).getEntry(MANIFEST_NAME).getData()));
    const rowRun = runCli(rowZip, { DB_PATH: dbPath });
    assert(rowRun.status === 0 && /manifest_hash_hex matches/.test(rowRun.stdout),
      'I5: history row hash agreement ⇒ exit 0, row cited', `status ${rowRun.status}, out: ${rowRun.stdout.slice(-200)}`);

    // I6. History-DB mismatch — a rewritten ZIP whose embedded manifest (and
    // sidecar) changed together still dies against the DB-logged hash: the
    // three-store point in one assertion.
    const pairZip = buildGoodZip('conversations-backup-rewritten.zip');
    insertRow(path.basename(pairZip), '0'.repeat(64));
    const pairRun = runCli(pairZip, { DB_PATH: dbPath });
    assert(pairRun.status === 1 && /DIFFERENT manifest hash/.test(pairRun.stderr),
      'I6: rewritten zip+manifest+sidecar still fails against the DB-logged hash', `status ${pairRun.status}, stderr: ${pairRun.stderr.slice(-160)}`);

    db.close();

    // I7. The newest REAL backup on disk verifies end-to-end (default DB
    // resolution — exactly what an operator runs). Backups predating the
    // out-of-band pair still verify via the embedded manifest; nothing on
    // disk at all is a skip note, not a failure.
    const backupsDir = path.resolve(process.env.BACKUP_PATH || './backups');
    const newest = fs.existsSync(backupsDir)
      ? fs.readdirSync(backupsDir)
          .filter((f) => /^conversations-backup-.*\.zip$/.test(f))
          .map((f) => ({ f, m: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m)[0]
      : null;
    if (!newest) {
      console.log('  I7 skipped: no conversations-backup-*.zip in ./backups (run testConversationBackup or the drill once)');
    } else {
      const liveRun = runCli(path.join(backupsDir, newest.f));
      const oob = fs.existsSync(`${path.join(backupsDir, newest.f)}${SIDECAR_SUFFIX}`);
      assert(liveRun.status === 0 && /VERDICT: (TRUSTED|OK)/.test(liveRun.stdout),
        `I7: newest real backup verifies (${newest.f}, out-of-band ${oob ? 'present' : 'absent — pre-feature degradation'})`, liveRun.stderr.slice(-200));
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  // ── J. Doctor first-boot seed check (sandboxed) — check #17 ────────
  {
    const { checkFirstBootSeed } = await import('./doctor.js');
    const quiet = { report: () => {} };       // rows come back, nothing prints
    const sb = path.resolve('scripts/.runtime/liveguard-firstboot');
    const dbFile = path.join(sb, 'database.sqlite');

    // J1. The REAL repo satisfies the contract — it must never report fail.
    // The dev DB's own asset count is environment state (0 on a fresh
    // checkout is legitimate), so a warn is allowed here.
    const real = await checkFirstBootSeed({ ...quiet });
    assert(real.status !== 'fail' && real.detail.includes('expected first boot'),
      `J1: real repo satisfies the first-boot contract (${real.status})`, real.detail.slice(0, 220));

    /** Replant a minimal sandbox repo (package.json + auto-seed migration +
     *  README); returns the dbPath the caller should pass. */
    const plant = ({ seedBulk = true, assetInsert = false, heading = true } = {}) => {
      fs.rmSync(sb, { recursive: true, force: true });
      fs.mkdirSync(path.join(sb, 'server', 'db', 'migrations'), { recursive: true });
      fs.writeFileSync(path.join(sb, 'package.json'),
        JSON.stringify({ scripts: seedBulk ? { 'seed:bulk': 'node scripts/generateBulkAssets.js' } : {} }, null, 2));
      fs.writeFileSync(path.join(sb, 'server', 'db', 'migrations', '20260831000002-auto-seed.js'),
        'export async function up(db) {\n'
        + "  await db.run('INSERT OR IGNORE INTO departments (name) VALUES (?)', ['Scene']);\n"
        + (assetInsert ? "  await db.run('INSERT INTO assets (id) VALUES (1)');\n" : '')
        + '}\n');
      fs.writeFileSync(path.join(sb, 'README.md'),
        heading
          ? '# Sandbox\n\n### Expected first-boot state\n\nFirst boot seeds no assets.\n'
          : '# Sandbox\n');
      return dbFile;
    };

    // J2. Clean contract, DB not created yet ⇒ ok (the first-boot story).
    let r = await checkFirstBootSeed({ root: sb, dbPath: plant(), ...quiet });
    assert(r.status === 'ok',
      'J2: clean sandbox (seed:bulk + asset-free auto-seed + README) ⇒ ok', r.detail.slice(0, 220));

    // J3. The documented explicit asset step is gone ⇒ fail.
    r = await checkFirstBootSeed({ root: sb, dbPath: plant({ seedBulk: false }), ...quiet });
    assert(r.status === 'fail' && r.detail.includes('seed:bulk'),
      'J3: missing seed:bulk script ⇒ fail with remediation', r.detail.slice(0, 220));

    // J4. auto-seed now inserts assets ⇒ first boot is no longer empty ⇒ fail.
    r = await checkFirstBootSeed({ root: sb, dbPath: plant({ assetInsert: true }), ...quiet });
    assert(r.status === 'fail' && r.detail.includes('no longer'),
      'J4: auto-seed inserting assets ⇒ fail (contract broken)', r.detail.slice(0, 220));

    // J5. README section gone ⇒ warn, never fail: this row states the
    // expectation either way, so the doctor stays informative on doc drift.
    r = await checkFirstBootSeed({ root: sb, dbPath: plant({ heading: false }), ...quiet });
    assert(r.status === 'warn' && r.detail.includes('Expected first-boot state'),
      'J5: README first-boot section missing ⇒ warn (expectation still stated)', r.detail.slice(0, 220));

    // J6/J7. The dev DB's actual asset count: 0 is the first-boot state
    // (warn + seed:bulk nudge for the UI suites), a seeded count is ok.
    const makeDb = async (n) => {
      plant();
      const { default: Database } = await import('better-sqlite3');
      const conn = new Database(dbFile);
      conn.exec('CREATE TABLE assets (id TEXT PRIMARY KEY)');
      const ins = conn.prepare('INSERT INTO assets (id) VALUES (?)');
      for (let i = 0; i < n; i++) ins.run(`A${i}`);
      conn.close();
      return dbFile;
    };

    r = await checkFirstBootSeed({ root: sb, dbPath: await makeDb(0), ...quiet });
    assert(r.status === 'warn' && r.detail.includes('seed:bulk'),
      'J6: dev DB at 0 assets ⇒ warn with the seed:bulk nudge (first-boot state)', r.detail.slice(0, 220));

    r = await checkFirstBootSeed({ root: sb, dbPath: await makeDb(3), ...quiet });
    assert(r.status === 'ok' && r.detail.includes('3 assets'),
      'J7: dev DB with seeded assets ⇒ ok, count reported', r.detail.slice(0, 220));

    fs.rmSync(sb, { recursive: true, force: true });
  }

  // ── K. Doctor numeric-falsy JSX check (sandboxed) — check #18 ─────
  {
    const { checkFalsyJsx } = await import('./doctor.js');
    const quiet = { report: () => {} };       // rows come back, nothing prints
    const sb = path.resolve('scripts/.runtime/liveguard-falsyjsx');
    const plant = (body) => {
      fs.rmSync(sb, { recursive: true, force: true });
      fs.mkdirSync(path.join(sb, 'src', 'components'), { recursive: true });
      fs.writeFileSync(path.join(sb, 'src', 'components', 'Pane.jsx'), body);
    };

    // K1. The REAL repo must never fail — the stray-zero fix stays fixed.
    const real = checkFalsyJsx({ ...quiet });
    assert(real.status !== 'fail',
      `K1: real repo has no numeric-falsy JSX guards (${real.status})`, real.detail.slice(0, 220));

    // K2. The classic bug: a 0/1 SQLite flag guarded with && ⇒ fail, named.
    plant('export default function P({ is_internal }) {\n'
      + '  return <div>{is_internal && <b>Internal Note</b>}</div>;\n}\n');
    let r = checkFalsyJsx({ root: sb, ...quiet });
    assert(r.status === 'fail' && r.detail.includes('is_internal'),
      'K2: {is_internal && …} ⇒ fail with the offending guard named', r.detail.slice(0, 220));

    // K3. Safe shapes must NOT trip it: ternary, comparison, camelCase state,
    // string columns — otherwise this [fail] would cry wolf on every push.
    plant('export default function P({ is_internal, unread_count, isOpen, title }) {\n'
      + '  return <div>{is_internal ? <b>x</b> : null}{unread_count > 0 && <b>y</b>}'
      + '{isOpen && <i>z</i>}{title && <u>t</u>}</div>;\n}\n');
    r = checkFalsyJsx({ root: sb, ...quiet });
    assert(r.status === 'ok',
      'K3: ternary / comparison / camelCase state / string guards ⇒ ok', r.detail.slice(0, 220));

    // K4. Counts count too: {unread_count && …} renders a literal "0".
    plant('export default function P({ unread_count }) {\n'
      + '  return <div>{unread_count && <b>!</b>}</div>;\n}\n');
    r = checkFalsyJsx({ root: sb, ...quiet });
    assert(r.status === 'fail' && r.detail.includes('unread_count'),
      'K4: {unread_count && …} ⇒ fail', r.detail.slice(0, 220));

    fs.rmSync(sb, { recursive: true, force: true });
  }

  console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
}

// Restore the env this suite pinned (captured above, before the pin).
main()
  .catch((err) => {
    console.error('suite crashed:', err.message);
    failed++;
  })
  .finally(() => {
    if (ORIG_DEV_API_PORT === undefined) delete process.env.DEV_API_PORT;
    else process.env.DEV_API_PORT = ORIG_DEV_API_PORT;
    process.exit(failed ? 1 : 0);
  });
