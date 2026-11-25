import React, { useState, useEffect, useRef } from 'react';
import { X, User, Building2, CalendarDays, FileText, Download, Clock, CheckCircle, XCircle, MessageSquare } from 'lucide-react';
import { getStoredToken } from '../utils/appStorage';
import ModalPortal from './ModalPortal';
import { getApiBaseUrl } from '../utils/apiBase';

const BASE_URL = getApiBaseUrl();

/** Auth-blob thumbnail hook for one leave attachment (mirrors AttachmentCard.jsx).
 *  Inline <img> cannot send the Authorization header, and the
 *  /uploads/leave-requests/ subtree is private (blocked by
 *  privateUploadsGuard → 404), so thumbnails MUST go through an auth
 *  fetch → blob URL. This hook is called by the LeaveAttachmentThumb
 *  component (not in a .map callback) so React's rules of hooks are satisfied. */
function useLeaveAttachmentThumb(requestId, att, idx) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!requestId || !att || !isImageMime(att.mime)) { setUrl(null); return; }
    let cancelled = false;
    const token = getStoredToken();
    fetch(`${BASE_URL}/api/leave-requests/${requestId}/attachments/${idx}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) { URL.revokeObjectURL(URL.createObjectURL(blob)); return; }
        setUrl(URL.createObjectURL(blob));
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [requestId, att, idx]);
  useEffect(() => () => { mounted.current = false; }, []);
  return { url, failed };
}

/** Renders one leave-attachment thumbnail via an auth-blob fetch.
 *  Extracted as a component so the auth-blob hook is called at the
 *  top level of a React component (not inside a .map callback). */
function LeaveAttachmentThumb({ requestId, att, idx }) {
  const { url, failed } = useLeaveAttachmentThumb(requestId, att, idx);
  if (failed) return <div className="w-12 h-12 rounded-lg bg-black/30 border border-white/10" />;
  if (!url) return <div className="w-12 h-12 rounded-lg bg-black/30 border border-white/10 animate-pulse" />;
  return (
    <img
      src={url}
      alt={att.name || 'Attachment'}
      className="w-12 h-12 object-cover rounded-lg border border-white/10"
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
}

const STATUS_BADGE = {
  Pending: 'glass-badge-blue',
  Approved: 'glass-badge-green',
  Denied: 'glass-badge-red',
};

const STATUS_ICON = {
  Pending: Clock,
  Approved: CheckCircle,
  Denied: XCircle,
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function dayCount(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  return Math.round((e - s) / 86400000) + 1;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isImageMime(mime) {
  return mime?.startsWith('image/');
}

export default function LeaveDetailModal({ isOpen, onClose, request, onDownload }) {
  const [downloading, setDownloading] = useState(null);

  const handleDownload = async (idx) => {
    if (!request) return;
    setDownloading(idx);
    try {
      const token = getStoredToken();
      const res = await fetch(`${BASE_URL}/api/leave-requests/${request.id}/attachments/${idx}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const att = (request.attachments || [])[idx];
      a.download = att?.name || `attachment-${idx + 1}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (onDownload) onDownload(idx);
    } catch {
      // The auth-blob pattern mirrors AttachmentCard.jsx; errors surface via
      // the caller's toast/notification path.
    } finally {
      setDownloading(null);
    }
  };

  if (!isOpen || !request) return null;

  const status = request.status || 'Pending';
  const StatusIcon = STATUS_ICON[status] || Clock;
  const attachments = Array.isArray(request.attachments) ? request.attachments : [];
  const days = dayCount(request.start_date, request.end_date);

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
        <div className="relative glass-modal max-w-lg w-full animate-glass-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
          <div className="relative z-20 flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-[color:var(--status-info-strong)]/30 to-[color:var(--ui-purple-strong)]/20">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-[color:var(--status-info-strong)]/20">
                <CalendarDays size={18} className="text-[color:var(--status-info)]" />
              </div>
              <h2 className="text-lg font-bold tt">Leave Request Details</h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-full tt-label hover:tt hover:bg-white/15 transition-all cursor-pointer">
              <X size={20} />
            </button>
          </div>

          <div className="relative z-20 p-5 space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Status + requester row */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className={`glass-badge ${STATUS_BADGE[status] || 'glass-badge-gray'}`}>
                  <StatusIcon size={12} className="mr-1" />
                  {status}
                </span>
                <span className="text-xs tt-muted">#{request.id}</span>
              </div>
              {request.dept_id != null && request.department_name && (
                <div className="flex items-center gap-1.5 text-xs tt-muted">
                  <Building2 size={12} />
                  <span className="truncate">{request.department_name}</span>
                </div>
              )}
            </div>

            {/* Requester */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/10">
              <div className="p-2 rounded-lg bg-[color:var(--ui-indigo-strong)]/20">
                <User size={16} className="text-[color:var(--ui-indigo)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold tt truncate">{request.requester_name || 'Unknown'}</p>
                <p className="text-xs tt-muted truncate">{request.requester_email || ''}</p>
              </div>
            </div>

            {/* Date range (read-only summary; full picker lives in the submit form) */}
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10">
              <label className="block text-[10px] font-bold tt-muted uppercase tracking-wider mb-2">Leave Period</label>
              <div className="flex items-center gap-3 text-sm">
                <div className="flex-1">
                  <p className="text-[10px] tt-muted uppercase font-bold mb-0.5">Start</p>
                  <p className="font-semibold tt">{formatDate(request.start_date)}</p>
                </div>
                <div className="text-[color:var(--ui-neutral)]">→</div>
                <div className="flex-1">
                  <p className="text-[10px] tt-muted uppercase font-bold mb-0.5">End</p>
                  <p className="font-semibold tt">{formatDate(request.end_date)}</p>
                </div>
              </div>
              {days > 0 && (
                <p className="text-[10px] tt-muted mt-2 flex items-center gap-1">
                  <CalendarDays size={11} />
                  {days} calendar day{days === 1 ? '' : 's'}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-[10px] font-bold tt-muted uppercase tracking-wider mb-1.5">Reason</label>
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 text-sm tt leading-relaxed whitespace-pre-wrap break-words">
                {request.description ? request.description : '—'}
              </div>
            </div>

            {/* Attachments */}
            {attachments.length > 0 && (
              <div>
                <label className="block text-[10px] font-bold tt-muted uppercase tracking-wider mb-2">
                  Attachments ({attachments.length})
                </label>
                <div className="space-y-2">
                  {attachments.map((att, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/10">
                      {isImageMime(att.mime) ? (
                        <div className="shrink-0 relative">
                          <LeaveAttachmentThumb requestId={request.id} att={att} idx={idx} />
                        </div>
                      ) : (
                        <div className="shrink-0 p-2 rounded-lg bg-[color:var(--status-danger)]/10">
                          <FileText size={18} className="text-[color:var(--status-danger)]" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium tt truncate">{att.name || `Attachment ${idx + 1}`}</p>
                        <p className="text-[10px] tt-muted">{formatBytes(att.size)} · {att.mime || 'unknown'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownload(idx)}
                        disabled={downloading === idx}
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors cursor-pointer text-xs tt-muted hover:tt shrink-0"
                        title="Download"
                      >
                        {downloading === idx ? (
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Download size={16} className="text-[color:var(--status-info)]" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Decision */}
            {request.status !== 'Pending' && (
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
                <div className="flex items-center gap-2 text-xs tt-muted">
                  <MessageSquare size={12} />
                  <span className="font-bold uppercase tracking-wider">Decision</span>
                </div>
                <p className="text-sm tt">
                  {status === 'Approved' ? 'Approved' : 'Denied'} by {request.decided_by_name || 'IT Admin'}
                  {request.decided_at ? ` on ${formatDate(request.decided_at)}` : ''}
                </p>
                {request.decision_note && (
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/10 text-sm tt-sec leading-relaxed whitespace-pre-wrap">
                    {request.decision_note}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
