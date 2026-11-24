import React, { useState, useEffect } from 'react';
import { X, LifeBuoy, AlertCircle, Monitor } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/apiClient';
import ModalPortal from './ModalPortal';

export default function CreateTicketModal({ isOpen, onClose }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Workstation Hardware');
  const [priority, setPriority] = useState('Medium');
  const [assetId, setAssetId] = useState('');
  const [myAssets, setMyAssets] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    if (!isOpen || !user?.id) return;
    api.get(`/api/users/${user.id}/assets`, { showToast: false }).then(({ ok, data }) => { if (ok && Array.isArray(data)) setMyAssets(data); });
  }, [isOpen, user]);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!title.trim()) { setError('Issue Summary is required.'); return; }
    if (!description.trim()) { setError('Detailed Description is required.'); return; }
    setError(''); setIsSubmitting(true);
    try {
      const { ok, error: err } = await api.post('/api/tickets', { title, description, category, priority, asset_id: assetId });
      if (!ok) throw new Error(err || 'Failed to submit ticket.');
      setTitle(''); setDescription(''); setCategory('Workstation Hardware'); setPriority('Medium'); setAssetId(''); setIsSubmitting(false); if (typeof onClose === 'function') onClose();
    } catch (err) { setError(err.message); setIsSubmitting(false); }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
      <div className="relative glass-modal max-w-lg w-full animate-glass-in overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
        <div className="relative z-20 flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-[color:var(--ui-indigo-strong)]/30 to-[color:var(--ui-purple-strong)]/20">
          <div className="flex items-center gap-3"><LifeBuoy size={22} className="tt" /><h2 className="text-lg font-bold tt">Submit IT Support Ticket</h2></div>
          <button type="button" onClick={onClose} className="p-2 rounded-full tt-label hover:tt hover:bg-white/15 transition-all cursor-pointer"><X size={20} /></button>
        </div>
        <div className="relative z-20 p-6 space-y-4">
          {error && (<div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold border flex items-start gap-2"><AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{error}</span></div>)}
          <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Issue Summary <span className="text-[color:var(--status-danger)]">*</span></label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Maya crashing on startup" className="glass-input" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Category</label><select value={category} onChange={(e) => setCategory(e.target.value)} className="glass-select"><option value="Workstation Hardware">Workstation Hardware</option><option value="Software / Plugins">Software / Plugins</option><option value="Render Farm / Network">Render Farm / Network</option><option value="Production Equipment">Production Equipment</option><option value="Other">Other</option></select></div>
            <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Urgency</label><select value={priority} onChange={(e) => setPriority(e.target.value)} className="glass-select"><option value="Low">Low - Not blocking work</option><option value="Medium">Medium - Annoying but workable</option><option value="High">High - Blocking my work</option><option value="Critical">Critical - Blocking production</option></select></div>
          </div>
          <div className="bg-white/5 p-3 rounded-xl border border-white/10"><label className="block text-[10px] font-bold tt-muted uppercase tracking-wider mb-1 flex items-center gap-1"><Monitor size={12} className="tt-muted"/> Link Hardware</label><select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="glass-select"><option value="">No specific hardware</option>{myAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></div>
          <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Detailed Description <span className="text-[color:var(--status-danger)]">*</span></label><textarea rows="3" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Provide details..." className="glass-input resize-none"></textarea></div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="glass-btn px-4 py-2 text-xs">Cancel</button>
            <button type="button" onClick={handleSubmit} disabled={isSubmitting} className="glass-btn glass-btn-indigo px-5 py-2 text-xs disabled:opacity-50 cursor-pointer">{isSubmitting ? 'Submitting...' : 'Submit Ticket'}</button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
