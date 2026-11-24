import React, { useState, useEffect } from 'react';
import SearchableSelect from './SearchableSelect';
import { ArrowRightLeft, ShieldAlert } from 'lucide-react';
import api from '../utils/apiClient';
import ModalPortal from './ModalPortal';
import toast from 'react-hot-toast';

export default function TransferAssetModal({ isOpen, asset, onClose }) {
  const [users, setUsers] = useState([]);
  const [newUserId, setNewUserId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const fetchUsers = async () => {
      const { ok, data } = await api.get('/api/users', { showToast: false });
      setUsers(ok && Array.isArray(data) ? data : []);
    };
    fetchUsers();
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!transferNotes.trim() || transferNotes.trim().length < 10) return;
    setIsSubmitting(true);
    let targetDeptId = null;
    if (newUserId) { const selectedUser = users.find(u => u.id === newUserId); if (selectedUser) targetDeptId = selectedUser.dept_id; }
    const { ok, error: err } = await api.put(`/api/assets/${asset.id}/transfer`, { new_user_id: newUserId, new_dept_id: targetDeptId, transfer_notes: transferNotes });
    setIsSubmitting(false);
    if (ok) {
      toast.success('Asset transferred successfully');
      setNewUserId(''); setTransferNotes(''); onClose();
    } else {
      toast.error(err || 'Failed to transfer asset');
    }
  };

  if (!isOpen || !asset) return null;

  const validUsers = users.filter(user => user.id !== asset.assigned_to_user_id);
  const formattedUserOptions = validUsers.map(user => ({ id: user.id, label: `${user.name} (${user.department || 'No Dept'})` }));
  const userOptionsWithStorage = [{ id: '', label: '📥 Check Into Storage Room (Unassign)' }, ...formattedUserOptions];

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
      <div className="relative glass-modal max-w-lg w-full animate-glass-in overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
        <div className="relative z-20 p-6 border-b border-white/10 bg-gradient-to-r from-[color:var(--status-info-strong)]/30 to-[color:var(--ui-cyan-strong)]/20 flex items-center gap-3">
          <ArrowRightLeft size={22} className="tt" />
          <div><h2 className="text-lg font-bold tt">Transfer Asset Custody</h2><p className="tt-label text-sm mt-0.5">ID: {asset.id} • {asset.model}</p></div>
        </div>
        <div className="relative z-20 p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="bg-[color:var(--status-warning-strong)]/10 border border-[color:var(--status-warning)]/20 rounded-xl p-4 flex items-start gap-3">
              <ShieldAlert size={18} className="text-[color:var(--status-warning)] shrink-0 mt-0.5" />
              <div><h4 className="text-sm font-bold text-[color:var(--status-warning-hi)]">Chain of Custody Protocol</h4><p className="text-xs tt-muted mt-1">You are transferring this hardware from <strong className="tt-sec">{asset.assigned_to || 'Storage'}</strong> to a new destination. A strict action log is required.</p></div>
            </div>
            <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1.5">Select New Destination <span className="text-[color:var(--status-danger)]">*</span></label><SearchableSelect options={userOptionsWithStorage} value={newUserId} onChange={setNewUserId} placeholder="Search studio roster..." /></div>
            <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1.5">Required Action / Reason Log <span className="text-[color:var(--status-danger)]">*</span></label><textarea required rows="3" minLength={10} maxLength={500} className="glass-input resize-none" placeholder="e.g., Upgraded workstation, returning old unit to storage. Ticket #4928" value={transferNotes} onChange={(e) => setTransferNotes(e.target.value)} /><div className="flex justify-between items-center mt-1"><p className="text-xs tt-muted">Minimum 10 characters required for audit compliance.</p><span className={`text-xs font-mono ${transferNotes.length < 10 ? 'text-[color:var(--status-danger)]/70' : 'text-[color:var(--status-success)]/70'}`}>{transferNotes.length}/500</span></div></div>
            <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
              <button type="button" onClick={onClose} className="glass-btn px-4 py-2 text-xs">Abort</button>
              <button type="submit" disabled={isSubmitting || !transferNotes.trim() || transferNotes.trim().length < 10} className="glass-btn glass-btn-primary px-5 py-2 text-xs disabled:opacity-50 flex items-center gap-2"><ArrowRightLeft size={14} /> Confirm Transfer</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
