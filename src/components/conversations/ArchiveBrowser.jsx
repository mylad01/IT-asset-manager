// ArchiveBrowser.jsx — UI over the hard-move archive DB (root-only).
//
// Lists archived conversations (title, type, archived date + by whom, size),
// opens a read-only viewer with full history, and offers Restore /
// Delete-forever / Export actions. Also hosts the recycle-bin view
// ("Recently deleted") when includeDeleted is on.

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Archive, ArchiveRestore, Trash2, X, Search, ChevronLeft,
  Download, MessageSquare, Ticket, Clock, AlertTriangle,
} from 'lucide-react';
import api from '../../utils/apiClient';
import { getStoredToken } from '../../utils/appStorage';
import toast from 'react-hot-toast';
import ChatMessages from './ChatMessages';
import formatBytes from '../../utils/formatBytes';
import { getApiBaseUrl } from '../../utils/apiBase';

const BASE_URL = getApiBaseUrl();

export default function ArchiveBrowser({ onClose, onConversationRestored }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [selected, setSelected] = useState(null); // archived conversation detail
  const [confirmPurge, setConfirmPurge] = useState(null); // id awaiting typed confirm

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (showDeleted) params.set('includeDeleted', 'true');
    const { ok, data } = await api.get(`/api/conversations/archive?${params.toString()}`, { showToast: false });
    if (ok && data) setItems(data.conversations || []);
    setLoading(false);
  }, [search, showDeleted]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (conv) => {
    const { ok, data } = await api.get(`/api/conversations/archive/${conv.id}`, { showToast: false });
    if (ok && data) setSelected(data);
    else toast.error('Could not load archived conversation');
  };

  const handleRestore = async (id) => {
    const { ok, error } = await api.put(`/api/conversations/${id}/unarchive`, {});
    if (ok) {
      toast.success('Conversation restored');
      setSelected(null);
      load();
      onConversationRestored?.();
    } else {
      toast.error(error || 'Restore failed');
    }
  };

  const handlePurge = async () => {
    const id = confirmPurge;
    setConfirmPurge(null);
    const { ok, error } = await api.delete(`/api/conversations/archive/${id}`);
    if (ok) {
      toast.success('Permanently deleted');
      if (selected?.conversation?.id === id) setSelected(null);
      load();
    } else {
      toast.error(error || 'Delete failed');
    }
  };

  const handleExport = async (conv) => {
    try {
      const res = await fetch(`${BASE_URL}/api/conversations/${conv.id}/export?format=zip`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation-${conv.id}-export.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error('Export failed');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          {!selected && <Archive size={16} className="text-[color:var(--ui-violet)]" />}
          {selected && (
            <button onClick={() => setSelected(null)} className="p-1 rounded-lg hover:bg-white/10 tt-muted" aria-label="Back to archive list">
              <ChevronLeft size={16} />
            </button>
          )}
          <h3 className="font-bold tt text-sm">
            {selected ? selected.conversation.title : 'Conversation Archive'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] tt-muted cursor-pointer select-none">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} className="accent-[color:var(--ui-violet-strong)]" />
            Show deleted
          </label>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 tt-muted" aria-label="Close archive">
            <X size={15} />
          </button>
        </div>
      </div>

      {!selected && (
        <div className="px-4 py-2 border-b border-white/10">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search archived conversations…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 tt placeholder-white/30 focus:outline-none focus:border-[color:var(--ui-violet)]/50"
            />
          </div>
        </div>
      )}

      {/* List view */}
      {!selected && (
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-lg bg-white/5 animate-pulse" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Archive size={36} className="text-white/15 mb-3" />
              <p className="text-sm tt-muted">Archive is empty</p>
              <p className="text-[11px] tt-muted mt-1">Archived conversations appear here with full history</p>
            </div>
          ) : (
            <AnimatePresence>
              {items.map((conv) => {
                const deleted = !!conv.deleted_at;
                return (
                  <motion.div
                    key={conv.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-3 rounded-xl mb-1.5 border transition-colors cursor-pointer ${
                      deleted ? 'bg-[color:var(--status-danger-strong)]/5 border-[color:var(--status-danger)]/20' : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                    onClick={() => openDetail(conv)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg shrink-0 ${conv.type === 'ticket-linked' ? 'bg-[color:var(--status-warning-strong)]/15' : 'bg-[color:var(--ui-violet-strong)]/15'}`}>
                        {conv.type === 'ticket-linked' ? <Ticket size={14} className="text-[color:var(--status-warning)]" /> : <MessageSquare size={14} className="text-[color:var(--ui-violet)]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-semibold text-sm tt truncate ${deleted ? 'line-through opacity-70' : ''}`}>{conv.title}</p>
                          {deleted && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-[color:var(--status-danger-strong)]/15 text-[color:var(--status-danger)] text-[9px] font-bold flex items-center gap-1">
                              <Clock size={8} /> DELETED
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] tt-muted mt-0.5">
                          {conv.message_count} messages · {formatBytes(conv.attachments_size)}
                          {conv.archived_by_name ? ` · archived by ${conv.archived_by_name}` : ''}
                          {conv.archived_at ? ` · ${new Date(conv.archived_at).toLocaleDateString()}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleRestore(conv.id)}
                          className="p-1.5 rounded-lg hover:bg-[color:var(--status-success-strong)]/10 text-[color:var(--status-success)]"
                          title="Restore to active conversations"
                        >
                          <ArchiveRestore size={14} />
                        </button>
                        <button
                          onClick={() => handleExport(conv)}
                          className="p-1.5 rounded-lg hover:bg-white/10 tt-muted"
                          title="Export as ZIP with media"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmPurge(conv.id)}
                          className="p-1.5 rounded-lg hover:bg-[color:var(--status-danger-strong)]/10 text-[color:var(--status-danger)]"
                          title="Delete forever"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      )}

      {/* Detail (read-only) view */}
      {selected && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 py-1.5 bg-[color:var(--status-warning-strong)]/10 border-b border-[color:var(--status-warning)]/20 text-[11px] text-[color:var(--status-warning-hi)] flex items-center gap-2">
            <AlertTriangle size={11} />
            Archived {selected.conversation.archived_at ? `on ${new Date(selected.conversation.archived_at).toLocaleDateString()}` : ''}
            {selected.conversation.archived_by_name ? ` by ${selected.conversation.archived_by_name}` : ''} — read-only
          </div>
          <ChatMessages
            messages={selected.messages}
            loading={false}
            conversationId={selected.conversation.id}
            readOnly
          />
          <div className="flex gap-2 p-3 border-t border-white/10">
            <button
              onClick={() => handleRestore(selected.conversation.id)}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-[color:var(--status-success-strong)]/15 text-[color:var(--status-success-hi)] hover:bg-[color:var(--status-success-strong)]/25 text-sm font-semibold transition-colors"
            >
              <ArchiveRestore size={14} /> Restore
            </button>
            <button
              onClick={() => handleExport(selected.conversation)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 tt-muted hover:tt text-sm transition-colors"
            >
              <Download size={14} /> Export ZIP
            </button>
            <button
              onClick={() => setConfirmPurge(selected.conversation.id)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[color:var(--status-danger-strong)]/10 text-[color:var(--status-danger)] hover:bg-[color:var(--status-danger-strong)]/20 text-sm transition-colors"
            >
              <Trash2 size={14} /> Delete forever
            </button>
          </div>
        </div>
      )}

      {/* Typed-confirmation modal for permanent delete */}
      <AnimatePresence>
        {confirmPurge != null && (
          <PurgeConfirmModal
            onCancel={() => setConfirmPurge(null)}
            onConfirm={handlePurge}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PurgeConfirmModal({ onCancel, onConfirm }) {
  const [text, setText] = useState('');
  const REQUIRED = 'DELETE';
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div className="glass-card rounded-2xl p-5 max-w-sm w-full border border-[color:var(--status-danger)]/30" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="text-[color:var(--status-danger)]" size={18} />
          <h4 className="font-bold tt">Delete forever?</h4>
        </div>
        <p className="text-xs tt-muted mb-4">
          This permanently removes the conversation, all messages, and all attachment files from disk.
          This cannot be undone. Type <span className="font-bold text-[color:var(--status-danger-hi)]">{REQUIRED}</span> to confirm.
        </p>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={REQUIRED}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 tt text-sm mb-3 focus:outline-none focus:border-[color:var(--status-danger)]/50"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs tt-muted hover:tt">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={text !== REQUIRED}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[color:var(--status-danger-strong)]/20 text-[color:var(--status-danger-hi)] hover:bg-[color:var(--status-danger-strong)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete forever
          </button>
        </div>
      </div>
    </motion.div>
  );
}
