import React, { useState, useEffect, useCallback } from 'react';
import DataTable from '../components/DataTable';
import AddUserModal from '../components/AddUserModal';
import GlassConfirmModal from '../components/glass/GlassConfirmModal';
import { Users, Shield, Edit3, Trash2, KeyRound, AlertCircle, X, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { TableSkeleton } from '../components/loaders/SkeletonLoader';
import WidgetErrorBoundary from '../components/error-boundaries/WidgetErrorBoundary';
import ModalPortal from '../components/ModalPortal';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [editError, setEditError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, userId: null });
  const { user: currentUser } = useAuth();
  const { fetchData: apiFetch, isLoading, error } = useApi();

  const fetchData = useCallback(async () => {
    try {
      const [u, d] = await Promise.all([apiFetch('/api/users', {}, { showToast: false }), apiFetch('/api/departments', {}, { showToast: false })]);
      if (u?.data) setUsers(Array.isArray(u.data) ? u.data : []); if (d?.data) setDepartments(Array.isArray(d.data) ? d.data : []);
    } catch (err) { console.error(err); }
  }, [apiFetch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (id) => {
    setGlobalError('');
    if (id === currentUser.id) { setGlobalError("Cannot delete your own account."); return; }
    setDeleteConfirm({ isOpen: true, userId: id });
  };

  const confirmDelete = async () => {
    await apiFetch(`/api/users/${deleteConfirm.userId}`, { method: 'DELETE' }, { showToast: true, successMessage: 'User deleted' });
    setDeleteConfirm({ isOpen: false, userId: null });
    fetchData();
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault(); setEditError('');
    const { success, error: err } = await apiFetch(`/api/users/${editingUser.id}`, { method: 'PUT', body: editingUser }, { showToast: false });
    if (success) { setEditingUser(null); fetchData(); }
    else setEditError(err || 'Failed to update.');
  };

  const columns = [
    { header: 'Name', accessor: 'name', render: (r) => <span className="font-bold tt">{r.name}</span> },
    { header: 'Email', accessor: 'email', render: (r) => <span className="tt-label">{r.email || 'N/A'}</span> },
    { header: 'Department', accessor: 'department', render: (r) => r.department || <span className="tt-muted italic">No Dept</span> },
    { header: 'Role', accessor: 'role', render: (r) => <span className={`glass-badge ${r.role === 'IT Admin' ? 'glass-badge-purple' : r.role === 'Department Manager' ? 'glass-badge-amber' : 'glass-badge-gray'}`}>{r.role === 'IT Admin' && <Shield size={10} />} {r.role || 'Staff'}</span> },
    { header: 'Actions', render: (r) => <div className="flex gap-3"><button onClick={() => { setEditingUser(r); setEditError(''); }} className="text-[color:var(--status-info)] hover:text-[color:var(--status-info-hi)]"><Edit3 size={16} /></button><button onClick={() => handleDelete(r.id)} className="tt-muted hover:text-[color:var(--status-danger)]"><Trash2 size={16} /></button></div> }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-[color:var(--ui-purple-strong)]/30 to-[color:var(--ui-indigo-strong)]/20"><Users size={24} className="text-[color:var(--ui-purple-hi)]" /></div>
          <div><h1 className="text-2xl sm:text-3xl font-bold tt text-glow">User & Access Management</h1><p className="tt-label mt-0.5 text-xs sm:text-sm">Modify staff credentials and manage studio accounts.</p></div>
        </div>
        <button onClick={() => setIsAddModalOpen(true)} className="glass-btn glass-btn-primary px-4 py-2 text-xs self-start sm:self-auto">+ Add New User</button>
      </div>

      {globalError && <div className="glass-card border-l-4 border-[color:var(--status-danger-strong)]/50 p-4 flex justify-between items-start"><div className="flex gap-3"><AlertCircle className="text-[color:var(--status-danger)]" size={18} /><span className="text-[color:var(--status-danger-hi)] text-sm">{globalError}</span></div><button onClick={() => setGlobalError('')} className="tt-muted hover:tt-sec"><X size={18} /></button></div>}

      {isLoading ? <TableSkeleton rows={6} columns={5} /> : error ? (
        <div className="glass-card p-6"><AlertCircle size={24} className="text-[color:var(--status-danger-hi)] mb-2" /><h3 className="font-bold tt">Failed to load</h3><button onClick={fetchData} className="glass-btn glass-btn-primary mt-3 text-xs px-4 py-2"><RefreshCw size={14} /> Retry</button></div>
      ) : <div className="glass-card p-2"><WidgetErrorBoundary fallbackText="Failed"><DataTable columns={columns} data={users} searchPlaceholder="Search by name or role..." /></WidgetErrorBoundary></div>}

      <AddUserModal isOpen={isAddModalOpen} onClose={() => { setIsAddModalOpen(false); fetchData(); }} />

      {editingUser && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { setEditingUser(null); setEditError(''); }}>
          <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
          <div className="relative glass-modal max-w-md w-full animate-glass-in p-6" onClick={e => e.stopPropagation()}>
            <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
            <div className="relative z-20">
              <h2 className="text-lg font-bold tt mb-4 flex items-center gap-2"><KeyRound size={20} className="text-[color:var(--status-info)]" /> Modify User</h2>
              <form onSubmit={handleUpdateSubmit} className="space-y-4">
                {editError && <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold"><AlertCircle size={14} /> {editError}</div>}
                <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Name</label><input type="text" required value={editingUser.name} onChange={(e) => setEditingUser({...editingUser, name: e.target.value})} className="glass-input" /></div>
                <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Email</label><input type="email" required value={editingUser.email || ''} onChange={(e) => setEditingUser({...editingUser, email: e.target.value})} className="glass-input" /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Role</label><select value={editingUser.role} onChange={(e) => setEditingUser({...editingUser, role: e.target.value})} className="glass-select"><option>Staff</option><option>IT Admin</option><option>Read-Only</option><option>Department Manager</option></select></div>
                  <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">Dept</label><select value={editingUser.dept_id || ''} onChange={(e) => setEditingUser({...editingUser, dept_id: e.target.value})} className="glass-select"><option value="">None</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                </div>
                <div><label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">New Password</label><input type="password" placeholder="Leave blank to keep" onChange={(e) => setEditingUser({...editingUser, password: e.target.value})} className="glass-input" /></div>
                <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                  <button type="button" onClick={() => setEditingUser(null)} className="glass-btn px-4 py-2 text-xs">Cancel</button>
                  <button type="submit" className="glass-btn glass-btn-primary px-4 py-2 text-xs">Save</button>
                </div>
              </form>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
      <GlassConfirmModal
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, userId: null })}
        onConfirm={confirmDelete}
        title="Delete User"
        message="Are you sure you want to delete this user? This action cannot be undone."
        confirmText="Delete User"
        variant="danger"
      />
    </div>
  );
}
