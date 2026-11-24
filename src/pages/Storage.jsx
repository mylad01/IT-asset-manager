import React, { useState, useEffect } from 'react';
import DataTable from '../components/DataTable';
import { Archive, AlertCircle, RefreshCw, Eye } from 'lucide-react';
import api from '../utils/apiClient';
import { useSearchParams } from 'react-router-dom';
import AssetPreviewPanel from '../components/AssetPreviewPanel';
import { useAssetPreview } from '../hooks/useAssetPreview';

export default function Storage() {
  const [storedAssets, setStoredAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { previewAssetId, openPreview, closePreview, isOpen: isPreviewOpen } = useAssetPreview();
  const [searchParams, setSearchParams] = useSearchParams();

  const fetchStorage = async () => {
    setLoading(true);
    setError('');
    const { ok, data, error: err } = await api.get('/api/assets/unassigned', { showToast: false });
    if (ok && Array.isArray(data)) {
      setStoredAssets(data);
    } else {
      setStoredAssets([]);
      setError(err || 'Failed to load storage inventory');
    }
    setLoading(false);
  };

  useEffect(() => { fetchStorage(); }, []);

  useEffect(() => {
    const previewId = searchParams.get('preview');
    if (previewId) { openPreview(previewId); setSearchParams({}, { replace: true }); }
  }, [searchParams, openPreview, setSearchParams]);

  const columns = [
    { header: 'Asset ID', accessor: 'id', render: (row) => <span className="font-semibold tt cursor-pointer hover:text-[color:var(--status-info-hi)] transition-colors" onClick={() => openPreview(row.id)}>{row.id}</span> },
    { header: '', render: (row) => <button onClick={() => openPreview(row.id)} className="tt-muted hover:text-[color:var(--status-info)] transition-colors p-1 cursor-pointer" title="Quick Preview"><Eye size={14} /></button> },
    { header: 'Global Type', accessor: 'type' },
    { header: 'Model / Specs', accessor: 'model' },
    { header: 'Status', accessor: 'status', render: (row) => <span className="glass-badge glass-badge-gray">{row.status}</span> }
  ];

  if (loading) return <div className="p-8 tt-muted animate-pulse">Loading storage inventory...</div>;

  if (error) return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tt text-glow flex items-center gap-3"><Archive size={28} className="tt-muted" /> Storage Facility</h1>
      </div>
      <div className="glass-card p-6"><div className="flex items-start gap-4"><div className="p-2 rounded-xl bg-[color:var(--status-danger-strong)]/20 text-[color:var(--status-danger-hi)]"><AlertCircle size={24} /></div><div><h3 className="text-lg font-bold tt">Failed to load storage</h3><p className="tt-label mt-2 text-sm">{error}</p><button onClick={fetchStorage} className="glass-btn glass-btn-primary mt-4 text-xs px-4 py-2"><RefreshCw size={14} /> Retry</button></div></div></div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tt text-glow flex items-center gap-3">
            <Archive size={28} className="tt-muted" /> Storage Facility
          </h1>
          <p className="tt-label mt-1">View all unassigned hardware currently available in the storage room.</p>
        </div>
        <div className="glass-subtle px-4 py-2 text-sm">
          <span className="tt-label">Total in Storage: </span>
          <span className="font-bold tt">{storedAssets.length} items</span>
        </div>
      </div>
      <AssetPreviewPanel assetId={previewAssetId} isOpen={isPreviewOpen} onClose={closePreview} />
      <DataTable columns={columns} data={storedAssets} searchPlaceholder="Search available hardware in storage..." />
    </div>
  );
}
