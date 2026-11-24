import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, MessageSquare, Ticket } from 'lucide-react';
import ModalPortal from '../ModalPortal';
import ScrollArea from '../glass/ScrollArea';
import api from '../../utils/apiClient';
import toast from 'react-hot-toast';

export default function CreateConversationModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('standalone');
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [ticketId, setTicketId] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      const { ok, data } = await api.get('/api/users', { showToast: false });
      if (ok && Array.isArray(data)) {
        setUsers(data.filter(u => u.role === 'IT Admin' || u.isRoot));
      }
    };
    fetchUsers();
  }, []);

  // Tickets only matter for the ticket-linked type — fetched on first use so
  // the standalone path stays a one-request modal. The DB enforces
  // ticket-linked ⇒ ticket_id, so this picker is what makes the type creatable.
  useEffect(() => {
    if (type !== 'ticket-linked' || tickets.length) return;
    let cancelled = false;
    (async () => {
      const { ok, data } = await api.get('/api/tickets', { showToast: false });
      if (!cancelled && ok && Array.isArray(data)) setTickets(data);
    })();
    return () => { cancelled = true; };
  }, [type, tickets.length]);

  // Esc closes the modal (matches the workspace's global Esc handling — the
  // modal sits on top, so it wins by being the topmost layer).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    const { ok, data } = await api.post('/api/conversations', {
      title,
      type,
      ...(type === 'ticket-linked' ? { ticketId } : {}),
      participantIds: selectedUsers,
    });
    setLoading(false);

    if (ok && data) {
      onCreated(data);
    } else {
      toast.error('Failed to create conversation');
    }
  };

  const toggleUser = (userId) => {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-lg glass-card rounded-2xl overflow-hidden"
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 via-transparent to-white/3 pointer-events-none" />

          <div className="relative p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold tt flex items-center gap-2">
                <MessageSquare size={20} className="text-[color:var(--ui-violet)]" />
                New Conversation
              </h2>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 tt-muted hover:tt">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold tt-muted uppercase tracking-wider mb-2">Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setType('standalone')}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                      type === 'standalone'
                        ? 'bg-[color:var(--ui-violet-strong)]/15 border-[color:var(--ui-violet)]/30 text-[color:var(--ui-violet-hi)]'
                        : 'bg-white/5 border-white/10 tt-muted hover:bg-white/10'
                    }`}
                  >
                    <MessageSquare size={16} />
                    <span className="text-sm font-medium">Standalone</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('ticket-linked')}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                      type === 'ticket-linked'
                        ? 'bg-[color:var(--status-warning-strong)]/15 border-[color:var(--status-warning)]/30 text-[color:var(--status-warning-hi)]'
                        : 'bg-white/5 border-white/10 tt-muted hover:bg-white/10'
                    }`}
                  >
                    <Ticket size={16} />
                    <span className="text-sm font-medium">Ticket-Linked</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold tt-muted uppercase tracking-wider mb-2">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={type === 'ticket-linked' ? 'RE: Ticket title...' : 'Conversation title...'}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 tt placeholder-white/30 focus:outline-none focus:border-[color:var(--ui-violet)]/50 text-sm"
                  autoFocus
                />
              </div>

              {type === 'ticket-linked' && (
                <div>
                  <label className="block text-xs font-semibold tt-muted uppercase tracking-wider mb-2">Ticket</label>
                  <select
                    value={ticketId}
                    onChange={(e) => setTicketId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 tt text-sm focus:outline-none focus:border-[color:var(--ui-violet)]"
                  >
                    <option value="">— Choose a ticket —</option>
                    {tickets.map((t) => (
                      <option key={t.id} value={t.id}>Ticket #{t.id} — {t.title}</option>
                    ))}
                  </select>
                  {tickets.length === 0 && (
                    <p className="text-[11px] text-white/50 mt-1">No tickets available yet.</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold tt-muted uppercase tracking-wider mb-2">Participants</label>
                <ScrollArea contentClassName="max-h-48 space-y-1 rounded-xl bg-white/5 border border-white/15 p-2">
                  {users.map(u => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleUser(u.id)}
                      className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${
                        selectedUsers.includes(u.id)
                          ? 'bg-[color:var(--ui-violet-strong)]/15 border border-[color:var(--ui-violet)]/30'
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-[color:var(--ui-violet-strong)]/20 flex items-center justify-center text-xs font-bold text-[color:var(--ui-violet-hi)]">
                        {u.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium tt">{u.name}</p>
                        <p className="text-[10px] tt-muted">{u.role}</p>
                      </div>
                    </button>
                  ))}
                  {users.length === 0 && (
                    <p className="text-sm tt-muted text-center py-4">No admins available</p>
                  )}
                </ScrollArea>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 tt hover:bg-white/10 transition-all text-sm font-medium"
                >
                  Cancel
                </button>
                <motion.button
                  type="submit"
                  disabled={!title.trim() || loading || (type === 'ticket-linked' && !ticketId)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[color:var(--ui-violet-strong)]/20 border border-[color:var(--ui-violet)]/30 text-[color:var(--ui-violet-hi)] font-semibold hover:bg-[color:var(--ui-violet-strong)]/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {loading ? 'Creating...' : 'Create'}
                </motion.button>
              </div>
            </form>
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
