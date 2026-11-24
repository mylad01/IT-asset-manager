import React, { useState, useEffect } from 'react';
import DataTable from '../components/DataTable';
import ImageViewerModal from '../components/ImageViewerModal';
import { MonitorPlay, Image as ImageIcon, ZoomIn, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/apiClient';
import AssetPreviewPanel from '../components/AssetPreviewPanel';
import { useAssetPreview } from '../hooks/useAssetPreview';
import { useHighlight } from '../hooks/useHighlight';
import AssetMiniPreview from '../components/AssetMiniPreview';
import { TableSkeleton } from '../components/loaders/SkeletonLoader';

export default function MyAssets() {
  const [assets, setAssets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewerConfig, setViewerConfig] = useState({ isOpen: false, url: '', alt: '' });
  const { previewAssetId, openPreview, closePreview, isOpen: isPreviewOpen } = useAssetPreview();
  const { user } = useAuth();
  const { highlightedId } = useHighlight();

  useEffect(() => {
    if (!user?.id) return;
    const fetchAssets = async () => {
      setIsLoading(true);
      setError('');
      const { ok, data, error: err } = await api.get(`/api/users/${user.id}/assets`);
      if (ok && Array.isArray(data)) {
        setAssets(data);
      } else {
        setAssets([]);
        setError(err || 'Failed to load your assets');
      }
      setIsLoading(false);
    };
    fetchAssets();
  }, [user]);

  const columns = [
    {
      header: 'Photo', accessor: 'image_url',
      render: (row) => (
        row.image_url ? (
          <div className="relative w-12 h-12 group cursor-zoom-in" onClick={() => setViewerConfig({ isOpen: true, url: row.image_url, alt: row.model })}>
            <img src={row.image_url} alt="Hardware" className="w-12 h-12 object-cover rounded-lg border border-white/20 shadow-sm transition-all group-hover:brightness-75" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg bg-black/30">
              <ZoomIn size={18} className="tt drop-shadow-md" />
            </div>
          </div>
        ) : (
          <div className="w-12 h-12 rounded-lg border border-white/10 flex items-center justify-center tt-muted bg-white/5">
            <ImageIcon size={18} />
          </div>
        )
      )
    },
    { header: 'Asset ID', accessor: 'id', render: (row) => <AssetMiniPreview assetId={row.id}><span className="font-bold tt cursor-pointer hover:text-[color:var(--status-info-hi)] transition-colors" onClick={() => openPreview(row.id)}>{row.id}</span></AssetMiniPreview> },
    { header: 'Type', accessor: 'type' },
    { header: 'Model/Specs', accessor: 'model' },
    { header: 'Department', accessor: 'dept', render: (row) => row.dept || <span className="tt-muted italic">Unassigned</span> },
    {
      header: 'Status', accessor: 'status',
      render: (row) => <span className="glass-badge glass-badge-green">{row.status}</span>
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 border-b border-white/10 pb-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-[color:var(--status-info-strong)]/30 to-[color:var(--ui-cyan-strong)]/20">
          <MonitorPlay size={28} className="text-[color:var(--ui-cyan-hi)]" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tt text-glow">My Assigned Gear</h1>
          <p className="tt-label mt-1">Hardware actively checked out to you. Contact IT for transfers or support.</p>
        </div>
      </div>

      {isLoading ? <TableSkeleton rows={5} columns={5} /> : error ? (
        <div className="glass-card p-6"><div className="flex items-start gap-4"><div className="p-2 rounded-xl bg-[color:var(--status-danger-strong)]/20 text-[color:var(--status-danger-hi)]"><AlertCircle size={24} /></div><div><h3 className="text-lg font-bold tt">Failed to load assets</h3><p className="tt-label mt-2 text-sm">{error}</p><button onClick={() => { setIsLoading(true); api.get(`/api/users/${user.id}/assets`).then(({ ok, data, error: err }) => { if (ok && Array.isArray(data)) setAssets(data); else { setAssets([]); setError(err || 'Failed to load'); } setIsLoading(false); }); }} className="glass-btn glass-btn-primary mt-4 text-xs px-4 py-2"><RefreshCw size={14} /> Retry</button></div></div></div>
      ) : (
        <DataTable columns={columns} data={assets} searchPlaceholder="Search your inventory..." highlightId={highlightedId} />
      )}
      <AssetPreviewPanel assetId={previewAssetId} isOpen={isPreviewOpen} onClose={closePreview} />
      <ImageViewerModal isOpen={viewerConfig.isOpen} imageUrl={viewerConfig.url} altText={viewerConfig.alt} onClose={() => setViewerConfig({ isOpen: false, url: '', alt: '' })} />
    </div>
  );
}
