import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Clock, X } from 'lucide-react';
import ModalPortal from '../ModalPortal';
import api from '../../utils/apiClient';
import { readStoredPrefs } from '../../config/applyPreferences';
import { PREFS_CHANGED_EVENT } from '../../utils/prefEvents';
import { EASE, getTypeIcon, getPriorityStyle } from './visuals';

const TOAST_TTL_MS = 6000;   // auto-expire
const MAX_VISIBLE = 4;       // stack cap — oldest is dropped
const TICK_MS = 500;         // expiry sweeper cadence

/**
 * Slide-in banners for notifications arriving over the live WebSocket
 * channel. Purely event-driven: the initial fetch never emits events, so
 * pre-existing notifications stay silent. Clicking a banner opens the
 * bell's 75% popup; banners are suppressed while that popup is open.
 *
 * subscribe/dismiss/snooze are passed down from the bell so the banners
 * share the SAME live connection — a second useNotifications() instance
 * would open its own WebSocket and never see the bell's events.
 */
export default function NotificationToasts({ onOpenPopup, isPopupOpen, subscribe, dismiss, snooze }) {
  const prefersReduced = useReducedMotion();

  const [toasts, setToasts] = useState([]);
  const hoveredRef = useRef(new Set());
  /* Per-user preference (Settings → Notification Preferences), persisted on
     the users row via /api/auth/preferences. Kept in a ref so the subscribe
     handler below reads the live value without resubscribing; the default is
     enabled and an API failure fails open (banners stay on, current behavior). */
  const bannersEnabledRef = useRef(true);

  useEffect(() => {
    let mounted = true;
    api.get('/api/auth/preferences', { showToast: false }).then(({ ok, data }) => {
      if (mounted && ok) bannersEnabledRef.current = data?.toastBannersEnabled !== false;
    });
    // ANY registry-pref write (applyPreference / applyPreferences) pings this
    // payload-free event; we re-read the blob — the ONE source — instead of
    // trusting a hand-rolled event payload.
    const onPrefsChanged = () => {
      if (!mounted) return;
      const enabled = readStoredPrefs().toastBannersEnabled !== false;
      bannersEnabledRef.current = enabled;
      if (!enabled) setToasts([]); // turning off clears visible banners
    };
    window.addEventListener(PREFS_CHANGED_EVENT, onPrefsChanged);
    return () => {
      mounted = false;
      window.removeEventListener(PREFS_CHANGED_EVENT, onPrefsChanged);
    };
  }, []);

  const removeToast = useCallback((id) => {
    hoveredRef.current.delete(id);
    setToasts(prev => prev.filter(t => t.note.id !== id));
  }, []);

  /* Sweeper: drop expired banners (hovered ones are paused). */
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts(prev => {
        const next = prev.filter(t => hoveredRef.current.has(t.note.id) || t.expiresAt > now);
        return next.length === prev.length ? prev : next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  /* Incoming live notifications → banners. */
  useEffect(() => {
    return subscribe((type, data) => {
      if (type !== 'notification' || !data) return;
      if (isPopupOpen) return; // user is already looking at the live list
      if (!bannersEnabledRef.current) return; // user opted out of banners
      setToasts(prev => {
        // Double-delivery guard only applies when the payload carries an id
        // (server rows always do; an id-less payload would otherwise make
        // undefined === undefined match every entry forever).
        if (data.id != null && prev.some(t => t.note.id === data.id)) return prev;
        const entry = { note: data, key: data.id != null ? `n-${data.id}` : `t-${Date.now()}-${Math.random()}`, expiresAt: Date.now() + TOAST_TTL_MS };
        const next = [entry, ...prev];
        return next.slice(0, MAX_VISIBLE);
      });
    });
  }, [subscribe, isPopupOpen]);

  const handleActivate = (note) => {
    removeToast(note.id);
    onOpenPopup();
  };

  const handleSnooze = (note, e) => {
    e.stopPropagation();
    removeToast(note.id);
    snooze(note.id);
  };

  const handleDismiss = (note, e) => {
    e.stopPropagation();
    removeToast(note.id);
    dismiss(note.id);
  };

  return (
    <ModalPortal>
      {/* Lives below the popup's z-50 overlay and above the page.
          Centered under the app header; react-hot-toast owns top-right. */}
      <div
        className="fixed inset-x-0 top-20 z-40 flex flex-col items-center gap-2 px-3 pointer-events-none"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map(({ note, key }) => {
            const style = getPriorityStyle(note.priority);
            return (
              <motion.div
                key={key}
                layout
                role="button"
                tabIndex={0}
                aria-label={`New notification: ${note.title || note.message}. Open notifications popup`}
                onMouseEnter={() => hoveredRef.current.add(note.id)}
                onMouseLeave={() => hoveredRef.current.delete(note.id)}
                onClick={() => handleActivate(note)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleActivate(note); }
                }}
                initial={{ opacity: 0, y: -28, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -16, scale: 0.96 }}
                transition={{ duration: prefersReduced ? 0 : 0.34, ease: EASE }}
                className="pointer-events-auto relative w-full max-w-sm cursor-pointer overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--toast-bg)] backdrop-blur-xl shadow-[var(--glass-shadow-lg)] hover:shadow-[var(--glass-shadow-xl)] transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ui-indigo)]/60"
                style={{ backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)' }}
              >
                {/* priority accent */}
                <span className={`absolute left-0 top-0 bottom-0 w-1 ${style.dot}`} />

                <div className="flex items-start gap-3 p-3 pl-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${style.bg} border ${style.border}`}>
                    {getTypeIcon(note.type)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold tt break-words leading-snug">
                        {note.title || note.message}
                      </p>
                      <span className="text-[10px] font-semibold tt-muted mt-0.5 shrink-0 whitespace-nowrap">
                        {note.created_at ? new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    {note.message !== note.title && note.message && (
                      <p
                        className="text-xs tt-sec mt-0.5 break-words leading-snug"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {note.message}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${style.bg} border ${style.border} tt uppercase`}>
                        {note.priority || 'info'}
                      </span>
                      <span className="text-[9px] tt-muted uppercase">new</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => handleSnooze(note, e)}
                      className="glass-btn text-[10px] px-2 py-1 cursor-pointer hover:!bg-[color:var(--status-warning-strong)]/30"
                      title="Snooze 24h"
                      aria-label="Snooze this notification for 24 hours"
                    >
                      <Clock size={10} />
                    </button>
                    <button
                      onClick={(e) => handleDismiss(note, e)}
                      className="glass-btn text-[10px] px-2 py-1 cursor-pointer"
                      title="Dismiss"
                      aria-label="Dismiss this notification"
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ModalPortal>
  );
}
