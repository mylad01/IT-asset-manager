import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { CalendarDays, Check, X, Clock, AlertTriangle, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/apiClient';
import GlassConfirmModal from '../components/glass/GlassConfirmModal';
import DateRangePicker from '../components/DateRangePicker';
import LeaveDetailModal from '../components/LeaveDetailModal';
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function dayCount(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  return Math.round((e - s) / 86400000) + 1;
}

const DECIDE_NOTE_MAX = 500;

export default function LeaveApprovals() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'IT Admin' || user?.isRoot;
  const isManager = user?.role === 'Department Manager';
  const canApprove = isAdmin || isManager;
  const location = useLocation();

  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'decided'
  const [pending, setPending] = useState([]);
  const [decided, setDecided] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [coverageDates, setCoverageDates] = useState({ start_date: '', end_date: '' });
  const [coverage, setCoverage] = useState([]);
  const [coverageLoading, setCoverageLoading] = useState(false);

  const [selectedRequest, setSelectedRequest] = useState(null);
  const [decideId, setDecideId] = useState(null);
  const [decideDecision, setDecideDecision] = useState(null);
  const [decideNote, setDecideNote] = useState('');
  const [deciding, setDeciding] = useState(false);
  // Separate approve target so clicking another row while the approve modal
  // is open cannot redirect the approve to the wrong request.
  const [approveTarget, setApproveTarget] = useState(null);

  // Fetch inbox (pending + decided) on mount and on role/user change.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetch = async () => {
      setIsLoading(true);
      setError('');
      try {
        const [pRes, dRes] = await Promise.all([
          api.get('/api/leave-requests/pending?view=pending', { showToast: false }),
          api.get('/api/leave-requests/pending?view=decided', { showToast: false }),
        ]);
        if (!cancelled) {
          if (pRes.ok) setPending(Array.isArray(pRes.data) ? pRes.data : []);
          else setPending([]);
          if (dRes.ok) setDecided(Array.isArray(dRes.data) ? dRes.data : []);
          else setDecided([]);
        }
        // Deep link ?req=<id> (spec §7.2): notifications link to
        // /leave-approvals?req=<id> — preselect the pending row's detail pane,
        // then strip the param so a reload doesn't reopen it. Read from the
        // ROUTER location, not window.location: in StrictMode dev the first
        // (cancelled) effect run would otherwise strip the param before the
        // second run reads it, and history.replaceState never notifies the
        // router anyway.
        const sp = new URLSearchParams(location.search);
        if (sp.has('req')) {
          const reqId = Number(sp.get('req'));
          if (!cancelled && reqId && pRes.ok && Array.isArray(pRes.data)) {
            const match = pRes.data.find(r => r.id === reqId);
            if (match) setSelectedRequest(match);
          }
          sp.delete('req');
          const qs = sp.toString();
          window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
        }
      } catch {
        if (!cancelled) { setPending([]); setDecided([]); setError('Failed to load the inbox.'); }
      }
      if (!cancelled) setIsLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [user, location.search]);

  const pendingLoading = isLoading && activeTab === 'pending';
  const decidedLoading = isLoading && activeTab === 'decided';

  // Coverage fetch — only when both dates are present and valid.
  useEffect(() => {
    if (!coverageDates.start_date || !coverageDates.end_date) {
      setCoverage([]);
      return;
    }
    if (coverageDates.end_date < coverageDates.start_date) {
      setCoverage([]);
      return;
    }
    let cancelled = false;
    setCoverageLoading(true);
    const params = new URLSearchParams();
    params.set('from', coverageDates.start_date);
    params.set('to', coverageDates.end_date);
    api.get(`/api/leave-requests/coverage?${params.toString()}`, { showToast: false })
      .then(({ ok, data }) => {
        if (!cancelled && ok && Array.isArray(data)) setCoverage(data);
        else if (!cancelled) setCoverage([]);
      })
      .catch(() => { if (!cancelled) setCoverage([]); })
      .finally(() => { if (!cancelled) setCoverageLoading(false); });
    return () => { cancelled = true; };
  }, [coverageDates.start_date, coverageDates.end_date]);

  const handleApprove = async (request, note = '') => {
    setDeciding(true);
    try {
      const { ok, error } = await api.put(`/api/leave-requests/${request.id}/decide`, {
        decision: 'Approved',
        decision_note: note || undefined,
      }, { showToast: false });
      if (!ok) throw new Error(error || 'Failed to approve.');
      // Refresh the inbox.
      const pRes = await api.get('/api/leave-requests/pending?view=pending', { showToast: false });
      const dRes = await api.get('/api/leave-requests/pending?view=decided', { showToast: false });
      setPending(pRes.ok && Array.isArray(pRes.data) ? pRes.data : []);
      setDecided(dRes.ok && Array.isArray(dRes.data) ? dRes.data : []);
      setSelectedRequest(null);
      // Close the approve confirm modal on success (handleDeny clears its own
      // state; without this the modal stayed open after a successful approve).
      setDecideId(null);
      setDecideDecision(null);
      setDecideNote('');
      setApproveTarget(null);
    } finally {
      setDeciding(false);
    }
  };

  const handleDeny = async () => {
    if (!decideId || !decideDecision) return;
    setDeciding(true);
    try {
      const { ok, error } = await api.put(`/api/leave-requests/${decideId}/decide`, {
        decision: decideDecision,
        decision_note: decideNote || undefined,
      }, { showToast: false });
      if (!ok) throw new Error(error || 'Failed to deny.');
      const pRes = await api.get('/api/leave-requests/pending?view=pending', { showToast: false });
      const dRes = await api.get('/api/leave-requests/pending?view=decided', { showToast: false });
      setPending(pRes.ok && Array.isArray(pRes.data) ? pRes.data : []);
      setDecided(dRes.ok && Array.isArray(dRes.data) ? dRes.data : []);
      setDecideId(null);
      setDecideDecision(null);
      setDecideNote('');
      setSelectedRequest(null);
    } finally {
      setDeciding(false);
    }
  };

  const openDecide = (request, decision) => {
    setDecideId(request.id);
    setDecideDecision(decision);
    setDecideNote('');
    setSelectedRequest(request);
    if (decision === 'Approved') setApproveTarget(request);
  };

  const pendingCount = pending.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-white/10 pb-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-[color:var(--status-warning-strong)]/30 to-[color:var(--status-info-strong)]/20">
          <CalendarDays size={28} className="text-[color:var(--status-warning)]" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tt text-glow">Leave Approvals</h1>
            {pendingCount > 0 && (
              <span className="glass-badge glass-badge-blue text-xs px-3 py-1">
                <Clock size={12} className="mr-1" />
                {pendingCount} pending
              </span>
            )}
          </div>
          <p className="tt-label mt-1 text-sm">
            {isAdmin ? 'Review and decide leave requests across all departments.' : 'Review and decide leave requests for your department.'}
          </p>
        </div>
      </div>

      {/* Coverage strip */}
      <div className="glass-card p-5 rounded-2xl border border-white/10">
        <div className="flex items-center gap-2 mb-3">
          <Eye size={14} className="text-[color:var(--ui-indigo)]" />
          <h2 className="text-sm font-bold tt uppercase tracking-wider">Availability Coverage</h2>
          <span className="text-[10px] tt-muted ml-auto">Overlapping approved + pending ranges</span>
        </div>
        <DateRangePicker
          value={coverageDates}
          onChange={setCoverageDates}
          label="Coverage window"
        />
        {coverageDates.start_date && coverageDates.end_date && coverageDates.end_date >= coverageDates.start_date && (
          <div className="mt-3 pt-3 border-t border-white/10">
            {coverageLoading ? (
              <div className="flex items-center gap-3 text-sm tt-muted">
                <span className="w-4 h-4 border-2 border-[color:var(--status-info)]/60 border-t-transparent rounded-full animate-spin" />
                Loading coverage…
              </div>
            ) : coverage.length === 0 ? (
              <div className="text-sm tt-muted italic">
                No overlapping leave ranges in this window.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] tt-muted uppercase font-bold">
                  {coverage.length} overlapping range{coverage.length === 1 ? '' : 's'} · {coverageDates.start_date} → {coverageDates.end_date}
                </div>
                {coverage.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 text-sm p-2 rounded-lg bg-white/[0.02] border border-white/10">
                    <div className={`shrink-0 w-2 h-2 rounded-full ${
                      r.status === 'Approved' ? 'bg-[color:var(--status-success)]' :
                      r.status === 'Pending' ? 'bg-[color:var(--status-info)]' :
                      'bg-[color:var(--status-danger)]'
                    }`} />
                    <span className="font-medium tt truncate">
                      {r.requester_name} — {formatDate(r.start_date)} → {formatDate(r.end_date)}
                    </span>
                    <span className="glass-badge text-[10px] shrink-0">{r.status}</span>
                    {r.department_name && (
                      <span className="text-[10px] tt-muted truncate">{r.department_name}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Inbox tabs */}
      <div className="flex items-center gap-1 border-b border-white/10">
        <button
          type="button"
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 cursor-pointer ${
            activeTab === 'pending'
              ? 'border-[color:var(--status-info-strong)] text-[color:var(--status-info)]'
              : 'border-transparent text-white/50 hover:text-white/80'
          }`}
        >
          Pending <span className="ml-2 glass-badge text-[10px] px-1.5 py-0.5">{pending.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('decided')}
          className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 cursor-pointer ${
            activeTab === 'decided'
              ? 'border-[color:var(--ui-violet-strong)] text-[color:var(--ui-violet)]'
              : 'border-transparent text-white/50 hover:text-white/80'
          }`}
        >
          Decided <span className="ml-2 glass-badge text-[10px] px-1.5 py-0.5 glass-badge-gray">{decided.length}</span>
        </button>
      </div>

      {/* List */}
      {(activeTab === 'pending' ? pendingLoading : decidedLoading) ? (
        <div className="glass-card p-12 text-center">
          <div className="w-8 h-8 border-2 border-[color:var(--status-info)]/60 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm tt-muted">Loading the inbox…</p>
        </div>
      ) : error && activeTab === 'pending' && pending.length === 0 ? (
        <div className="glass-card p-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-xl bg-[color:var(--status-danger-strong)]/20 text-[color:var(--status-danger)]">
              <AlertTriangle size={24} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold tt">Failed to load the inbox</h3>
              <p className="tt-label mt-2 text-sm">{error}</p>
            </div>
          </div>
        </div>
      ) : activeTab === 'pending' ? (
        pending.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <div className="w-14 h-14 rounded-full bg-[color:var(--status-success)]/10 flex items-center justify-center mx-auto mb-4">
              <Check size={28} className="text-[color:var(--status-success)]" />
            </div>
            <h3 className="text-lg font-bold tt mb-2">All caught up</h3>
            <p className="text-sm tt-label">No pending leave requests to review.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((request) => (
              <div
                key={request.id}
                className="glass-card p-4 rounded-2xl border border-white/10 hover:border-white/20 transition-all cursor-pointer"
                onClick={() => setSelectedRequest(request)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-xl bg-[color:var(--status-info)]/10 shrink-0">
                      <Clock size={16} className="text-[color:var(--status-info)]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold tt text-sm">
                          {request.requester_name || 'Unknown'}
                        </span>
                        <span className="glass-badge glass-badge-blue text-[10px]">Pending</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs tt-muted">
                        <span>{formatDate(request.start_date)} → {formatDate(request.end_date)}</span>
                        <span className="text-white/20">·</span>
                        <span>{dayCount(request.start_date, request.end_date)} day{dayCount(request.start_date, request.end_date) === 1 ? '' : 's'}</span>
                        {request.department_name && (
                          <>
                            <span className="text-white/20">·</span>
                            <span>{request.department_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canApprove && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openDecide(request, 'Approved'); }}
                          disabled={deciding}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[color:var(--status-success)]/20 text-[color:var(--status-success)] border border-[color:var(--status-success)]/30 hover:bg-[color:var(--status-success)]/30 transition-all cursor-pointer disabled:opacity-50"
                        >
                          <Check size={12} />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openDecide(request, 'Denied'); }}
                          disabled={deciding}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[color:var(--status-danger)]/20 text-[color:var(--status-danger)] border border-[color:var(--status-danger)]/30 hover:bg-[color:var(--status-danger)]/30 transition-all cursor-pointer disabled:opacity-50"
                        >
                          <X size={12} />
                          Deny
                        </button>
                      </>
                    )}
                    {!canApprove && (
                      <span className="text-[10px] tt-muted italic">Approvals require Department Manager or IT Admin</span>
                    )}
                  </div>
                </div>
                {request.description && (
                  <div className="mt-3 pl-9 text-sm tt-sec leading-relaxed line-clamp-2">
                    {request.description}
                  </div>
                )}
                <div className="mt-2 pl-9 flex items-center gap-3 text-[10px] tt-muted">
                  <span>Submitted {formatDate(request.created_at)}</span>
                  {request.submitted_by && (
                    <span className="tt-muted">· filed by {request.submitted_by}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : decided.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="w-14 h-14 rounded-full bg-[color:var(--ui-violet)]/10 flex items-center justify-center mx-auto mb-4">
            <Clock size={28} className="text-[color:var(--ui-violet)]" />
          </div>
          <h3 className="text-lg font-bold tt mb-2">No decisions yet</h3>
          <p className="text-sm tt-label">Decided leave requests will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {decided.map((request) => (
            <div
              key={request.id}
              className={`glass-card p-4 rounded-2xl border border-white/10 hover:border-white/20 transition-all cursor-pointer ${
                request.status === 'Approved' ? 'border-l-2 border-l-[color:var(--status-success-strong)]' :
                'border-l-2 border-l-[color:var(--status-danger-strong)]'
              }`}
              onClick={() => setSelectedRequest(request)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2 rounded-xl shrink-0 ${
                    request.status === 'Approved' ? 'bg-[color:var(--status-success)]/10' :
                    'bg-[color:var(--status-danger)]/10'
                  }`}>
                    {request.status === 'Approved' ? (
                      <Check size={16} className="text-[color:var(--status-success)]" />
                    ) : (
                      <X size={16} className="text-[color:var(--status-danger)]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold tt text-sm">{request.requester_name || 'Unknown'}</span>
                      <span className={`glass-badge text-[10px] ${
                        request.status === 'Approved' ? 'glass-badge-green' : 'glass-badge-red'
                      }`}>
                        {request.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs tt-muted">
                      <span>{formatDate(request.start_date)} → {formatDate(request.end_date)}</span>
                      {request.department_name && (
                        <>
                          <span className="text-white/20">·</span>
                          <span>{request.department_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {request.decided_at && (
                  <span className="text-[10px] tt-muted shrink-0">
                    Decided {formatDate(request.decided_at)}
                  </span>
                )}
              </div>
              {request.description && (
                <div className="mt-3 pl-9 text-sm tt-sec leading-relaxed line-clamp-2">
                  {request.description}
                </div>
              )}
              {request.decision_note && (
                <div className="mt-2 pl-9 p-2 rounded-lg bg-white/[0.02] border border-white/10 text-sm tt-muted italic">
                  {request.decision_note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      <LeaveDetailModal
        isOpen={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        request={selectedRequest}
      />

      {/* Deny confirm modal (uses the new GlassConfirmModal children slot for the note field) */}
      <GlassConfirmModal
        isOpen={!!decideId && decideDecision === 'Denied'}
        onClose={() => { setDecideId(null); setDecideDecision(null); setDecideNote(''); }}
        onConfirm={handleDeny}
        title="Deny this leave request?"
        confirmText="Deny Request"
        cancelText="Cancel"
        variant="danger"
        isLoading={deciding}
      >
        <div className="space-y-3">
          <p className="text-sm tt-sec leading-relaxed">
            Denying this request will notify the requester and the request will be recorded as denied.
          </p>
          <div>
            <label className="block text-[10px] font-bold tt-muted uppercase tracking-wider mb-1">
              Decision note <span className="text-[color:var(--status-danger)]">(optional)</span>
            </label>
            <textarea
              value={decideNote}
              onChange={(e) => setDecideNote(e.target.value.slice(0, DECIDE_NOTE_MAX))}
              placeholder="Optional context for the requester…"
              rows={3}
              className="glass-input resize-none w-full"
              maxLength={DECIDE_NOTE_MAX}
            />
            <p className="text-[10px] tt-muted mt-1 text-right">{decideNote.length}/{DECIDE_NOTE_MAX}</p>
          </div>
        </div>
      </GlassConfirmModal>

      {/* Approve confirm modal (lightweight — approve with optional note) */}
      <GlassConfirmModal
        isOpen={!!decideId && decideDecision === 'Approved'}
        onClose={() => { setDecideId(null); setDecideDecision(null); setDecideNote(''); setApproveTarget(null); }}
        onConfirm={async () => {
          await handleApprove(approveTarget, decideNote || '');
        }}
        title="Approve this leave request?"
        confirmText="Approve Request"
        cancelText="Cancel"
        variant="primary"
        isLoading={deciding}
      >
        <div className="space-y-3">
          <p className="text-sm tt-sec leading-relaxed">
            Approving this request will notify the requester and the request will be recorded as approved.
          </p>
          <div>
            <label className="block text-[10px] font-bold tt-muted uppercase tracking-wider mb-1">
              Decision note <span className="text-[color:var(--status-danger)]">(optional)</span>
            </label>
            <textarea
              value={decideNote}
              onChange={(e) => setDecideNote(e.target.value.slice(0, DECIDE_NOTE_MAX))}
              placeholder="Optional note for the requester…"
              rows={3}
              className="glass-input resize-none w-full"
              maxLength={DECIDE_NOTE_MAX}
            />
            <p className="text-[10px] tt-muted mt-1 text-right">{decideNote.length}/{DECIDE_NOTE_MAX}</p>
          </div>
        </div>
      </GlassConfirmModal>
    </div>
  );
}
