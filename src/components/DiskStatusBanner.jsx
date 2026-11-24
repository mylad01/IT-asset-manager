// DiskStatusBanner.js — calm, app-wide storage notice.
//
// Shown when the API reports storage trouble (503 DISK_CRITICAL/DISK_FULL on
// writes, or disk.status 'critical' from /api/health). Design goals:
//   - Calm: sticky but non-alarming — amber (writes paused, browsing fine),
//     red only when storage is fully exhausted. No toast spam: the banner
//     replaces itself instead of stacking.
//   - Actionable: says what happened, what still works, who to contact.
//   - Self-clearing: polls /api/health; when disk status recovers, the
//     banner disappears without a reload.
//
// Events (dispatched by utils/apiClient via the SHARED contract in
// utils/diskEvents.js — event name + payload shape declared once):
//   disk-status detail { kind: 'critical' | 'full', retryAfter?, freeBytes? }

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HardDrive, X } from 'lucide-react';
import api from '../utils/apiClient';
import { DISK_STATUS_EVENT } from '../utils/diskEvents';

const POLL_INTERVAL_MS = 30_000;
const SEEN_TTL_MS = 5 * 60 * 1000; // dismissed banner stays hidden for 5 min
// Storage audit (doctor check #16): this module is the docstring-justified
// SINGLE OWNER of the `diskBannerSeenUntil` literal — a scoped, not retired,
// exception. Justification: sessionStorage is tab-scoped and ephemeral by
// definition; the dismiss TTL is UI state for THIS tab only (a second tab
// legitimately shows the banner again), it holds no user data, and syncing
// it through the prefs API would resurrect a dismissed alert after reload.
const SEEN_UNTIL_KEY = 'diskBannerSeenUntil';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export default function DiskStatusBanner() {
  const [notice, setNotice] = useState(null); // { kind: 'critical'|'full', freeBytes?, retryAfter? }
  const [dismissedUntil, setDismissedUntil] = useState(() =>
    parseInt(sessionStorage.getItem(SEEN_UNTIL_KEY) || '0', 10)
  );

  useEffect(() => {
    let alive = true;

    // ── apiClient → banner ──
    // Idempotent for burst failures: same kind overwrites, 'full' escalates
    // over 'critical' but never downgrades from it. Event notices come from
    // an action the user JUST experienced — they override a lingering
    // dismissal (the poll-driven proactive show is what honors it).
    const onDiskNotice = (e) => {
      const { kind, retryAfter, freeBytes } = e.detail || {};
      setDismissedUntil(0);
      sessionStorage.removeItem(SEEN_UNTIL_KEY);
      setNotice((prev) => {
        if (kind === 'full') return { kind, retryAfter, freeBytes: freeBytes ?? prev?.freeBytes };
        if (prev?.kind === 'full') return prev; // never de-escalate
        return { kind, retryAfter: retryAfter ?? prev?.retryAfter, freeBytes: freeBytes ?? prev?.freeBytes };
      });
    };
    window.addEventListener(DISK_STATUS_EVENT, onDiskNotice);

    // ── Health poll: proactive show + automatic recovery clear ──
    const poll = async () => {
      try {
        const { ok, data } = await api.get('/api/health', { showToast: false, retries: 0 });
        if (!alive) return;
        if (!ok) return; // server unreachable: leave any existing notice alone
        const status = data?.disk?.status;
        if (status === 'critical') {
          setNotice((prev) => ({
            kind: 'critical',
            freeBytes: data?.disk?.free_bytes ?? prev?.freeBytes,
            retryAfter: prev?.retryAfter,
          }));
        } else if (status === 'ok' || status === 'low') {
          setNotice(null);
          setDismissedUntil(0);
          sessionStorage.removeItem(SEEN_UNTIL_KEY);
        }
      } catch { /* health probe failure is not a banner condition */ }
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(DISK_STATUS_EVENT, onDiskNotice);
    };
  }, []);

  const dismiss = () => {
    const until = Date.now() + SEEN_TTL_MS;
    sessionStorage.setItem(SEEN_UNTIL_KEY, String(until));
    setDismissedUntil(until);
  };

  // Dismissal only hides POLL-driven notices; a fresh event (the user just
  // hit a failed action) always shows.
  const hidden = notice == null || dismissedUntil > Date.now();
  if (hidden) return null;

  const isFull = notice.kind === 'full';
  const title = isFull ? 'Storage is full' : 'Storage is critically low';
  const body = isFull
    ? 'The server cannot save new data right now. Nothing you just tried was lost — please try again once an administrator frees up space.'
    : 'Saving is paused until an administrator frees up disk space. Browsing and viewing still work.';

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] max-w-lg w-[calc(100%-2rem)]"
    >
      <div
        className={`glass-modal p-4 flex items-start gap-3 border ${
          isFull ? 'border-[color:var(--status-danger)]/40' : 'border-[color:var(--status-warning)]/40'
        }`}
        style={{ boxShadow: 'var(--glass-shadow-lg)' }}
      >
        <div className={`p-2 rounded-xl shrink-0 ${isFull ? 'bg-[color:var(--status-danger-strong)]/20' : 'bg-[color:var(--status-warning-strong)]/20'}`}>
          <HardDrive size={18} className={isFull ? 'text-[color:var(--status-danger)]' : 'text-[color:var(--status-warning)]'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold tt">{title}</p>
          <p className="text-xs tt-sec mt-1 leading-relaxed">{body}</p>
          {typeof notice.freeBytes === 'number' && (
            <p className="text-[11px] tt-muted mt-1">
              Free space remaining: {formatBytes(notice.freeBytes)}
              {notice.retryAfter ? ` · retry in ~${notice.retryAfter}s` : ''}
            </p>
          )}
        </div>
        <button
          onClick={dismiss}
          className="p-1 rounded-full text-white/30 hover:text-white hover:bg-white/10 transition-all cursor-pointer shrink-0"
          aria-label="Dismiss storage notice"
        >
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body
  );
}
