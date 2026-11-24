/**
 * server/utils/liveApiGuard.js — shared "the dev database is in use" guard
 * for destructive/DB-writing scripts.
 *
 * Home: LIVES in server/ because production code depends on it
 * (server/db/reseed-admin.js is a production entrypoint via
 * `npm run reseed:admin`); scripts import it DOWN from here — the
 * dependency arrow never points from production into dev tooling.
 * Originally scripts/lib/liveApiGuard.js, promoted 2026-09-27 (same move
 * as appLock.js) when the layering sweep found the upward import.
 *
 * Why: several scripts open the dev database directly (connectionManager)
 * or wipe its files. Doing that while the dev API is serving the same DB
 * races the server's WAL handle — resetDb wedges it, seeders race bulk
 * writes. The guard refuses (exit code from the caller) when:
 *
 *   1. an image-validated node process LISTENS on :3000 (the dev API), or
 *   2. a node process holds the dev DB WITHOUT any listener — the "ghost
 *      server" class: a process that crashed after `server.listen` was
 *      skipped but after the DB opened, or a script still finishing its
 *      writes after the server died (observed as post-shutdown handle lag
 *      of ~8s). A pure port check cannot see these: SQLite WAL happily
 *      allows concurrent openers, so there is no "open probe", and Windows
 *      has no lsof. Instead the guard sweeps the process table (via
 *      listNodeCommands) and flags any node whose command line matches
 *      our server entrypoint or the resolved DB path.
 *
 * The command-line match is deliberately narrow to avoid false positives:
 *   - the repo's server entrypoint `server/index.js` (any node process
 *     started from this checkout), or
 *   - the resolved dev DB path itself (e.g. `database.sqlite`) — catches
 *     scripts like resetDb/seedBulkAll started from OTHER checkouts or
 *     with an explicit DB_PATH.
 * An unrelated node process (an MCP server, Vite, a chat client) has
 * neither string in its command line and is never flagged.
 *
 * Opt-out: RESET_DB_ALLOW_LIVE=1 proceeds DESPITE a live holder — for
 * operators who KNOW the listener/holder is unrelated. Every skip is
 * logged loudly.
 *
 * Fail-open policy: if the guard's own probes fail (tasklist/wmic
 * unavailable, etc.), the script proceeds — the guard must never make a
 * script unusable; it protects the common case, not the adversarial one.
 * Every outcome is logged, so a fail-open is visible in output.
 *
 * Usage (top-level await, ESM):
 *   const verdict = await refuseIfDevApiLive('resetDb');
 *   if (verdict.refused) process.exit(1);
 *   // … destructive work …
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const GUARD_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Port the dev API serves. Override via DEV_API_PORT for exotic setups. */
const DEV_API_PORT = parseInt(process.env.DEV_API_PORT, 10) || 3000;

/** Mirror of server/config/env.js DB_PATH resolution (LOAD_TEST_DB_PATH →
 *  DB_PATH → ./database.sqlite), so the ghost sweep matches what a server
 *  or script would ACTUALLY open — process env wins over .env. Exported:
 *  the regression suite and the doctor reuse it instead of re-deriving
 *  the same resolution rules. */
export function resolveDevDbPath() {
  const fromEnv = process.env.LOAD_TEST_DB_PATH || process.env.DB_PATH;
  if (fromEnv) return path.resolve(fromEnv).toLowerCase();
  const envPath = path.join(GUARD_ROOT, '.env');
  let dbPath = null;
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf-8').match(/^\s*DB_PATH\s*=\s*(.*)$/m);
    if (m) dbPath = m[1].trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
  }
  return path.resolve(dbPath || './database.sqlite').toLowerCase();
}

/**
 * Check and refuse when the dev DB is in use (live API on :3000 OR a
 * ghost holder). Returns { refused, pid, image, checked, holders } —
 * refused=true means the caller must stop (the message is already
 * printed). holders = [{ pid, via }] for the ghost sweep; `pid`/`image`
 * describe the :3000 listener when that is the reason. `checked` is true
 * whenever the port probe itself ran (unchanged contract for callers).
 */
export async function refuseIfDevApiLive(scriptName, { overrideEnv = 'RESET_DB_ALLOW_LIVE' } = {}) {
  const result = { refused: false, pid: null, image: null, checked: false, holders: [] };
  try {
    // appLock primitives live in server/utils (production owns them); scripts
    // import DOWN from there — the arrow must never point into scripts/.
    const { findListenerOwners, getProcessImage, listNodeCommands } = await import('./appLock.js');

    // ── 1. Port probe: a node LISTENER on :3000 is the dev API ──────
    const listeners = await findListenerOwners(DEV_API_PORT);
    result.checked = true;
    if (listeners.length) {
      // Image-validate the newest listener: only a node.exe counts as
      // "our dev API" (a foreign listener is reported, not treated as
      // the API).
      let nodePid = null;
      let image = null;
      for (const pid of listeners) {
        const probe = await getProcessImage(pid);
        if (probe.exists && (probe.image === 'node.exe' || probe.image === 'node')) {
          nodePid = pid;
          image = probe.image;
          break;
        }
      }
      if (!nodePid) {
        console.log(`[${scriptName}] live-API guard: :${DEV_API_PORT} held by non-node process(es) [${listeners.join(', ')}] — not our dev API, proceeding`);
      } else {
        result.pid = nodePid;
        result.image = image;
        if (process.env[overrideEnv] === '1') {
          console.warn(`[${scriptName}] ${overrideEnv}=1 — proceeding despite node dev API on :${DEV_API_PORT} (pid ${nodePid}).`);
          return result;
        }
        console.error(`\n[${scriptName}] ❌  A node dev API (pid ${nodePid}) is listening on :${DEV_API_PORT} — refusing to touch the database it may be serving.`);
        console.error(`[${scriptName}]     Stop it first (npm run kill), or set ${overrideEnv}=1 if the listener is unrelated.\n`);
        result.refused = true;
        return result;
      }
    }

    // ── 2. Ghost sweep: node processes holding the DB with NO listener ──
    // A node process is a "holder" when its command line names our server
    // entrypoint (server/index.js) or the resolved dev DB path. Anything
    // else (Vite, MCP servers, unrelated node tools) is skipped.
    let sweep = [];
    try { sweep = await listNodeCommands(); } catch { sweep = []; }
    const dbPath = resolveDevDbPath();
    const rootLower = GUARD_ROOT.toLowerCase();
    // server/index.js counts as OURS only when invoked relatively (the dev
    // case: `node server/index.js` from the repo root) or from this repo's
    // own root — another checkout's server has a different drive path in
    // front of it and is not our problem. The DB path match is absolute by
    // construction: the same resolved path IS the same file. Both separator
    // styles are matched — wmic reports the command line exactly as typed.
    const serverEntries = ['server/index.js', path.join('server', 'index.js')];
    // For each entry occurrence: a RELATIVE invocation ("node server/index.js")
    // is ours by definition. An ABSOLUTE occurrence ("…\server\index.js") is
    // ours only when the path segment it belongs to names this checkout —
    // testing the whole prefix would misfire on every host where node lives
    // on another drive (C:\Program Files\nodejs\node.exe server/index.js was
    // exactly the false negative caught live). Multiple occurrences are
    // checked independently: one foreign path cannot mask a relative one.
    const viaFor = (command) => {
      for (const entry of serverEntries) {
        let idx = command.indexOf(entry);
        while (idx !== -1) {
          const before = command.slice(Math.max(0, idx - 400), idx);
          if (/\\$|\/$/.test(before)) {
            const seg = (before.match(/(?:^|[\s"'])([^\s"']+)$/)?.[1]) ?? before;
            if (seg.includes(rootLower)) return 'server-entry';
          } else {
            return 'server-entry';
          }
          idx = command.indexOf(entry, idx + entry.length);
        }
      }
      return dbPath && command.includes(dbPath) ? 'db-path' : null;
    };
    const holders = [];
    for (const { pid, command } of sweep) {
      const via = viaFor(command);
      if (via) holders.push({ pid, via });
    }
    result.holders = holders;
    if (holders.length) {
      const detail = holders.map((h) => `pid ${h.pid} (${h.via})`).join(', ');
      if (process.env[overrideEnv] === '1') {
        console.warn(`[${scriptName}] ${overrideEnv}=1 — proceeding despite node process(es) holding the dev DB without a listener: ${detail}.`);
        return result;
      }
      console.error(`\n[${scriptName}] ❌  Node process(es) hold the dev database WITHOUT a listener on :${DEV_API_PORT} — the "ghost server" class: ${detail}.`);
      console.error(`[${scriptName}]     It may be a crashed server still finishing writes, or a script mid-reset. Wait a few seconds and retry, or kill it explicitly.`);
      console.error(`[${scriptName}]     If you are CERTAIN the holder is unrelated, set ${overrideEnv}=1 to proceed anyway.\n`);
      result.refused = true;
      return result;
    }

    console.log(`[${scriptName}] live-API guard: :${DEV_API_PORT} free, no node process holds ${dbPath ? path.basename(dbPath) : 'the dev DB'} — proceeding`);
    return result;
  } catch (err) {
    console.warn(`[${scriptName}] live-API guard could not run (${String(err?.message || err).slice(0, 80)}) — proceeding without it.`);
    return result;
  }
}
