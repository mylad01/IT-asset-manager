import React, { useState, useEffect, useMemo } from 'react';
import { CalendarDays, Plus, UserPlus, Clock, FileStack, ChevronRight, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/apiClient';
import LeaveDetailModal from '../components/LeaveDetailModal';
import LeaveSubmitModal from '../components/LeaveSubmitModal';

function DescriptionSnippet(text, max = 120) {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length <= max) return <span className="text-sm tt-sec leading-relaxed">{trimmed}</span>;
  return <span className="text-sm tt-sec leading-relaxed">{trimmed.slice(0, max)}…</span>;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MyLeave() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailRequest, setDetailRequest] = useState(null);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitMode, setSubmitMode] = useState('self'); // 'self' | 'on-behalf'

  const isAdmin = user?.role === 'IT Admin' || user?.isRoot;
  const isManager = user?.role === 'Department Manager';

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const fetch = async () => {
      setIsLoading(true);
      setError('');
      const { ok, data, error } = await api.get('/api/leave-requests/mine');
      if (ok && Array.isArray(data)) {
        if (!cancelled) setRequests(data);
      } else {
        if (!cancelled) { setRequests([]); setError(error || 'Failed to load your leave requests'); }
      }
      if (!cancelled) setIsLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [user]);

  const handleRefresh = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    setError('');
    const { ok, data, error } = await api.get('/api/leave-requests/mine');
    if (ok && Array.isArray(data)) setRequests(data);
    else { setRequests([]); setError(error || 'Failed to load'); }
    setIsLoading(false);
  };

  const openDetail = async (request) => {
    if (!request) return;
    // The list endpoint returns the bare row (no JOIN names). Fetch the full
    // detail for the modal so the requester/department/decision fields render.
    const { ok, data } = await api.get(`/api/leave-requests/${request.id}`);
    if (ok && data) {
      setDetailRequest(data);
      // Brief delay so the modal mount isn't racing the close.
      requestAnimationFrame(() => setDetailRequest(data));
    }
  };

  const statusCounts = useMemo(() => {
    const counts = { Pending: 0, Approved: 0, Denied: 0 };
    for (const r of requests) {
      if (counts[r.status] != null) counts[r.status]++;
    }
    return counts;
  }, [requests]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-white/10 pb-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-[color:var(--status-info-strong)]/30 to-[color:var(--ui-purple-strong)]/20">
          <CalendarDays size={28} className="text-[color:var(--status-info)]" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tt text-glow">My Leave</h1>
          <p className="tt-label mt-1 text-sm">Your leave requests and approvals history.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setSubmitMode('on-behalf'); setSubmitOpen(true); }}
            disabled={!isAdmin}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border border-white/10 bg-white/[0.03] hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <UserPlus size={14} />
            On Behalf
          </button>
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            disabled={isManager}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[color:var(--status-info)]/20 text-[color:var(--status-info)] border border-[color:var(--status-info)]/30 hover:bg-[color:var(--status-info)]/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            New Request
          </button>
        </div>
      </div>

      {/* Manager view-only info note (spec §7.1: form replaced by the note) */}
      {isManager && (
        <div className="glass-card p-4 rounded-2xl border border-white/10 flex items-start gap-3" data-testid="manager-note">
          <div className="p-2 rounded-xl bg-[color:var(--status-info)]/10 shrink-0">
            <CalendarDays size={16} className="text-[color:var(--status-info)]" />
          </div>
          <div className="flex-1">
            <p className="text-sm tt-sec leading-relaxed">
              Requests are filed by your administrator on your behalf. Contact your IT Admin to submit or amend leave for you.
            </p>
          </div>
        </div>
      )}

      {/* Status summary chips */}
      <div className="flex items-center gap-2 text-xs">
        <span className="tt-muted uppercase font-bold">Summary</span>
        <span className={`glass-badge ${statusCounts.Pending > 0 ? 'glass-badge-amber' : 'glass-badge-gray'}`}>
          <Clock size={10} className="mr-1" />
          Pending {statusCounts.Pending}
        </span>
        <span className={`glass-badge ${statusCounts.Approved > 0 ? 'glass-badge-green' : 'glass-badge-gray'}`}>
          Approved {statusCounts.Approved}
        </span>
        <span className={`glass-badge ${statusCounts.Denied > 0 ? 'glass-badge-red' : 'glass-badge-gray'}`}>
          Denied {statusCounts.Denied}
        </span>
        <span className="tt-muted ml-auto">{requests.length} total</span>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="glass-card p-12 text-center">
          <div className="w-8 h-8 border-2 border-[color:var(--status-info)]/60 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm tt-muted">Loading your leave requests…</p>
        </div>
      ) : error ? (
        <div className="glass-card p-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-xl bg-[color:var(--status-danger-strong)]/20 text-[color:var(--status-danger)]">
              <Clock size={24} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold tt">Failed to load leave requests</h3>
              <p className="tt-label mt-2 text-sm">{error}</p>
              <button
                type="button"
                onClick={handleRefresh}
                className="glass-btn glass-btn-primary mt-4 text-xs px-4 py-2"
              >
                <RotateCcw size={14} className="mr-1" />
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : requests.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="w-14 h-14 rounded-full bg-[color:var(--status-info)]/10 flex items-center justify-center mx-auto mb-4">
            <CalendarDays size={28} className="text-[color:var(--status-info)]" />
          </div>
          <h3 className="text-lg font-bold tt mb-2">No leave requests yet</h3>
          <p className="text-sm tt-label mb-6">Submit your first leave request to see it here.</p>
          {!isManager && (
            <button
              type="button"
              onClick={() => setSubmitOpen(true)}
              className="glass-btn glass-btn-primary px-5 py-2 text-xs"
            >
              <Plus size={14} className="mr-1" />
              New Leave Request
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((request) => (
            <div
              key={request.id}
              className={`glass-card p-4 rounded-2xl border border-white/10 hover:border-white/20 transition-all cursor-pointer group ${
                request.status === 'Pending' ? 'border-l-2 border-l-[color:var(--status-info-strong)]' :
                request.status === 'Approved' ? 'border-l-2 border-l-[color:var(--status-success-strong)]' :
                'border-l-2 border-l-[color:var(--status-danger-strong)]'
              }`}
              onClick={() => openDetail(request)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2 rounded-xl shrink-0 ${
                    request.status === 'Approved' ? 'bg-[color:var(--status-success)]/10' :
                    request.status === 'Denied' ? 'bg-[color:var(--status-danger)]/10' :
                    'bg-[color:var(--status-info)]/10'
                  }`}>
                    <Clock size={16} className={
                      request.status === 'Approved' ? 'text-[color:var(--status-success)]' :
                      request.status === 'Denied' ? 'text-[color:var(--status-danger)]' :
                      'text-[color:var(--status-info)]'
                    } />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold tt text-sm">
                        {formatDate(request.start_date)} — {formatDate(request.end_date)}
                      </span>
                      <span className={`glass-badge text-[10px] ${request.status === 'Approved' ? 'glass-badge-green' : request.status === 'Denied' ? 'glass-badge-red' : 'glass-badge-amber'}`}>
                        {request.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs tt-muted">#{request.id}</span>
                      {request.dept_name && (
                        <span className="text-xs tt-muted">· {request.dept_name}</span>
                      )}
                      {request.attachments && request.attachments.length > 0 && (
                        <span className="text-xs tt-muted flex items-center gap-1">
                          <FileStack size={10} />
                          {request.attachments.length} attachment{request.attachments.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight size={16} className="text-white/30 group-hover:text-white/60 transition-colors shrink-0 mt-1" />
              </div>
              {request.description && (
                <div className="mt-3 pl-9">
                  {DescriptionSnippet(request.description)}
                </div>
              )}
              <div className="mt-2 pl-9 flex items-center gap-3 text-[10px] tt-muted">
                <span>Submitted {formatDate(request.created_at)}</span>
                {request.submitted_by && request.submitted_by !== user?.id && (
                  <span className="tt-muted">· by {request.submitted_by}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      <LeaveDetailModal
        isOpen={!!detailRequest}
        onClose={() => setDetailRequest(null)}
        request={detailRequest}
      />

      {/* Submit modal (self or on-behalf) */}
      <LeaveSubmitModal
        isOpen={submitOpen}
        onClose={() => { setSubmitOpen(false); setSubmitMode('self'); }}
        onSubmitted={handleRefresh}
        mode={submitMode}
      />
    </div>
  );
}
