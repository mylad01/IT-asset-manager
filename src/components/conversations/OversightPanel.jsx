// OversightPanel.jsx — root-only system-wide conversation oversight.
//
// Table-style list of EVERY conversation (participant or not) with
// participant names, message/attachment counts, storage, activity. Opens a
// conversation read-only (with audit banner + Join button inside ChatPanel),
// supports filters, full-text search across all messages, and multi-select
// bulk archive/export (Phase 8).

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Shield, X, Search, MessageSquare, Ticket, Users,
  Archive, Download, Paperclip, CheckSquare, Square,
} from 'lucide-react';
import api from '../../utils/apiClient';
import { getStoredToken, getStoredUser } from '../../utils/appStorage';
import toast from 'react-hot-toast';
import ChatPanel from './ChatPanel';
import formatBytes from '../../utils/formatBytes';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export default function OversightPanel({ onClose, onRefreshSidebar }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selected, setSelected] = useState(null); // conversation opened for oversight
  const [selection, setSelection] = useState(new Set()); // bulk-select ids
  const [selectMode, setSelectMode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (typeFilter) params.set('type', typeFilter);
    const [{ ok, data }, sum] = await Promise.all([
      api.get(`/api/conversations/oversight?${params.toString()}`, { showToast: false }),
      api.get('/api/conversations/oversight/summary', { showToast: false }),
    ]);
    if (ok && data) setRows(data.conversations || []);
    if (sum?.ok && sum.data) setSummary(sum.data);
    setLoading(false);
  }, [search, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const openConversation = async (conv) => {
    // Explicit audit log entry for the oversight view.
    api.post(`/api/conversations/${conv.id}/oversight-view`, {}).catch(() => {});
    const { ok, data } = await api.get(`/api/conversations/${conv.id}`, { showToast: false });
    if (ok && data) setSelected(data);
    else toast.error('Could not open conversation');
  };

  const joinConversation = async (conv) => {
    const me = getStoredUser({});
    const res = await api.post(`/api/conversations/${conv.id}/participants`, { userIds: [me.id] }, { showToast: false });
    if (res.ok) {
      toast.success('You joined the conversation');
      setSelected(null);
      load();
      onRefreshSidebar?.();
    } else {
      toast.error(res.error || 'Could not join');
    }
  };

  const toggleSelect = (id) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const bulkArchive = async () => {
    const ids = [...selection];
    if (!ids.length) return;
    const { ok, data, error } = await api.post('/api/conversations/bulk/archive', { ids });
    if (ok) {
      toast.success(data?.message || `Archived ${ids.length}`);
      setSelection(new Set()); setSelectMode(false);
      load(); onRefreshSidebar?.();
    } else toast.error(error || 'Bulk archive failed');
  };

  const bulkExport = async () => {
    const ids = [...selection];
    if (!ids.length) return;
    try {
      const res = await fetch(`${BASE_URL}/api/conversations/bulk/export`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getStoredToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversations-export-${Date.now()}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error('Bulk export failed');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-[color:var(--status-warning)]" />
          <h3 className="font-bold tt text-sm">Oversight — all conversations</h3>
          {summary && (
            <span className="text-[10px] tt-muted ml-2">
              {summary.total_conversations} convs · {summary.total_messages} msgs · {formatBytes(summary.attachments_bytes)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelectMode(!selectMode); setSelection(new Set()); }}
            className={`p-1.5 rounded-lg transition-colors ${selectMode ? 'bg-[color:var(--ui-violet-strong)]/20 text-[color:var(--ui-violet-hi)]' : 'hover:bg-white/10 tt-muted'}`}
            title="Select mode"
          >
            <CheckSquare size={15} />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 tt-muted" aria-label="Close oversight">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Filters */}
      {!selected && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search all messages and titles…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 tt placeholder-white/30 focus:outline-none focus:border-[color:var(--ui-violet)]/50"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 tt focus:outline-none"
          >
            <option value="">All types</option>
            <option value="standalone">Standalone</option>
            <option value="ticket-linked">Ticket-linked</option>
          </select>
        </div>
      )}

      {/* Bulk action bar */}
      {selectMode && selection.size > 0 && !selected && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[color:var(--ui-violet-strong)]/10 border-b border-[color:var(--ui-violet)]/20">
          <span className="text-xs tt-sec">{selection.size} selected</span>
          <button onClick={bulkArchive} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs tt hover:bg-white/10">
            <Archive size={12} /> Archive
          </button>
          <button onClick={bulkExport} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs tt hover:bg-white/10">
            <Download size={12} /> Export ZIP
          </button>
        </div>
      )}

      {/* Detail view */}
      {selected ? (
        <div className="flex-1 flex flex-col min-h-0">
          <ChatPanel
            conversation={selected}
            oversight
            onJoin={() => joinConversation(selected)}
            onRefresh={load}
          />
          <div className="flex justify-end p-2 border-t border-white/10">
            <button onClick={() => setSelected(null)} className="px-3 py-1.5 rounded-lg text-xs tt-muted hover:tt bg-white/5 border border-white/10">
              Back to oversight list
            </button>
          </div>
        </div>
      ) : (
        /* Table view */
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-2 p-3">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-12 rounded-lg bg-white/5 animate-pulse" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Shield size={36} className="text-white/15 mb-3" />
              <p className="text-sm tt-muted">No conversations found</p>
            </div>
          ) : (
            <div className="p-2">
              {rows.map((conv) => (
                <motion.div
                  key={conv.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`flex items-center gap-3 p-3 rounded-xl mb-1.5 border transition-colors cursor-pointer ${
                    selection.has(conv.id) ? 'bg-[color:var(--ui-violet-strong)]/10 border-[color:var(--ui-violet)]/30' : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                  onClick={() => (selectMode ? toggleSelect(conv.id) : openConversation(conv))}
                >
                  {selectMode && (
                    <div className="shrink-0" onClick={(e) => { e.stopPropagation(); toggleSelect(conv.id); }}>
                      {selection.has(conv.id) ? <CheckSquare size={15} className="text-[color:var(--ui-violet-hi)]" /> : <Square size={15} className="tt-muted" />}
                    </div>
                  )}
                  <div className={`p-2 rounded-lg shrink-0 ${conv.type === 'ticket-linked' ? 'bg-[color:var(--status-warning-strong)]/15' : 'bg-[color:var(--ui-violet-strong)]/15'}`}>
                    {conv.type === 'ticket-linked' ? <Ticket size={13} className="text-[color:var(--status-warning)]" /> : <MessageSquare size={13} className="text-[color:var(--ui-violet)]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm tt truncate">{conv.title}</p>
                      {conv.ticket_id ? <span className="text-[9px] tt-muted">#{conv.ticket_id}</span> : null}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] tt-muted mt-0.5">
                      <span className="flex items-center gap-1"><Users size={9} /> {conv.participant_count}</span>
                      <span className="flex items-center gap-1"><MessageSquare size={9} /> {conv.message_count}</span>
                      {conv.attachment_count > 0 && (
                        <span className="flex items-center gap-1"><Paperclip size={9} /> {conv.attachment_count} ({formatBytes(conv.attachments_bytes)})</span>
                      )}
                      <span className="truncate max-w-[180px]">{conv.participant_names || '—'}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] tt-muted">
                      {conv.last_activity_at ? new Date(conv.last_activity_at).toLocaleDateString() : 'No activity'}
                    </p>
                    <p className="text-[10px] tt-muted">{formatBytes(conv.attachments_bytes)}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
