import React, { useState, useEffect, useCallback } from 'react';
import { Package, Plus, Trash2, Zap, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import KitDeployModal from '../components/KitDeployModal';
import GlassConfirmModal from '../components/glass/GlassConfirmModal';
import api from '../utils/apiClient';
import toast from 'react-hot-toast';

export default function Kits() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'IT Admin' || user?.isRoot;
  const [kits, setKits] = useState([]);
  const [users, setUsers] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [newKitName, setNewKitName] = useState('');
  const [newKitDesc, setNewKitDesc] = useState('');
  const [kitItems, setKitItems] = useState([]);
  const [deployUserId, setDeployUserId] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState({ text: '', type: '' });
  const [missingAssets, setMissingAssets] = useState([]);
  const [deployModal, setDeployModal] = useState({ isOpen: false, kitId: null, kitName: '' });
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, kitId: null });

  const fetchData = useCallback(async () => {
    const [typesRes, kitsRes, usersRes] = await Promise.all([
      api.get('/api/asset-types', { showToast: false }),
      api.get('/api/kits', { showToast: false }),
      api.get('/api/users', { showToast: false }),
    ]);
    const safeTypes = typesRes.ok && Array.isArray(typesRes.data) ? typesRes.data : [];
    setAssetTypes(safeTypes);
    if (safeTypes.length > 0) setKitItems(prev => (prev.length === 0 ? [{ asset_type: safeTypes[0].name, quantity: 1 }] : prev));
    setKits(kitsRes.ok && Array.isArray(kitsRes.data) ? kitsRes.data : []);
    const safeUsers = usersRes.ok && Array.isArray(usersRes.data) ? usersRes.data : [];
    setUsers(safeUsers);
    if (safeUsers.length > 0) setDeployUserId(safeUsers[0].id);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddItemRow = () => { const defaultType = assetTypes.length > 0 ? assetTypes[0].name : ''; setKitItems([...kitItems, { asset_type: defaultType, quantity: 1 }]); };
  const updateItemRow = (index, field, value) => { const updated = [...kitItems]; updated[index][field] = value; setKitItems(updated); };

  const handleCreateKit = async (e) => {
    e.preventDefault(); if (!newKitName.trim()) return;
    const { ok, error: err } = await api.post('/api/kits', { name: newKitName, description: newKitDesc, items: kitItems });
    if (ok) {
      toast.success('Kit template created');
      setNewKitName(''); setNewKitDesc(''); const defaultType = assetTypes.length > 0 ? assetTypes[0].name : ''; setKitItems([{ asset_type: defaultType, quantity: 1 }]);
      fetchData();
    } else {
      toast.error(err || 'Failed to create kit');
    }
  };

  const handleDeleteKit = async (id) => {
    setDeleteConfirm({ isOpen: true, kitId: id });
  };

  const confirmDeleteKit = async () => {
    const { ok, error: err } = await api.delete(`/api/kits/${deleteConfirm.kitId}`);
    setDeleteConfirm({ isOpen: false, kitId: null });
    if (ok) {
      toast.success('Kit deleted');
      fetchData();
    } else {
      toast.error(err || 'Failed to delete kit');
    }
  };

  const handleDeployClick = (kitId, kitName) => {
    if (!deployUserId) return;
    setDeployModal({ isOpen: true, kitId, kitName });
  };

  const handleDeployed = (data) => {
    setFeedbackMsg({ text: data?.message || 'Deployed', type: 'success' });
    setMissingAssets(data?.missing || []);
    fetchData();
    setTimeout(() => { setFeedbackMsg({ text: '', type: '' }); setMissingAssets([]); }, 5000);
  };

  const selectedUser = users.find(u => u.id === Number(deployUserId));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tt text-glow">Predefined Kits</h1>
        <p className="tt-label mt-1">Build hardware bundles and deploy complete workstations in one click.</p>
      </div>

      {feedbackMsg.text && (
        <div className={`glass-card border-l-4 p-4 text-sm font-medium ${feedbackMsg.type === 'error' ? 'border-[color:var(--status-danger-strong)]/50 text-[color:var(--status-danger-hi)]' : feedbackMsg.type === 'success' ? 'border-[color:var(--status-success-strong)]/50 text-[color:var(--status-success-hi)]' : 'border-[color:var(--status-info-strong)]/50 text-[color:var(--status-info-hi)]'}`}>
          {feedbackMsg.text}
        </div>
      )}

      {missingAssets.length > 0 && (
        <div className="glass-card border-l-4 border-l-[color:var(--status-warning-strong)]/50 p-4">
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded-lg bg-[color:var(--status-warning-strong)]/20 shrink-0 mt-0.5"><AlertTriangle size={18} className="text-[color:var(--status-warning)]" /></div>
            <div className="flex-1">
              <h4 className="text-sm font-bold text-[color:var(--status-warning-hi)] mb-1">Assets Missing from Storage Room</h4>
              <p className="text-xs tt-label mb-2">The following components could not be deployed because not enough units are available in storage:</p>
              <div className="space-y-1.5">
                {missingAssets.map((m, i) => (
                  <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 border border-[color:var(--status-warning)]/10">
                    <span className="text-xs font-medium tt-sec">{m.asset_type}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] tt-muted">Requested: <strong className="tt-sec">{m.requested}</strong></span>
                      <span className="text-[10px] tt-muted">Available: <strong className="text-[color:var(--status-warning-hi)]">{m.available}</strong></span>
                      <span className="text-[10px] font-bold text-[color:var(--status-danger)]">Missing: {m.shortfall}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Build New Kit Form — a mutation surface: admins only (PLAN §17.3 BUG-2) */}
        {isAdmin && (
        <div className="lg:col-span-1 glass-card p-6">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 tt"><Package size={20} className="text-[color:var(--status-info)]"/> Build New Kit</h2>
          <form onSubmit={handleCreateKit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Bundle Name</label>
              <input type="text" value={newKitName} onChange={(e) => setNewKitName(e.target.value)} className="glass-input" placeholder="e.g. VFX Workstation" required />
            </div>
            <div>
              <label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Description</label>
              <input type="text" value={newKitDesc} onChange={(e) => setNewKitDesc(e.target.value)} className="glass-input" placeholder="Standard setup for remote artists" />
            </div>
            <div className="pt-2 border-t border-white/10">
              <label className="block text-xs font-bold tt-label uppercase tracking-wider mb-2">Required Components</label>
              <div className="space-y-2 mb-3">
                {kitItems.map((item, index) => (
                  <div key={index} className="flex gap-2">
                    <select value={item.asset_type} onChange={(e) => updateItemRow(index, 'asset_type', e.target.value)} className="glass-select flex-grow">
                      {assetTypes.map(type => (<option key={type.id} value={type.name}>{type.name}</option>))}
                    </select>
                    <input type="number" min="1" max="10" value={item.quantity} onChange={(e) => updateItemRow(index, 'quantity', Number(e.target.value))} className="glass-input w-16 text-center" />
                  </div>
                ))}
              </div>
              {isAdmin && <button type="button" onClick={handleAddItemRow} className="text-xs text-[color:var(--status-info)] font-medium flex items-center gap-1 hover:text-[color:var(--status-info-hi)]"><Plus size={14} /> Add Component</button>}
            </div>
            {isAdmin && <button type="submit" className="w-full glass-btn glass-btn-primary px-4 py-2.5 text-xs mt-2">Save Kit Template</button>}
          </form>
        </div>
        )}

        {/* Kit Cards */}
        <div className={`${isAdmin ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-4`}>
          <div className="glass-card p-4 flex items-center gap-4">
            <span className="text-sm font-medium tt-sec">Target User:</span>
            <select value={deployUserId} onChange={(e) => setDeployUserId(e.target.value)} className="glass-select flex-grow max-w-xs">
              {users.map(u => (<option key={u.id} value={u.id}>{u.name} ({u.department})</option>))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {kits.length === 0 ? (
              <div className="col-span-full p-8 text-center tt-muted italic glass-subtle">No kits defined yet.</div>
            ) : (
              kits.map(kit => (
                <div key={kit.id} className="glass-card p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold tt">{kit.name}</h3>
                      {isAdmin && <button onClick={() => handleDeleteKit(kit.id)} className="tt-muted hover:text-[color:var(--status-danger)] transition-colors"><Trash2 size={14} /></button>}
                    </div>
                    {kit.description && <p className="text-xs tt-muted mb-3">{kit.description}</p>}
                    <div className="bg-white/5 p-3 rounded-xl border border-white/10 mb-4">
                      <div className="text-[10px] font-bold tt-muted uppercase tracking-widest mb-2">Contains:</div>
                      <ul className="space-y-1">
                        {kit.items?.map(item => (
                          <li key={item.id} className="text-sm tt-sec flex justify-between">
                            <span>{item.asset_type}</span>
                            <span className="font-medium">x{item.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {isAdmin && <button onClick={() => handleDeployClick(kit.id, kit.name)} className="w-full glass-btn glass-btn-primary px-4 py-2 text-xs flex items-center justify-center gap-2"><Zap size={14} /> Deploy Bundle</button>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Deploy Modal */}
      <KitDeployModal
        kitId={deployModal.kitId}
        kitName={deployModal.kitName}
        userId={selectedUser?.id}
        deptId={selectedUser?.dept_id}
        isOpen={deployModal.isOpen}
        onClose={() => setDeployModal({ isOpen: false, kitId: null, kitName: '' })}
        onDeployed={handleDeployed}
      />
      <GlassConfirmModal
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, kitId: null })}
        onConfirm={confirmDeleteKit}
        title="Delete Kit Template"
        message="Are you sure you want to delete this kit bundle template? This action cannot be undone."
        confirmText="Delete Kit"
        variant="danger"
      />
    </div>
  );
}
