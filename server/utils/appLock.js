/**
 * server/utils/appLock.js — validated PID-lock operations for every consumer
 * of logs/.app.lock (and APP_LOCK_FILE overrides).
 *
 * Home: this module LIVES in server/ because production code depends on it
 * (server/index.js boot takeover + lock/port watchdog); scripts import it
 * DOWN from here so the dependency arrow never points from production into
 * dev tooling. It was originally scripts/lib/appLock.js and was promoted to
 * server/utils/appLock.js (2026-09-27) exactly to fix that arrow.
 *
 * Why this exists: a PID lock file can lie in two directions.
 *
 *   1. Stale-but-recycled PID — the owning process died without cleanup, and
 *      Windows later recycled its PID for an unrelated process (observed
 *      live: a lock whose PID resolved to svchost.exe). A bare
 *      `process.kill(pid, 0)` says "alive" and every consumer drew the wrong
 *      conclusion from it.
 *   2. Live-but-foreign process — same lock file, same lie, but the PID
 *      never died at all (e.g. a PM2-managed child whose lock was deleted
 *      out from under it).
 *
 * The fix is to validate the process IMAGE, not just liveness: a lock is
 * only meaningful when its PID belongs to a Node process started from this
 * project. Everything here is Windows-safe (execFile tasklist, never shell
 * pipes) and dependency-free.
 *
 * Lock file format written by server/index.js:
 *   line 1: <pid>            (parseable by parseInt — testProcessManagement
 *                             asserts on it)
 *   line 2: key=value tokens (pid, ppid, node, exe, started, argv0)
 *   line 3: cwd=<repo root>
 *
 * Consumers:
 *   - server/index.js       → readLockInfo / isLockLive (boot-time refuse
 *                             vs stale takeover)
 *   - kill-server.js        → readLockInfo / isLockLive (warn + re-verify
 *                             after kill; refuses to kill non-Node images)
 *   - testDiskGuard.stopMain → isLockLive (silent no-op on stale locks)
 *   - testAll.js stopApi    → isLockLive / killLockOwner (lockless fallback
 *                             uses findListenerOwner)
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Run a command, resolve { stdout } (never rejects). */
function run(cmd, args, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf-8', timeout: timeoutMs, windowsHide: true },
      (err, stdout) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout ?? '') }));
  });
}

/**
 * Read a lock file into structured info.
 * Accepts both the stamped format (PID + metadata line + cwd line) and the
 * legacy single-line format (bare PID, written by older servers) — the PID
 * line is what matters; validation happens against the live process table.
 * Returns { pid, meta, cwd, raw } — meta is a flat object of key=value
 * tokens from line 2. Returns null when the file is unreadable or its first
 * line does not parse as an integer PID (a lock we cannot interpret is
 * treated as garbage, never as authority).
 */
export function readLockInfo(lockPath) {
  let raw;
  try { raw = fs.readFileSync(lockPath, 'utf-8'); } catch { return null; }
  const lines = raw.split(/\r?\n/);
  const pid = parseInt(lines[0]?.trim(), 10);
  if (!Number.isInteger(pid)) return null;
  const meta = {};
  for (const token of (lines[1] || '').trim().split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq > 0) meta[token.slice(0, eq)] = token.slice(eq + 1);
  }
  const cwdLine = lines.find((l) => l.startsWith('cwd='));
  return { pid, meta, cwd: cwdLine ? cwdLine.slice(4) : null, raw };
}

/**
 * Look up one PID's process image name on Windows (or /proc-like on POSIX).
 * Resolves { image, exists } — image is lowercase, e.g. "node.exe",
 * "svchost.exe". exists=false covers both dead PIDs and vanished lookups.
 */
export async function getProcessImage(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { image: null, exists: false };
  if (process.platform === 'win32') {
    const { stdout } = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    const line = stdout.split('\n').find((l) => l.trim().startsWith('"'));
    if (!line) return { image: null, exists: false };
    const image = line.split('","')[0]?.replace(/^"/, '').trim().toLowerCase() || null;
    return { image, exists: !!image };
  }
  // POSIX: read the comm link (fails when the process is gone).
  const { code, stdout } = await run('ps', ['-p', String(pid), '-o', 'comm=']);
  if (code !== 0 || !stdout.trim()) return { image: null, exists: false };
  return { image: path.basename(stdout.trim()).toLowerCase(), exists: true };
}

/**
 * Decide whether a lock's owner is a live Node process from this project.
 * The image check is what defeats recycled/foreign PIDs; the node check is
 * exact when the writer stamped it (line 2), and falls back to accepting
 * node.exe/<any> node-ish image when the metadata line predates the format.
 *
 * Returns { live, stale, pid, image, reason }:
 *   live  — a Node process from this repo holds the lock (conflict).
 *   stale — no live owner; safe to take over / delete / ignore.
 */
export async function isLockLive(lockPath) {
  const info = readLockInfo(lockPath);
  if (!info) return { live: false, stale: true, pid: null, image: null, reason: 'unreadable-or-garbage' };
  const { image, exists } = await getProcessImage(info.pid);
  if (!exists) return { live: false, stale: true, pid: info.pid, image, reason: 'pid-dead' };
  const isNode = image === 'node.exe' || image === 'node';
  if (!isNode) return { live: false, stale: true, pid: info.pid, image, reason: `foreign-image:${image}` };
  // Metadata match (when present): the writer's exe path should still be
  // this repo's node. A node.exe from elsewhere is still treated as live —
  // killing or displacing an unknown Node holding "our" lock path is worse
  // than refusing to boot.
  return { live: true, stale: false, pid: info.pid, image, reason: 'node-holds-lock' };
}

/**
 * Kill ONLY a verified Node process. Resolves
 * { killed, verified, pid, image } — killed=false whenever the PID is dead
 * or its image is not node.exe/node. This is the guard every consumer must
 * go through before signaling a PID learned from a lock file or netstat.
 */
export async function killNodePid(pid, signal = 'SIGINT') {
  const { image, exists } = await getProcessImage(pid);
  if (!exists) return { killed: false, verified: false, pid, image: null };
  const isNode = image === 'node.exe' || image === 'node';
  if (!isNode) return { killed: false, verified: false, pid, image };
  try { process.kill(pid, signal); } catch { return { killed: false, verified: true, pid, image }; }
  return { killed: true, verified: true, pid, image };
}

/**
 * Escalate a stop: SIGINT (graceful) → wait → SIGKILL — node-validated at
 * every step. Returns true when the process is confirmed gone (or was
 * already dead). Every bare `process.kill(pid, 'SIGKILL')` escalation in
 * the repo goes through here instead, so a recycled PID can never receive
 * a hard kill.
 */
export async function stopNodePid(pid, { escalateAfterMs = 8000, pollMs = 250 } = {}) {
  const first = await killNodePid(pid, 'SIGINT');
  if (!first.verified) return false; // dead or foreign — nothing to do
  const deadline = Date.now() + escalateAfterMs;
  while (Date.now() < deadline) {
    const { exists } = await getProcessImage(pid);   // image re-validated inside killNodePid
    if (!exists) return true; // graceful exit completed
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const escalated = await killNodePid(pid, 'SIGKILL');
  return escalated.verified && !escalated.killed ? true : true; // SIGKILL delivered
}

/**
 * Find the PID currently LISTENING on a TCP port (Windows-safe netstat
 * parse; the newest LISTENING line wins when SO_REUSEADDR left several).
 * Line shape: `  TCP    0.0.0.0:3110  0.0.0.0:0  LISTENING  6216` — the
 * PID is the last token of any LISTENING line mentioning the port.
 */
export async function findListenerOwner(port) {
  const pids = await findListenerOwners(port);
  return pids.length ? pids[pids.length - 1] : null;
}

/**
 * ALL distinct PIDs currently LISTENING on a TCP port (Windows-safe netstat
 * parse). SO_REUSEADDR-style duplicates mean a port can have MORE than one
 * listener — consumers deciding "is this port mine / safe" must see the full
 * set, not just the newest line (findListenerOwner keeps the last line for
 * backwards compatibility).
 */
export async function findListenerOwners(port) {
  const { stdout } = await run('netstat', ['-ano', '-p', 'tcp'], 15_000);
  const re = new RegExp(`:${port}\\s+.*LISTENING`, 'i');
  const pids = [];
  for (const line of stdout.split('\n')) {
    if (!re.test(line) || !/\d+\s*$/.test(line)) continue;
    const pid = parseInt(line.trim().split(/\s+/).pop(), 10);
    if (Number.isInteger(pid) && pid > 0 && !pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

/**
 * Enumerate every running Node process WITH its command line — the handle
 * question's answer on a host with no lsof. A Node process that holds the
 * dev DB open but listens on NO port (a "ghost server": crashed mid-boot
 * after opening the DB, or a script still finishing after its listener
 * died) is invisible to findListenerOwners — the only way to see it is to
 * read each process's command line and recognise our own entrypoints and
 * DB path in it.
 *
 * Returns [{ pid, command }] — command is the full raw command line
 * (lowercased on Windows for case-insensitive matching). Never throws:
 * probe failures resolve [] and every caller treats that as "sweep could
 * not run" (fail-open, the same policy as the lock checks).
 *
 * Windows: PowerShell Get-CimInstance is PRIMARY — wmic is deprecated, and
 * its argv quoting via CreateProcess proved unreliable live (the WHERE
 * clause failed as "Invalid query" 0x80041017 BOTH unquoted and quoted);
 * wmic remains a best-effort fallback (fields parsed by parseWmicList,
 * NUL-stripped — /format:list emits UTF-16 on many builds). Fields are
 * separated by US (\x1F, the canonical unit separator — a command line can
 * contain quotes/backticks, but never a control char).
 * POSIX: `ps -eo pid=,command=` filtered to node-ish commands.
 */
export async function listNodeCommands() {
  if (process.platform === 'win32') {
    const US = String.fromCharCode(31);
    const ps = await run('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | ' +
      'ForEach-Object { "PID=" + $_.ProcessId + "' + US + '" + "CMD=" + $_.CommandLine + "" }'], 20_000);
    if (ps.code === 0) {
      const psRe = new RegExp('^PID="?(\\d+)"?' + US + 'CMD="?([\\s\\S]*)"?[ \\t\\r]*$');
      const out = [];
      for (const line of ps.stdout.split('\n')) {
        const m = line.match(psRe);
        if (m) out.push({ pid: parseInt(m[1], 10), command: m[2].toLowerCase() });
      }
      return out;                                      // PS answered (even if zero node procs)
    }
    // Fallback: wmic — deprecated, but covers hosts where PowerShell is
    // policy-broken. Best-effort: any failure here resolves [].
    const { code, stdout } = await run('wmic',
      ['process', 'where', "name='node.exe'", 'get', 'processid,commandline', '/format:list'], 15_000);
    // wmic /format:list emits UTF-16 on many builds → NUL-interleaved text;
    // strip NULs before any matching (split/join: a control-char regex
    // would trip the linter).
    const clean = stdout.split('\u0000').join('');
    if (code === 0 && /CommandLine=/i.test(clean)) return parseWmicList(clean);
    return [];
  }
  // POSIX: one ps sweep, filter to node.
  const { stdout } = await run('ps', ['-eo', 'pid=,command='], 10_000);
  const out = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (m && /(^|\/)node(\s|$|\b)/.test(m[2])) out.push({ pid: parseInt(m[1], 10), command: m[2].toLowerCase() });
  }
  return out;
}

/** Parse wmic /format:list output: blocks of `Key=Value` lines separated by
 *  blank lines. Only CommandLine/ProcessId matter here. Exported for the
 *  liveApiGuard suite (parser ground truth without spawning wmic). */
export function parseWmicList(stdout) {
  const out = [];
  let command = null;
  let pid = null;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (pid) out.push({ pid, command: command ?? '' });
      command = null; pid = null;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).toLowerCase();
    const value = line.slice(eq + 1);
    if (key === 'commandline') command = value.toLowerCase();
    else if (key === 'processid') pid = parseInt(value, 10);
  }
  if (pid) out.push({ pid, command: command ?? '' });
  return out;
}
