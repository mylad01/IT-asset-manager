import React, { useState, useEffect, useCallback } from 'react';
import DataTable from '../components/DataTable';
import AddAssetModal from '../components/AddAssetModal';
import QRCodeModal from '../components/QRCodeModal';
import ImageViewerModal from '../components/ImageViewerModal';
import TransferAssetModal from '../components/TransferAssetModal';
import AssetHistoryModal from '../components/AssetHistoryModal';
import GlassConfirmModal from '../components/glass/GlassConfirmModal';
import { QrCode, Trash2, Image as ImageIcon, ZoomIn, ArrowRightLeft, History, AlertCircle, RefreshCw, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { useSearchParams } from 'react-router-dom';
import { TableSkeleton } from '../components/loaders/SkeletonLoader';
import WidgetErrorBoundary from '../components/error-boundaries/WidgetErrorBoundary';
import AssetPreviewPanel from '../components/AssetPreviewPanel';
import { useAssetPreview } from '../hooks/useAssetPreview';
import { useHighlight } from '../hooks/useHighlight';
import AssetMiniPreview from '../components/AssetMiniPreview';

export default function AssetList() {
  const [assets, setAssets] = useState([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [qrModalConfig, setQrModalConfig] = useState({ isOpen: false, assetId: '', assetModel: '', assetDept: '' });
  const [viewerConfig, setViewerConfig] = useState({ isOpen: false, url: '', alt: '' });
  const [transferConfig, setTransferConfig] = useState({ isOpen: false, asset: null });
  const [historyConfig, setHistoryConfig] = useState({ isOpen: false, asset: null });
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, assetId: null });
  const { user } = useAuth();
  const isAdmin = user?.role === 'IT Admin';
  const { fetchData, isLoading, error } = useApi();
  const { previewAssetId, openPreview, closePreview, isOpen: isPreviewOpen } = useAssetPreview();
  const [searchParams, setSearchParams] = useSearchParams();
  const { highlightedId } = useHighlight();

  const fetchAssets = useCallback(async () => { const result = await fetchData('/api/assets', {}, { showToast: false }); if (result?.data) setAssets(Array.isArray(result.data) ? result.data : []); }, [fetchData]);
  useEffect(() => { fetchAssets(); }, [fetchAssets]);
  useEffect(() => {
    const previewId = searchParams.get('preview');
    if (previewId) { openPreview(previewId); setSearchParams({}, { replace: true }); }
  }, [searchParams, openPreview, setSearchParams]);

  const handleDelete = async (id) => {
    if (!isAdmin) return;
    setDeleteConfirm({ isOpen: true, assetId: id });
  };

  const confirmDelete = async () => {
    const success = await fetchData(`/api/assets/${deleteConfirm.assetId}`, { method: 'DELETE' }, { showToast: true, successMessage: 'Asset deleted successfully' });
    setDeleteConfirm({ isOpen: false, assetId: null });
    if (success) fetchAssets();
  };

  const columns = [
    { header: 'Photo', accessor: 'image_url', render: (row) => (row.image_url ? (<div className="relative w-12 h-12 group cursor-zoom-in" onClick={() => setViewerConfig({ isOpen: true, url: row.image_url, alt: row.model })}><img src={row.image_url} alt="Hardware" className="w-12 h-12 object-cover rounded-lg border border-white/20 shadow-sm transition-all group-hover:brightness-75" /><div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg bg-black/30"><ZoomIn size={18} className="tt drop-shadow-md" /></div></div>) : (<div className="w-12 h-12 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center tt-muted"><ImageIcon size={18} /></div>)) },
    { header: 'Asset ID', accessor: 'id', render: (row) => <AssetMiniPreview assetId={row.id}><span className="font-bold tt cursor-pointer hover:text-[color:var(--status-info-hi)] transition-colors" onClick={() => openPreview(row.id)}>{row.id}</span></AssetMiniPreview> },
    { header: 'Type', accessor: 'type' }, { header: 'Model/Specs', accessor: 'model' },
    { header: 'Department', accessor: 'dept', render: (row) => row.dept || <span className="tt-muted">Unassigned</span> },
    { header: 'Assigned To', accessor: 'assigned_to', render: (row) => row.assigned_to ? <span className="font-bold glass-badge glass-badge-blue">{row.assigned_to}</span> : <span className="tt-muted italic">Storage</span> },
    { header: 'Status', accessor: 'status', render: (row) => <span className={`glass-badge ${row.status === 'Deployed' ? 'glass-badge-green' : 'glass-badge-gray'}`}>{row.status}</span> },
    { header: 'Actions', render: (row) => (<div className="flex gap-2 items-center">
      {isAdmin && (<button onClick={() => setTransferConfig({ isOpen: true, asset: row })} className="glass-btn p-1.5 text-xs cursor-pointer" title="Transfer"><ArrowRightLeft size={14} /></button>)}
      <button onClick={() => setHistoryConfig({ isOpen: true, asset: row })} className="glass-btn p-1.5 text-xs cursor-pointer" title="History"><History size={14} /></button>
      <button onClick={() => setQrModalConfig({ isOpen: true, assetId: row.id, assetModel: row.model, assetDept: row.dept })} className="glass-btn p-1.5 text-xs cursor-pointer" title="QR Label"><QrCode size={14} /></button>
      <button onClick={() => openPreview(row.id)} className="tt-muted hover:text-[color:var(--status-info)] transition-colors p-1 cursor-pointer" title="Quick Preview"><Eye size={14} /></button>
      {isAdmin && (<button onClick={() => handleDelete(row.id)} className="tt-muted hover:text-[color:var(--status-danger)] transition-colors p-1 cursor-pointer" title="Delete"><Trash2 size={14} /></button>)}
    </div>) }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div><h1 className="text-2xl sm:text-3xl font-bold tt text-glow">Hardware Assets</h1><p className="tt-label mt-0.5 text-xs sm:text-sm">Manage studio inventory and track active deployments.</p></div>
        {isAdmin && (<button onClick={() => setIsAddModalOpen(true)} className="glass-btn glass-btn-primary px-4 py-2 text-xs self-start sm:self-auto">+ Add New Asset</button>)}
      </div>
      {isLoading ? (<TableSkeleton rows={8} columns={8} />) : error ? (
        <div className="glass-card p-6"><div className="flex items-start gap-4"><div className="p-2 rounded-xl bg-[color:var(--status-danger-strong)]/20 text-[color:var(--status-danger-hi)]"><AlertCircle size={24} /></div><div><h3 className="text-lg font-bold tt">Failed to load assets</h3><p className="tt-label mt-2 text-sm">{error.message || 'Something went wrong.'}</p><button onClick={fetchAssets} className="glass-btn glass-btn-primary mt-4 text-xs px-4 py-2"><RefreshCw size={14} /> Retry</button></div></div></div>
      ) : (<WidgetErrorBoundary fallbackText="Failed to load asset table"><DataTable columns={columns} data={assets} searchPlaceholder="Search by ID, model, or user..." highlightId={highlightedId} /></WidgetErrorBoundary>)}
      <AddAssetModal isOpen={isAddModalOpen} onClose={() => { setIsAddModalOpen(false); fetchAssets(); }} />
      <QRCodeModal isOpen={qrModalConfig.isOpen} assetId={qrModalConfig.assetId} assetModel={qrModalConfig.assetModel} assetDept={qrModalConfig.assetDept} onClose={() => setQrModalConfig({ isOpen: false, assetId: '', assetModel: '', assetDept: '' })} />
      <ImageViewerModal isOpen={viewerConfig.isOpen} imageUrl={viewerConfig.url} altText={viewerConfig.alt} onClose={() => setViewerConfig({ isOpen: false, url: '', alt: '' })} />
      <TransferAssetModal isOpen={transferConfig.isOpen} asset={transferConfig.asset} onClose={() => { setTransferConfig({ isOpen: false, asset: null }); fetchAssets(); }} />
      <AssetPreviewPanel assetId={previewAssetId} isOpen={isPreviewOpen} onClose={closePreview}
        onTransfer={(a) => setTransferConfig({ isOpen: true, asset: a })}
        onHistory={(a) => setHistoryConfig({ isOpen: true, asset: a })}
        onQRCode={(a) => setQrModalConfig({ isOpen: true, assetId: a.id, assetModel: a.model, assetDept: a.dept })}
        onDelete={(a) => handleDelete(a.id)} />
      <AssetHistoryModal isOpen={historyConfig.isOpen} asset={historyConfig.asset} onClose={() => setHistoryConfig({ isOpen: false, asset: null })} />
      <GlassConfirmModal
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, assetId: null })}
        onConfirm={confirmDelete}
        title="Delete Asset"
        message="Are you sure you want to permanently delete this asset? This action cannot be undone."
        confirmText="Delete Asset"
        variant="danger"
      />
    </div>
  );
}
