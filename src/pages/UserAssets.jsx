import React, { useState, useEffect } from 'react';
import { Search, User, Monitor, Image as ImageIcon, AlertCircle, RefreshCw, Eye } from 'lucide-react';
import DataTable from '../components/DataTable';
import ImageViewerModal from '../components/ImageViewerModal';
import { useApi } from '../hooks/useApi';
import AssetPreviewPanel from '../components/AssetPreviewPanel';
import { useAssetPreview } from '../hooks/useAssetPreview';
import AssetMiniPreview from '../components/AssetMiniPreview';
import { TableSkeleton } from '../components/loaders/SkeletonLoader';

export default function UserAssets() {
  const { fetchData } = useApi();
  const [users, setUsers] = useState([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [userAssets, setUserAssets] = useState([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [assetsError, setAssetsError] = useState('');
  const [viewerConfig, setViewerConfig] = useState({ isOpen: false, url: '', alt: '' });
  const { previewAssetId, openPreview, closePreview, isOpen: isPreviewOpen } = useAssetPreview();

  useEffect(() => {
    const loadUsers = async () => {
      setIsLoadingUsers(true);
      setUsersError('');
      const result = await fetchData('/api/users', {}, { showToast: false });
      if (result?.success && Array.isArray(result.data)) {
        setUsers(result.data);
      } else {
        setUsers([]);
        setUsersError('Failed to load users');
      }
      setIsLoadingUsers(false);
    };
    loadUsers();
  }, [fetchData]);

  useEffect(() => {
    if (selectedUser) {
      const loadAssets = async () => {
        setIsLoadingAssets(true);
        setAssetsError('');
        const result = await fetchData(`/api/users/${selectedUser.id}/assets`, {}, { showToast: false });
        if (result?.success && Array.isArray(result.data)) {
          setUserAssets(result.data);
        } else {
          setUserAssets([]);
          setAssetsError('Failed to load assets');
        }
        setIsLoadingAssets(false);
      };
      loadAssets();
    }
  }, [selectedUser, fetchData]);

  const filteredUsers = Array.isArray(users) ? users.filter(user => user?.name?.toLowerCase().includes(searchTerm.toLowerCase()) || (user?.department && user.department.toLowerCase().includes(searchTerm.toLowerCase()))) : [];

  const columns = [
    { header: 'Photo', accessor: 'image_url', render: (row) => (row.image_url ? (<div className="relative w-10 h-10 group cursor-zoom-in" onClick={() => setViewerConfig({ isOpen: true, url: row.image_url, alt: row.model })}><img src={row.image_url} alt="Hardware" className="w-10 h-10 object-cover rounded-lg border border-white/20 shadow-sm transition-all group-hover:brightness-75" /></div>) : (<div className="w-10 h-10 rounded-lg border border-white/10 flex items-center justify-center tt-muted bg-white/5"><ImageIcon size={14} /></div>)) },
    { header: 'Asset ID', accessor: 'id', render: (row) => <AssetMiniPreview assetId={row.id}><span className="font-bold tt cursor-pointer hover:text-[color:var(--status-info-hi)] transition-colors" onClick={() => openPreview(row.id)}>{row.id}</span></AssetMiniPreview> },
    { header: '', render: (row) => <button onClick={() => openPreview(row.id)} className="tt-muted hover:text-[color:var(--status-info)] transition-colors p-1 cursor-pointer" title="Quick Preview"><Eye size={14} /></button> },
    { header: 'Type', accessor: 'type' }, { header: 'Model/Specs', accessor: 'model' },
    { header: 'Purchase Date', accessor: 'purchase_date', render: (row) => <span className="tt-muted">{row.purchase_date || 'N/A'}</span> }
  ];

  return (
    <div className="h-full flex flex-col space-y-6">
      <div><h1 className="text-3xl font-bold tt text-glow">Personnel Resources</h1><p className="tt-label mt-1">Search for an artist to view their currently assigned hardware.</p></div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[600px]">
        <div className="glass-card flex flex-col overflow-hidden h-full">
          <div className="p-4 border-b border-white/10">
            <div className="relative"><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search size={14} className="tt-muted" /></div><input type="text" placeholder="Search roster..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="glass-input pl-9" /></div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isLoadingUsers ? (
              <div className="p-4 text-center tt-muted text-sm animate-pulse">Loading users...</div>
            ) : usersError ? (
              <div className="p-4 text-center">
                <p className="text-[color:var(--status-danger)] text-sm mb-2">{usersError}</p>
                <button onClick={() => { setIsLoadingUsers(true); setUsersError(''); fetchData('/api/users', {}, { showToast: false }).then(r => { if (r?.success && Array.isArray(r.data)) setUsers(r.data); else setUsers([]); setIsLoadingUsers(false); }); }} className="glass-btn text-xs px-3 py-1.5"><RefreshCw size={12} /> Retry</button>
              </div>
            ) : (
              <>
                {filteredUsers.map(user => (
                  <button key={user.id} onClick={() => setSelectedUser(user)} className={`w-full text-left p-3 rounded-xl transition-all flex items-center gap-3 ${selectedUser?.id === user.id ? 'bg-[color:var(--status-info-strong)]/20 border border-[color:var(--status-info)]/30' : 'hover:bg-white/5 border border-transparent'}`}>
                    <div className={`p-2 rounded-full ${selectedUser?.id === user.id ? 'bg-[color:var(--status-info-strong)]/20 text-[color:var(--status-info-hi)]' : 'bg-white/5 tt-muted'}`}><User size={16} /></div>
                    <div><div className={`text-sm font-bold ${selectedUser?.id === user.id ? 'text-[color:var(--status-info-hi)]' : 'tt'}`}>{user.name}</div><div className="text-[10px] tt-muted">{user.department || 'No Dept'} • {user.role}</div></div>
                  </button>
                ))}
                {filteredUsers.length === 0 && (<div className="p-4 text-center text-sm tt-muted italic">No users found.</div>)}
              </>
            )}
          </div>
        </div>
        <div className="lg:col-span-2 flex flex-col h-full">
          {!selectedUser ? (<div className="glass-card flex-1 flex flex-col items-center justify-center tt-muted border-dashed border-2"><Monitor size={48} className="mb-4 tt-muted" /><p className="text-lg font-medium">Select a user to view their resources</p></div>) : (
            <div className="space-y-4">
              <div className="glass-card p-6 flex items-center justify-between">
                <div><h2 className="text-2xl font-black tt">{selectedUser?.name}'s Gear</h2><p className="tt-muted">{selectedUser?.email || 'No email on file'}</p></div>
                <div className="text-right"><div className="text-[10px] tt-muted font-bold uppercase tracking-widest">Total Items</div><div className="text-3xl font-black text-[color:var(--status-info)]">{isLoadingAssets ? '...' : userAssets?.length || 0}</div></div>
              </div>
              {isLoadingAssets ? <TableSkeleton rows={3} columns={5} /> : assetsError ? (
                <div className="glass-card p-6"><div className="flex items-start gap-4"><div className="p-2 rounded-xl bg-[color:var(--status-danger-strong)]/20 text-[color:var(--status-danger-hi)]"><AlertCircle size={20} /></div><div><p className="text-[color:var(--status-danger-hi)] text-sm">{assetsError}</p><button onClick={() => { setIsLoadingAssets(true); setAssetsError(''); fetchData(`/api/users/${selectedUser.id}/assets`, {}, { showToast: false }).then(r => { if (r?.success && Array.isArray(r.data)) setUserAssets(r.data); else setUserAssets([]); setIsLoadingAssets(false); }); }} className="glass-btn mt-3 text-xs px-3 py-1.5"><RefreshCw size={12} /> Retry</button></div></div></div>
              ) : (
                <DataTable columns={columns} data={userAssets} searchPlaceholder="Search their assigned gear..." />
              )}
            </div>
          )}
        </div>
      </div>
      <AssetPreviewPanel assetId={previewAssetId} isOpen={isPreviewOpen} onClose={closePreview} />
      <ImageViewerModal isOpen={viewerConfig.isOpen} imageUrl={viewerConfig.url} altText={viewerConfig.alt} onClose={() => setViewerConfig({ isOpen: false, url: '', alt: '' })} />
    </div>
  );
}
