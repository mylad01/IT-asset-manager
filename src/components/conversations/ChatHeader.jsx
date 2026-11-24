import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Archive, ArchiveRestore, Trash2, Users, Link, MoreVertical } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/apiClient';
import toast from 'react-hot-toast';

export default function ChatHeader({ conversation, participants, onRefresh }) {
  const { user } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);

  const handleArchive = async () => {
    const endpoint = conversation.is_archived
      ? `/api/conversations/${conversation.id}/unarchive`
      : `/api/conversations/${conversation.id}/archive`;
    const { ok } = await api.put(endpoint, {});
    if (ok) {
      toast.success(conversation.is_archived ? 'Conversation restored' : 'Conversation archived');
      onRefresh?.();
    }
    setShowMenu(false);
  };

  const handleDelete = async () => {
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    const { ok } = await api.delete(`/api/conversations/${conversation.id}`);
    if (ok) {
      toast.success('Conversation deleted');
      onRefresh?.();
    }
    setShowMenu(false);
  };

  return (
    <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-white/5">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold tt truncate">{conversation.title}</h3>
            {conversation.type === 'ticket-linked' && (
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-[color:var(--status-warning-strong)]/15 text-[color:var(--status-warning)] text-[10px] font-semibold flex items-center gap-1">
                <Link size={10} />
                Ticket
              </span>
            )}
            {/* Ternary, not `&&`: is_archived arrives as 0/1 from SQLite and
                React renders a numeric 0 literally — `{0 && x}` shows "0". */}
            {conversation.is_archived ? (
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-white/10 text-white/50 text-[10px] font-semibold">
                Archived
              </span>
            ) : null}
          </div>
          <p className="text-xs tt-muted mt-0.5">
            {participants.length} participant{participants.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowParticipants(!showParticipants)}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors tt-muted hover:tt"
        >
          <Users size={16} />
        </motion.button>

        <div className="relative">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors tt-muted hover:tt"
          >
            <MoreVertical size={16} />
          </motion.button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute right-0 top-full mt-1 w-48 rounded-xl glass-card border border-white/15 shadow-xl z-50 overflow-hidden"
              >
                <button
                  onClick={handleArchive}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm tt hover:bg-white/10 transition-colors"
                >
                  {conversation.is_archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  {conversation.is_archived ? 'Restore' : 'Archive'}
                </button>
                {user?.isRoot && (
                  <button
                    onClick={handleDelete}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[color:var(--status-danger)] hover:bg-[color:var(--status-danger-strong)]/10 transition-colors"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                )}
              </motion.div>
            </>
          )}
        </div>
      </div>

      {showParticipants && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowParticipants(false)} />
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute right-0 top-full mt-1 w-64 rounded-xl glass-card border border-white/15 shadow-xl z-50 p-3"
          >
            <h4 className="text-xs font-semibold tt-muted uppercase tracking-wider mb-2">Participants</h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {participants.map(p => (
                <div key={p.user_id} className="flex items-center gap-2 p-2 rounded-lg bg-white/5">
                  <div className="w-8 h-8 rounded-full bg-[color:var(--ui-violet-strong)]/20 flex items-center justify-center text-xs font-bold text-[color:var(--ui-violet-hi)]">
                    {p.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium tt truncate">{p.name}</p>
                    <p className="text-[10px] tt-muted">{p.role === 'admin' ? 'Admin' : 'Member'}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}
