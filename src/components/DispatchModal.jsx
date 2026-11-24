import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, ShieldCheck, AlertCircle, CheckCircle2, Loader2, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/apiClient';
import { formatId } from '../utils/formatId';
import ModalPortal from './ModalPortal';

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.9, y: 30 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', damping: 25, stiffness: 350 },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: { duration: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -15 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: { delay: 0.08 * i, type: 'spring', damping: 20, stiffness: 300 },
  }),
};

const successVariants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', damping: 12, stiffness: 200 },
  },
};

export default function DispatchModal({ isOpen, ticket, onClose, onDispatched }) {
  const [admins, setAdmins] = useState([]);
  const [selectedAdminId, setSelectedAdminId] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatched, setDispatched] = useState(false);
  const [error, setError] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    if (!isOpen) return;
    setSelectedAdminId('');
    setDispatched(false);
    setError('');
    api.get('/api/users/admins', { showToast: false }).then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setAdmins(data.filter(a => a.id !== user?.id));
    });
  }, [isOpen, user]);

  const handleDispatch = async () => {
    if (!selectedAdminId) { setError('Please select an admin.'); return; }
    setError('');
    setIsDispatching(true);
    const { ok, error: err } = await api.put(`/api/tickets/${ticket.id}/assign`, { assigned_admin_id: selectedAdminId });
    setIsDispatching(false);
    if (ok) {
      setDispatched(true);
      setTimeout(() => { onDispatched?.(); onClose(); }, 1200);
    } else {
      setError(err || 'Failed to dispatch ticket.');
    }
  };

  if (!isOpen || !ticket) return null;

  const selectedAdmin = admins.find(a => String(a.id) === String(selectedAdminId));

  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-lg" />
            <motion.div
              className="relative glass-modal max-w-lg w-full overflow-hidden"
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />

              <div className="relative z-20 flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-[color:var(--ui-violet-strong)]/30 to-[color:var(--ui-indigo-strong)]/20">
                <div className="flex items-center gap-3">
                  <motion.div
                    className="p-2 rounded-xl bg-[color:var(--ui-violet-strong)]/25"
                    initial={{ rotate: -15 }}
                    animate={{ rotate: 0 }}
                    transition={{ type: 'spring', damping: 10, stiffness: 200 }}
                  >
                    <Send size={20} className="text-[color:var(--ui-violet-hi)]" />
                  </motion.div>
                  <div>
                    <h2 className="text-lg font-bold tt">Dispatch Ticket</h2>
                    <p className="tt-label text-sm mt-0.5">{formatId(ticket.id)}</p>
                  </div>
                </div>
                <motion.button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-full tt-label hover:tt hover:bg-white/15 transition-all cursor-pointer"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <X size={20} />
                </motion.button>
              </div>

              <div className="relative z-20 p-6 space-y-5">
                <AnimatePresence mode="wait">
                  {dispatched ? (
                    <motion.div
                      key="success"
                      className="flex flex-col items-center py-8 gap-4"
                      variants={successVariants}
                      initial="hidden"
                      animate="visible"
                    >
                      <motion.div
                        className="p-4 rounded-full bg-[color:var(--status-success-strong)]/20"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', damping: 10, stiffness: 150, delay: 0.1 }}
                      >
                        <CheckCircle2 size={48} className="text-[color:var(--status-success)]" />
                      </motion.div>
                      <div className="text-center">
                        <p className="text-lg font-bold tt">Dispatched!</p>
                        <p className="text-sm tt-muted mt-1">
                          Ticket assigned to <span className="text-[color:var(--ui-violet-hi)] font-semibold">{selectedAdmin?.name}</span>
                        </p>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <motion.div
                        className="glass-card p-4 space-y-3"
                        custom={0}
                        variants={itemVariants}
                        initial="hidden"
                        animate="visible"
                      >
                        <div className="flex items-center gap-2 text-[10px] font-bold tt-muted uppercase tracking-widest">
                          <AlertCircle size={12} /> Ticket Summary
                        </div>
                        <p className="font-bold tt text-sm">{ticket.title}</p>
                        <div className="flex gap-2">
                          <span className="glass-badge glass-badge-blue text-[10px]">{ticket.category || 'General'}</span>
                          <span className={`glass-badge text-[10px] ${ticket.priority === 'Critical' ? 'glass-badge-red' : 'glass-badge-gray'}`}>{ticket.priority || 'Medium'}</span>
                          <span className="glass-badge glass-badge-purple text-[10px]">By: {ticket.user_name || 'Staff'}</span>
                        </div>
                      </motion.div>

                      <motion.div
                        className="space-y-2 mt-4"
                        custom={1}
                        variants={itemVariants}
                        initial="hidden"
                        animate="visible"
                      >
                        <label className="block text-xs font-bold tt-label uppercase tracking-wider">
                          Assign to Admin <span className="text-[color:var(--status-danger)]">*</span>
                        </label>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--ui-violet)]">
                            <ShieldCheck size={16} />
                          </div>
                          <select
                            value={selectedAdminId}
                            onChange={(e) => { setSelectedAdminId(e.target.value); setError(''); }}
                            className="glass-select pl-10 w-full"
                          >
                            <option value="">Select an admin...</option>
                            {admins.map(admin => (
                              <option key={admin.id} value={admin.id}>{admin.name}</option>
                            ))}
                          </select>
                        </div>
                      </motion.div>

                      {selectedAdminId && (
                        <motion.div
                          className="glass-card p-3 flex items-center gap-3 bg-[color:var(--ui-violet-strong)]/10 border-[color:var(--ui-violet)]/20"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                        >
                          <div className="p-2 rounded-full bg-[color:var(--ui-violet-strong)]/20">
                            <UserCheck size={16} className="text-[color:var(--ui-violet-hi)]" />
                          </div>
                          <div>
                            <p className="text-sm font-bold tt">{selectedAdmin?.name}</p>
                            <p className="text-[10px] tt-muted">Will receive this ticket in their queue</p>
                          </div>
                        </motion.div>
                      )}

                      {error && (
                        <motion.div
                          className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold border flex items-start gap-2"
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <AlertCircle size={16} className="shrink-0 mt-0.5" />
                          <span>{error}</span>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {!dispatched && (
                <motion.div
                  className="relative z-20 p-4 border-t border-white/10 flex justify-end gap-3 bg-white/5"
                  custom={2}
                  variants={itemVariants}
                  initial="hidden"
                  animate="visible"
                >
                  <motion.button
                    type="button"
                    onClick={onClose}
                    className="glass-btn px-4 py-2 text-xs"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    type="button"
                    onClick={handleDispatch}
                    disabled={isDispatching || !selectedAdminId}
                    className="glass-btn glass-btn-indigo px-5 py-2 text-xs disabled:opacity-50 cursor-pointer flex items-center gap-2"
                    whileHover={{ scale: selectedAdminId ? 1.03 : 1 }}
                    whileTap={{ scale: selectedAdminId ? 0.97 : 1 }}
                  >
                    {isDispatching ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Dispatching...
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        Dispatch
                      </>
                    )}
                  </motion.button>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
