import React, { useState, useEffect } from 'react';
import { X, UserPlus, KeyRound, AlertCircle } from 'lucide-react';
import api from '../utils/apiClient';
import ModalPortal from './ModalPortal';

export default function AddUserModal({ isOpen, onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Staff');
  const [deptId, setDeptId] = useState('');
  const [password, setPassword] = useState('');
  const [departments, setDepartments] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    api.get('/api/departments', { showToast: false }).then(({ ok, data }) => {
      setDepartments(ok && Array.isArray(data) ? data : []);
    });
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setIsSubmitting(true);
    const { ok, error: err } = await api.post('/api/users', { name, email, role, dept_id: deptId, password });
    if (ok) { setName(''); setEmail(''); setRole('Staff'); setDeptId(''); setPassword(''); setIsSubmitting(false); onClose(); }
    else { setError(err || 'Failed to create user account.'); setIsSubmitting(false); }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
      <div className="relative glass-modal max-w-md w-full animate-glass-in overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
        <div className="relative z-20 flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-[color:var(--status-info-strong)]/30 to-[color:var(--ui-purple-strong)]/20">
          <div className="flex items-center gap-3"><UserPlus size={22} className="tt" /><h2 className="text-lg font-bold tt">Onboard New Staff</h2></div>
          <button onClick={onClose} className="p-2 rounded-full tt-label hover:tt hover:bg-white/15 transition-all cursor-pointer"><X size={20} /></button>
        </div>
        <div className="relative z-20 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (<div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold border flex items-start gap-2"><AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{error}</span></div>)}
            <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Full Name <span className="text-[color:var(--status-danger)]">*</span></label><input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Doe" className="glass-input" /></div>
            <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Studio Email <span className="text-[color:var(--status-danger)]">*</span></label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@studio.com" className="glass-input" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">System Role</label><select value={role} onChange={(e) => setRole(e.target.value)} className="glass-select">              <option value="Staff">Standard Staff</option><option value="IT Admin">IT Admin</option><option value="Read-Only">Read-Only</option><option value="Department Manager">Department Manager</option></select></div>
              <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Department</label><select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="glass-select"><option value="">Select dept...</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            </div>
            <div className="bg-white/5 p-4 rounded-xl border border-white/10">
              <label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1 flex items-center gap-2"><KeyRound size={14} className="text-[color:var(--status-info)]"/> Initial Password <span className="text-[color:var(--status-danger)]">*</span></label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="glass-input" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="glass-btn px-4 py-2 text-xs">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="glass-btn glass-btn-primary px-5 py-2 text-xs disabled:opacity-50">{isSubmitting ? 'Creating...' : 'Save User'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
