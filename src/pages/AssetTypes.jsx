import React, { useState, useEffect, useCallback } from 'react';
import { Tags, Trash2, Search, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '../utils/apiClient';
import { formatId } from '../utils/formatId';
import GlassConfirmModal from '../components/glass/GlassConfirmModal';
import ScrollArea from '../components/glass/ScrollArea';

export default function AssetTypes() {
  const [types, setTypes] = useState([]);
  const [newType, setNewType] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, typeId: null });

  const fetchTypes = useCallback(async () => {
    const { ok, data } = await api.get('/api/asset-types', { showToast: false });
    setTypes(ok && Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  const handleAddType = async (e) => {
    e.preventDefault();
    if (!newType.trim()) return;
    setError(''); setSuccess('');
    const { ok, error: err } = await api.post('/api/asset-types', { name: newType });
    if (ok) { setSuccess('Category added successfully!'); setNewType(''); fetchTypes(); setTimeout(() => setSuccess(''), 3000); }
    else setError(err || 'Failed to add category');
  };

  const handleDeleteType = async (id) => {
    setDeleteConfirm({ isOpen: true, typeId: id });
  };

  const confirmDeleteType = async () => {
    const { ok, error: err } = await api.delete(`/api/asset-types/${deleteConfirm.typeId}`, { showToast: false });
    setDeleteConfirm({ isOpen: false, typeId: null });
    if (ok) fetchTypes();
    else setError(err || 'Failed to delete category');
  };

  const filteredTypes = types.filter(t => t.name && t.name.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => a.id - b.id);

  return (
    <div className="space-y-6 max-w-5xl pb-10">
      <div className="border-b border-white/10 pb-4">
        <h1 className="text-3xl font-bold tt text-glow">Global Asset Types</h1>
        <p className="tt-label mt-1">Configure the available hardware categories for dropdown menus across the system.</p>
      </div>

      {error && <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
      {success && <div className="glass-card border-l-4 border-[color:var(--status-success-strong)]/50 p-4 flex items-center gap-2"><CheckCircle2 size={18} className="text-[color:var(--status-success-hi)]"/> <span className="text-[color:var(--status-success-hi)] text-sm font-medium">{success}</span></div>}

      <div className="glass-card p-6">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2 tt">
          <Tags size={20} className="text-[color:var(--status-info)]"/> Add New Category
        </h2>
        <form onSubmit={handleAddType} className="flex gap-4">
          <input type="text" value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="e.g. Server, Drawing Tablet, VR Headset..." className="glass-input flex-1" required />
          <button type="submit" disabled={!newType.trim()} className="glass-btn glass-btn-primary px-6 py-2.5 disabled:opacity-50 cursor-pointer whitespace-nowrap text-xs">
            Save Category
          </button>
        </form>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 tt-muted" size={16} />
            <input type="text" placeholder="Search categories..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="glass-input pl-10" />
          </div>
        </div>

        <ScrollArea>
          <table className="w-full text-left border-collapse glass-table">
            <thead>
              <tr>
                <th className="p-4 w-32">System ID</th>
                <th className="p-4">Category Name</th>
                <th className="p-4 w-24 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTypes.length === 0 ? (
                <tr><td colSpan="3" className="p-8 text-center tt-muted italic">No records available.</td></tr>
              ) : (
                filteredTypes.map((type, i) => (
                  <tr key={type.id}>
                    <td className="p-4 text-sm font-medium tt-label">{formatId(i + 1)}</td>
                    <td className="p-4 text-sm font-bold tt">{type.name}</td>
                    <td className="p-4 text-center">
                      <button onClick={() => handleDeleteType(type.id)} className="tt-muted hover:text-[color:var(--status-danger)] transition-colors p-1" title="Delete Category">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>
      <GlassConfirmModal
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, typeId: null })}
        onConfirm={confirmDeleteType}
        title="Delete Category"
        message="Are you sure you want to delete this asset category? This may affect existing assets."
        confirmText="Delete Category"
        variant="danger"
      />
    </div>
  );
}
