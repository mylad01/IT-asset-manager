import React from 'react';
import { CalendarDays } from 'lucide-react';
import useLeavePendingCount from '../hooks/useLeavePendingCount';

/**
 * Leave-pending badge for the sidebar nav.
 *
 * Mirrors the conversation unread badge style in Sidebar.jsx — a small
 * violet-strong pill with the count (clamped at 99+). Reads from
 * useLeavePendingCount, which polls /api/leave-requests/pending-count
 * (the backend returns 0 for non-approvers, so this is safe to mount
 * for every role).
 *
 * While the hook is loading we render the spinner ALONE — no count text —
 * so a loading badge never shows a misleading "0" (the UI smoke suite keys
 * off this: it waits for the spinner to clear before reading the count).
 */
export default function NotificationLeaveIcon({ showLabel = false }) {
  const { count, isLoading } = useLeavePendingCount();
  const display = count > 99 ? 99 : count;

  if (isLoading) {
    return (
      <span
        className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-[color:var(--ui-violet-strong)] text-white text-[10px] font-bold flex items-center justify-center shadow-lg shadow-[color:var(--ui-violet-strong)]/30"
        title="Loading pending leave requests…"
      >
        <span className="w-2 h-2 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </span>
    );
  }

  if (count === 0) return null;

  return (
    <span
      className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-[color:var(--ui-violet-strong)] text-white text-[10px] font-bold flex items-center justify-center shadow-lg shadow-[color:var(--ui-violet-strong)]/30"
      title={`${count} pending leave request${count === 1 ? '' : 's'}`}
    >
      <CalendarDays size={9} className="mr-0.5" />
      {showLabel ? 'leave' : display > 99 ? '99+' : display}
    </span>
  );
}
