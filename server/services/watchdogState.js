/**
 * server/services/watchdogState.js — live state of the lock + listener
 * watchdog, exposed through /api/health (`lock` block) so operators can see
 * split-brain risks at a glance:
 *
 *   lock.holder_pid            — the pid CLAIMING the lock (this process)
 *   lock.last_verdict          — the last image-validated check of the lock
 *                                file (who it actually pointed at, live?)
 *   lock.recent_events         — durable watchdog events, newest first,
 *                                INCLUDING the previous run's fatal events
 *                                (port theft / lock conflict)
 *
 * Cross-checking holder_pid against `head logs/.app.lock`, netstat, or
 * another instance's health answer is what turns a claim into evidence.
 * Written only by server/index.js's watchdog tick; read by the health
 * route. Plain mutable singleton — one watchdog per process, no locking
 * needed (Node runs the async tick to completion between awaits).
 */
import fs from 'node:fs';
import path from 'node:path';

export const watchdogState = {
  enabled: false,
  periodMs: null,
  startedAt: null,
  // Last completed tick (port check + lock check + any healing)
  lastCheckAt: null,        // ISO timestamp
  lastCheckMs: null,        // tick duration in ms
  ticks: 0,
  // Lock healing
  reStamps: 0,
  lastReStampAt: null,
  lastReStampReason: null,  // 'vanished' | stale verdict reason
  // Evidence from the last image-validated lock check
  lastVerdict: null,        // { at, pid, image, live, reason }
  lastError: null,
  // Durable events (see appendWatchdogEvent): newest first, ≤ MAX_RECENT.
  // Includes events from the PREVIOUS run — loaded at boot — which is how
  // a port theft or lock conflict remains visible after the fatal exit
  // that caused it (in-memory counters cannot survive process.exit).
  recentEvents: [],
};

// ── Durable event log (JSONL next to the lock file) ────────────────────
// Theft/conflict paths end in process.exit(1), so their evidence must be
// written to disk synchronously BEFORE exiting. Restamps are also logged
// (audit trail across restarts). Bounded: the file is truncated to its
// last TRIM_TO_LINES lines once it exceeds MAX_FILE_BYTES.
const MAX_FILE_BYTES = 512 * 1024;
const TRIM_TO_LINES = 200;
const MAX_RECENT = 5;

let eventsPath = null;                    // Set by initWatchdogEvents() at boot

function readEvents() {
  try {
    return fs.readFileSync(eventsPath, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }                  // Missing/unreadable file = no history
}

/** Set the durable log location and load recent events into state.
 *  Call once at boot, before the watchdog can write anything. */
export function initWatchdogEvents(filePath) {
  eventsPath = filePath;
  watchdogState.recentEvents = readEvents().slice(-MAX_RECENT).reverse();
}

/** Append one event to the durable log and mirror it into recentEvents.
 *  Sync + never throws: the caller is often about to process.exit(1), and
 *  this file write is that exit's only surviving evidence. */
export function appendWatchdogEvent(event) {
  const entry = { at: new Date().toISOString(), pid: process.pid, ...event };
  if (eventsPath) {
    try {
      fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
      let previous = readEvents();
      let payload = `${JSON.stringify(entry)}\n`;
      if (fs.existsSync(eventsPath) && fs.statSync(eventsPath).size > MAX_FILE_BYTES) {
        previous = previous.slice(-TRIM_TO_LINES);
        payload = `${previous.map((e) => JSON.stringify(e)).join('\n')}\n${payload}`;
        fs.writeFileSync(eventsPath, payload, 'utf-8');
      } else {
        fs.appendFileSync(eventsPath, payload, 'utf-8');
      }
    } catch { /* disk issues must never crash the watchdog or delay the exit */ }
  }
  watchdogState.recentEvents = [entry, ...watchdogState.recentEvents].slice(0, MAX_RECENT);
}

/** Record a completed tick. `extra` may carry the lock verdict and/or error. */
export function noteTickEnd(startedAtMs, extra = {}) {
  watchdogState.ticks += 1;
  watchdogState.lastCheckAt = new Date().toISOString();
  watchdogState.lastCheckMs = Date.now() - startedAtMs;
  if (extra.verdict) {
    watchdogState.lastVerdict = {
      at: watchdogState.lastCheckAt,
      pid: extra.verdict.pid ?? null,
      image: extra.verdict.image ?? null,
      live: extra.verdict.live ?? false,
      reason: extra.verdict.reason ?? null,
    };
  }
  if (extra.error) watchdogState.lastError = String(extra.error.message || extra.error);
}

/** Record a self-healing re-stamp of the lock file. */
export function recordRestamp(reason, verdict = null) {
  watchdogState.reStamps += 1;
  watchdogState.lastReStampAt = new Date().toISOString();
  watchdogState.lastReStampReason = reason || (verdict?.reason ?? 'unknown');
}
