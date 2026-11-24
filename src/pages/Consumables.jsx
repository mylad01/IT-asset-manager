import React, { useState, useEffect } from 'react';
import { Package, Plus, Minus, Trash2, AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { useHighlight } from '../hooks/useHighlight';
import GlassConfirmModal from '../components/glass/GlassConfirmModal';
import ScrollArea from '../components/glass/ScrollArea';
import toast from 'react-hot-toast';

export default function Consumables() {
  const { token } = useAuth();
  const { fetchData } = useApi();
  const [items, setItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newQty, setNewQty] = useState(0);
  const [newThreshold, setNewThreshold] = useState(5);
  const [error, setError] = useState('');
  const [success] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, itemId: null });
  const { highlightedId } = useHighlight();

  const fetchItems = async () => {
    if (!token) return;
    try {
      const result = await fetchData('/api/consumables', {}, { showToast: false });
      if (result.success) setItems(Array.isArray(result.data) ? result.data : []);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchItems(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- fetchItems re-creates every render

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return setError('Item name is required');
    try {
      const result = await fetchData('/api/consumables', {
        method: 'POST', body: { name: newName, description: newDesc, quantity: newQty, threshold: newThreshold }
      }, { successMessage: 'Supply added successfully!' });
      if (result.success) { setNewName(''); setNewDesc(''); setNewQty(0); setNewThreshold(5); fetchItems(); }
      else setError(result.error?.message || 'Failed to add item');
    } catch (err) { setError(err.message); }
  };

  const handleAdjustStock = async (id, amount) => {
    try {
      const result = await fetchData(`/api/consumables/${id}/stock`, { method: 'PUT', body: { amount } }, { showToast: false });
      if (result?.success === false) {
        toast.error(result.error || 'Failed to adjust stock');
      }
      fetchItems();
    } catch (err) { console.error(err); toast.error('Failed to adjust stock'); }
  };

  const handleDelete = async (id) => {
    setDeleteConfirm({ isOpen: true, itemId: id });
  };

  const confirmDelete = async () => {
    try {
      await fetchData(`/api/consumables/${deleteConfirm.itemId}`, { method: 'DELETE' }, { successMessage: 'Item deleted successfully' });
      setDeleteConfirm({ isOpen: false, itemId: null });
      fetchItems();
    } catch (err) { console.error(err); }
  };

  const filteredItems = items.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-6 pb-10">
      <div className="border-b border-white/10 pb-4">
        <h1 className="text-2xl sm:text-3xl font-bold tt text-glow">Consumables & Supplies</h1>
        <p className="tt-label mt-0.5 text-xs sm:text-sm">Track untagged bulk inventory like cables, batteries, and peripherals.</p>
      </div>

      {error && <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold flex items-center gap-2"><AlertTriangle size={14}/> {error}</div>}
      {success && <div className="glass-card border-l-4 border-[color:var(--status-success-strong)]/50 p-4 flex items-center gap-2"><CheckCircle2 size={18} className="text-[color:var(--status-success-hi)]"/> <span className="text-[color:var(--status-success-hi)] text-sm font-medium">{success}</span></div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="glass-card p-6 sticky top-6">
            <h2 className="text-lg font-bold tt mb-4 flex items-center gap-2"><Package className="text-[color:var(--status-info)]" size={20}/> Add New Item</h2>
            <form onSubmit={handleAddItem} className="space-y-4">
              <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Item Name</label><input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. AA Batteries" className="glass-input" required /></div>
              <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Description</label><input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="e.g. Pack of 48" className="glass-input" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Initial Stock</label><input type="number" min="0" value={newQty} onChange={e => setNewQty(Number(e.target.value))} className="glass-input" /></div>
                <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Low Alert At</label><input type="number" min="0" value={newThreshold} onChange={e => setNewThreshold(Number(e.target.value))} className="glass-input" /></div>
              </div>
              <button type="submit" className="w-full glass-btn glass-btn-primary py-2.5 mt-2 cursor-pointer">Save to Inventory</button>
            </form>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-4 flex items-center gap-2">
            <Search size={16} className="tt-muted" />
            <input type="text" placeholder="Search supplies..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="glass-input border-0 bg-transparent px-0" />
          </div>

          <div className="glass-card overflow-hidden">
            {/* Horizontal scroll on phones — without it the Actions column
                (delete) is clipped off-screen and unreachable. */}
            <ScrollArea>
              <table className="w-full min-w-[520px] text-left border-collapse glass-table">
              <thead>
                <tr>
                  <th className="p-4">Item Name</th>
                  <th className="p-4 text-center">Stock</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Manage Stock</th>
                  <th className="p-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr><td colSpan="5" className="p-8 text-center tt-muted italic">No records available.</td></tr>
                ) : (
                  filteredItems.map(item => (
                    <tr key={item.id} className={highlightedId && String(item.id) === String(highlightedId) ? 'animate-row-highlight' : ''}>
                      <td className="p-4"><p className="font-bold tt">{item.name}</p>{item.description && <p className="text-xs tt-muted mt-0.5">{item.description}</p>}</td>
                      <td className="p-4 text-center font-black text-lg tt">{item.quantity}</td>
                      <td className="p-4 text-center">
                        {item.quantity <= item.threshold ? (
                          <span className="glass-badge glass-badge-red flex items-center justify-center w-max mx-auto gap-1"><AlertTriangle size={10}/> Low Stock</span>
                        ) : (
                          <span className="glass-badge glass-badge-green">In Stock</span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => handleAdjustStock(item.id, -1)} className="glass-btn glass-btn-danger p-1.5 cursor-pointer"><Minus size={14}/></button>
                          <button onClick={() => handleAdjustStock(item.id, 1)} className="glass-btn p-1.5 cursor-pointer" style={{background:'rgba(34,197,94,0.3)', borderColor:'rgba(34,197,94,0.3)'}}><Plus size={14}/></button>
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <button onClick={() => handleDelete(item.id)} className="tt-muted hover:text-[color:var(--status-danger)] transition-colors p-1 cursor-pointer"><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              </table>
            </ScrollArea>
          </div>
        </div>
      </div>
      <GlassConfirmModal
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, itemId: null })}
        onConfirm={confirmDelete}
        title="Delete Consumable"
        message="Are you sure you want to delete this item from inventory? This action cannot be undone."
        confirmText="Delete Item"
        variant="danger"
      />
    </div>
  );
}
