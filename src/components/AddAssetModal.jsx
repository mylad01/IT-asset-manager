import React, { useState, useEffect } from 'react';
import SearchableSelect from './SearchableSelect';
import { DYNAMIC_FIELDS } from '../utils/dynamicFields';
import { UploadCloud, X, AlertCircle } from 'lucide-react';
import api from '../utils/apiClient';
import ModalPortal from './ModalPortal';
import ScrollArea from './glass/ScrollArea';
import toast from 'react-hot-toast';

export default function AddAssetModal({ isOpen, onClose }) {
  const [formData, setFormData] = useState({ id: '', type: '', model: '', serial_number: '', purchase_date: '', warranty_expiry: '', assigned_to_user_id: '', status: 'In Storage' });
  const [customData, setCustomData] = useState({});
  const [isDateUnknown, setIsDateUnknown] = useState(false);
  const [types, setTypes] = useState([]);
  const [users, setUsers] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => { setCustomData({}); }, [formData.type]);
  useEffect(() => { if (!isOpen) return; const load = async () => { const [typesRes, usersRes] = await Promise.all([ api.get('/api/asset-types', { showToast: false }), api.get('/api/users', { showToast: false }) ]); const safeTypes = typesRes.ok && Array.isArray(typesRes.data) ? typesRes.data : []; setTypes(safeTypes); if (safeTypes.length > 0 && !formData.type) setFormData(p => ({...p, type: safeTypes[0].name})); setUsers(usersRes.ok && Array.isArray(usersRes.data) ? usersRes.data : []); }; load(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- formData.type set inside effect

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!imageFile) { setFormError('An image is required.'); return; }
    setIsSubmitting(true);
    const fd = new FormData();
    Object.entries(formData).forEach(([k, v]) => fd.append(k, v));
    if (Object.keys(customData).length > 0) fd.append('custom_attributes', JSON.stringify(customData));
    fd.append('image', imageFile);
    const { ok, error: err } = await api.post('/api/assets', fd);
    setIsSubmitting(false);
    if (ok) {
      toast.success('Asset created successfully');
      setFormData({ id: '', type: types[0]?.name || '', model: '', serial_number: '', purchase_date: '', warranty_expiry: '', assigned_to_user_id: '', status: 'In Storage' });
      setCustomData({}); setIsDateUnknown(false); setImageFile(null); onClose();
    } else {
      setFormError(err || 'Failed to create asset');
    }
  };

  if (!isOpen) return null;

  const userOpts = [{ id: '', label: '📥 Leave in Storage' }, ...users.map(u => ({ id: u.id, label: `${u.name} (${u.department || 'No Dept'})` }))];
  const dynamicFields = DYNAMIC_FIELDS[formData.type] || [];

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
      <div className="relative glass-modal max-w-2xl w-full animate-glass-in overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
        <div className="relative z-20 flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-[color:var(--status-info-strong)]/30 to-[color:var(--ui-purple-strong)]/20">
          <h2 className="text-lg font-bold tt">Add New Hardware Asset</h2>
          <button onClick={onClose} className="p-2 rounded-full tt-label hover:tt hover:bg-white/15 transition-all cursor-pointer"><X size={20} /></button>
        </div>
        <ScrollArea className="z-20" contentClassName="p-6 max-h-[80vh]">
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold flex items-center gap-2">
                <AlertCircle size={14} /> {formError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Asset ID</label><input className="glass-input" required value={formData.id} onChange={e => setFormData({...formData, id: e.target.value})} placeholder="PC-VFX-001" /></div>
              <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Type</label><select className="glass-select" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>{types.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Model</label><input className="glass-input" required value={formData.model} onChange={e => setFormData({...formData, model: e.target.value})} placeholder="RED V-Raptor 8K" /></div>
              <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Serial Number</label><input className="glass-input" value={formData.serial_number} onChange={e => setFormData({...formData, serial_number: e.target.value})} placeholder="SN-123" /></div>
            </div>
            <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-2">Hardware Photo (Required)</label><div className="border-2 border-dashed border-white/20 rounded-xl p-4 flex flex-col items-center bg-white/5 hover:bg-white/10 transition-colors"><UploadCloud size={28} className="tt-muted mb-2" /><input type="file" accept="image/*" required onChange={e => setImageFile(e.target.files[0])} className="text-sm tt-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[color:var(--status-info-strong)]/20 file:text-[color:var(--status-info-hi)]" /></div></div>
            {dynamicFields.length > 0 && <div className="pt-2 border-t border-white/10"><h3 className="text-xs font-bold text-[color:var(--status-info)] uppercase tracking-wider mb-2">Specific Specs</h3><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{dynamicFields.map(f => <div key={f.key}><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">{f.label}</label><input className="glass-input" value={customData[f.key] || ''} onChange={e => setCustomData({...customData, [f.key]: e.target.value})} placeholder={f.placeholder} /></div>)}</div></div>}
            <div className="pt-2 border-t border-white/10">
              <div className="flex justify-between items-center mb-1"><label className="block text-xs font-bold tt-label uppercase tracking-wider">Purchase Date</label><label className="flex items-center text-[10px] font-bold text-[color:var(--status-info)] gap-1 cursor-pointer"><input type="checkbox" checked={isDateUnknown} onChange={e => { setIsDateUnknown(e.target.checked); setFormData({...formData, purchase_date: e.target.checked ? '(unknown)' : ''}); }} className="rounded" /> Unknown</label></div>
              <input type={isDateUnknown ? "text" : "date"} disabled={isDateUnknown} className={`glass-input ${isDateUnknown ? 'opacity-50' : ''}`} value={formData.purchase_date} onChange={e => setFormData({...formData, purchase_date: e.target.value})} />
            </div>
            <div className="pt-2 border-t border-white/10"><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Warranty Expiry</label><input type="date" className="glass-input" value={formData.warranty_expiry} onChange={e => setFormData({...formData, warranty_expiry: e.target.value})} /></div>
            <div className="pt-2 border-t border-white/10"><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Assign To</label><SearchableSelect options={userOpts} value={formData.assigned_to_user_id} onChange={v => setFormData({...formData, assigned_to_user_id: v, status: v ? 'Deployed' : 'In Storage'})} placeholder="Search roster..." /></div>
            <div className="flex justify-end gap-3 pt-4 border-t border-white/10"><button type="button" onClick={onClose} className="glass-btn px-4 py-2 text-xs">Cancel</button><button type="submit" disabled={isSubmitting} className="glass-btn glass-btn-primary px-5 py-2 text-xs disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save Asset'}</button></div>
          </form>
        </ScrollArea>
      </div>
    </div>
    </ModalPortal>
  );
}
