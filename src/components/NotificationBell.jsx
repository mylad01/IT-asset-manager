import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Bell, Clock, X, Check, CheckCheck, History } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../hooks/useNotifications';
import { readStoredPrefs } from '../config/applyPreferences';
import api from '../utils/apiClient';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import ModalPortal from './ModalPortal';
import NotificationToasts from './notifications/NotificationToasts';
import { EASE, getTypeIcon, getPriorityStyle } from './notifications/visuals';
import usePrefsVersion from '../hooks/usePrefsVersion';

export default function NotificationBell() {
  const navigate = useNavigate();
  // The OS media query AND the registry's motion pref both suppress the
  // panel's motion: user motion=off/reduced must win over framer's default,
  // so the bell panel matches the app-wide contract. Subscribing to the
  // prefs-changed ping re-renders this component when the pref changes
  // mid-session (the motion read below re-derives from the blob).
  usePrefsVersion();
  const prefersReduced = useReducedMotion() || ['reduced', 'off'].includes(readStoredPrefs().motion);
  const {
    notifications,
    unreadCount,
    isConnected,
    dismiss,
    snooze,
    markAllRead,
    subscribe,
  } = useNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [allNotifications, setAllNotifications] = useState([]);
  const [loadingAll, setLoadingAll] = useState(false);

  const bellRef = useRef(null);
  const panelRef = useRef(null);

  const fetchAllNotifications = useCallback(async () => {
    setLoadingAll(true);
    const { ok, data } = await api.get('/api/notifications/all?limit=100', { showToast: false });
    if (ok && Array.isArray(data)) {
      setAllNotifications(data);
    }
    setLoadingAll(false);
  }, []);

  useEffect(() => {
    if (showAll && isOpen) {
      fetchAllNotifications();
    }
  }, [showAll, isOpen, fetchAllNotifications]);

  useEffect(() => {
    return subscribe((type, _data) => {
      if (type === 'notification' && showAll) {
        fetchAllNotifications();
      }
    });
  }, [subscribe, showAll, fetchAllNotifications]);

  /* Popup lifecycle: Esc closes, focus moves in on open and back to the
     bell on close, and the page behind the backdrop stops scrolling. */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const focusTimer = setTimeout(() => panelRef.current?.focus(), 30);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const bellNode = bellRef.current;
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      bellNode?.focus?.();
    };
  }, [isOpen]);

  const handleDismiss = async (id, e) => {
    e.stopPropagation();
    await dismiss(id);
  };

  const handleSnooze = async (id, e) => {
    e.stopPropagation();
    await snooze(id);
  };

  const handleNotificationClick = (notification) => {
    if (notification.link) {
      navigate(notification.link);
    }
    if (!notification.is_read) {
      dismiss(notification.id);
    }
    setIsOpen(false);
  };

  const renderNotification = (note, { isHistory } = {}) => {
    const priority = note.priority || 'info';
    const style = getPriorityStyle(priority);
    const isRead = isHistory && note.is_read === 1;
    const isSnoozed = isHistory && note.snooze_until && new Date(note.snooze_until) > new Date();

    return (
      <motion.li
        key={note.id}
        layout="position"
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -24 }}
        transition={{ duration: prefersReduced ? 0 : 0.28, ease: EASE }}
        className={`group relative p-4 pl-5 hover:bg-white/5 transition-colors cursor-pointer overflow-hidden ${style.bg} ${isRead ? 'opacity-50' : ''}`}
        onClick={() => handleNotificationClick(note)}
      >
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${style.dot}`} />
        <div className="flex items-start gap-3 w-full">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${style.bg} border ${style.border}`}>
            {isRead ? (
              <CheckCheck size={15} className="text-[color:var(--status-success)]" />
            ) : isSnoozed ? (
              <Clock size={15} className="text-[color:var(--status-warning)]" />
            ) : (
              getTypeIcon(note.type)
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <p className={`text-sm font-bold break-words leading-snug ${isRead ? 'tt-sec' : 'tt'}`}>
                {note.title || note.message}
              </p>
              <span className="text-[10px] font-semibold tt-muted mt-0.5 shrink-0 whitespace-nowrap">
                {new Date(note.created_at).toLocaleString()}
              </span>
            </div>
            {note.message !== note.title && note.message && (
              <p className={`text-sm mt-1 break-words leading-snug ${isRead ? 'tt-muted' : 'tt-sec'}`}>
                {note.message}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${style.bg} border ${style.border} tt`}>
                {priority}
              </span>
              <span className="text-[10px] tt-muted uppercase">{note.type}</span>
              {isRead && <span className="text-[10px] text-[color:var(--status-success)]/60 uppercase">read</span>}
              {isSnoozed && <span className="text-[10px] text-[color:var(--status-warning)]/60 uppercase">snoozed</span>}
            </div>
          </div>
        </div>
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => handleSnooze(note.id, e)}
            className="glass-btn text-[10px] px-2 py-1 cursor-pointer hover:!bg-[color:var(--status-warning-strong)]/30"
            title="Snooze 24h"
          >
            <Clock size={10} />
          </button>
          <button
            onClick={(e) => handleDismiss(note.id, e)}
            className="glass-btn text-[10px] px-2 py-1 cursor-pointer"
            title="Dismiss"
          >
            <X size={10} />
          </button>
        </div>
      </motion.li>
    );
  };

  return (
    <div className="relative">
      <button
        ref={bellRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 tt-muted hover:tt-sec transition-colors cursor-pointer rounded-lg hover:bg-white/10"
        aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
      >
        <Bell size={18} />
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              key="unread-dot"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute top-1 right-1 w-2 h-2 bg-[color:var(--status-danger-strong)] rounded-full border-2 border-[rgba(12,12,28,0.72)] shadow-lg shadow-[color:var(--status-danger-strong)]/50"
            />
          )}
          {isConnected && (
            <motion.span
              key="live-dot"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-1 right-1 w-1.5 h-1.5 bg-[color:var(--status-success)] rounded-full"
              title="Live"
            />
          )}
        </AnimatePresence>
      </button>

      {/* Portal stays mounted; AnimatePresence lives INSIDE it so exit
          animations run in the same React tree as the portal — cross-portal
          exit orchestration is unreliable and strands the panel at opacity 0. */}
      <ModalPortal>
        <AnimatePresence>
          {isOpen && (
            <React.Fragment key="notification-popup">
            {/* Backdrop — soft dim + blur, click to dismiss */}
            <motion.div
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReduced ? 0 : 0.25, ease: 'easeOut' }}
              onClick={() => setIsOpen(false)}
            />

            {/* 75% × 75% screen popup, centered on the viewport.
                The outer shell positions; a wrapper owns the SIZE —
                .glass-modal sets `width: 100%` in unlayered CSS, which
                beats Tailwind utilities, so sizing must live on the
                wrapper and the panel fills it. The inner motion.div
                animates — framer owns the transform. */}
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <div className="pointer-events-auto flex w-[92vw] h-[85vh] sm:w-[75vw] sm:h-[75vh]">
                <motion.div
                  ref={panelRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Notifications"
                  tabIndex={-1}
                  onClick={(e) => e.stopPropagation()}
                  className="glass-modal flex flex-col w-full h-full outline-none"
                initial={{ opacity: 0, scale: 0.94, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 16 }}
                  transition={{
                    duration: prefersReduced ? 0 : 0.38,
                    ease: EASE,
                  }}
                >
                {/* Header */}
                <div className="shrink-0 p-5 border-b border-white/10 flex justify-between items-center bg-gradient-to-r from-[color:var(--ui-indigo-strong)]/20 to-[color:var(--ui-purple-strong)]/15">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold tt text-base">Notifications</h3>
                    {unreadCount > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[color:var(--ui-indigo-strong)]/30 border border-[color:var(--ui-indigo)]/30 tt">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-xs tt-sec hover:tt px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                    <span
                      className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[color:var(--status-success)]' : 'bg-[color:var(--status-warning)]'}`}
                      title={isConnected ? 'Live' : 'Polling'}
                    />
                    <button
                      onClick={() => setIsOpen(false)}
                      className="p-1.5 rounded-full tt-muted hover:tt hover:bg-white/10 transition-colors cursor-pointer"
                      aria-label="Close notifications"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Body — the only scrolling region */}
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                  {showAll ? (
                    loadingAll ? (
                      <div className="p-8 text-center tt-muted">
                        <span className="text-sm">Loading history...</span>
                      </div>
                    ) : allNotifications.length === 0 ? (
                      <div className="p-8 text-center tt-muted flex flex-col items-center gap-2">
                        <Check className="text-[color:var(--status-success)]" size={24} />
                        <span className="text-sm font-medium">No notifications yet</span>
                      </div>
                    ) : (
                      <ul className="divide-y divide-white/5">
                        <AnimatePresence initial={false}>
                          {allNotifications.map((note) => renderNotification(note, { isHistory: true }))}
                        </AnimatePresence>
                      </ul>
                    )
                  ) : notifications.length === 0 ? (
                    <div className="p-8 text-center tt-muted flex flex-col items-center gap-2">
                      <Check className="text-[color:var(--status-success)]" size={24} />
                      <span className="text-sm font-medium">You're all caught up!</span>
                    </div>
                  ) : (
                    <ul className="divide-y divide-white/5">
                      <AnimatePresence initial={false}>
                        {notifications.map((note) => renderNotification(note))}
                      </AnimatePresence>
                    </ul>
                  )}
                </div>

                {/* Footer */}
                {(notifications.length > 0 || allNotifications.length > 0) && (
                  <div className="shrink-0 p-3 border-t border-white/10 bg-white/5">
                    <button
                      onClick={() => setShowAll(!showAll)}
                      className="w-full text-sm tt-sec hover:tt py-2 rounded-lg hover:bg-white/10 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <History size={14} />
                      {showAll ? 'Show active only' : 'Show all notifications'}
                    </button>
                  </div>
                )}                </motion.div>
              </div>
            </div>
            </React.Fragment>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* Slide-in banners for live-arriving notifications; clicking one
          opens this popup. Must stay mounted so it can receive events,
          and shares the bell's single live connection. */}
      <NotificationToasts
        onOpenPopup={() => setIsOpen(true)}
        isPopupOpen={isOpen}
        subscribe={subscribe}
        dismiss={dismiss}
        snooze={snooze}
      />
    </div>
  );
}
