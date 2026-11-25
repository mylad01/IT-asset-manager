import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Eye, X, Search, ArrowRightLeft, QrCode, History, Trash2,
  User, Clock, Tag, HardDrive, Image as ImageIcon, AlertCircle,
  Loader2, Ticket, ScanBarcode, ArrowLeftRight, Archive,
  ShieldCheck
} from 'lucide-react';
import { DYNAMIC_FIELDS } from '../utils/dynamicFields';
import { getStoredToken } from '../utils/appStorage';
import AssignmentWarning from './AssignmentWarning';
import ModalPortal from './ModalPortal';
import { useAuth } from '../context/AuthContext';
import BulkScanBar from './BulkScanBar';
import AssetComparePanel from './AssetComparePanel';
import AssetTimeline from './AssetTimeline';
import { getApiBaseUrl } from '../utils/apiBase';

const BASE_URL = getApiBaseUrl();

// ── Animation Variants ──────────────────────────────────────────────
const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const panelVariants = {
  hidden: { x: '100%', opacity: 0.5 },
  visible: {
    x: 0,
    opacity: 1,
    transition: { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 },
  },
  exit: {
    x: '100%',
    opacity: 0,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
  },
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { dateStyle: 'medium' });
}

function isExpired(dateStr) {
  return new Date(dateStr) < new Date();
}

const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05, delayChildren: 0.15 },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 30, mass: 0.6 },
  },
};

// ── Loading Skeleton ────────────────────────────────────────────────
function PanelSkeleton() {
  return (
    <div className="animate-pulse space-y-5 p-5">
      <div className="h-48 bg-white/10 rounded-xl" />
      <div className="h-6 bg-white/10 rounded w-1/3" />
      <div className="h-4 bg-white/5 rounded w-1/2" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-10 bg-white/5 rounded-lg" />
        <div className="h-10 bg-white/5 rounded-lg" />
      </div>
      <div className="h-px bg-white/10" />
      <div className="space-y-2">
        <div className="h-3 bg-white/5 rounded w-full" />
        <div className="h-3 bg-white/5 rounded w-3/4" />
      </div>
    </div>
  );
}

// ── Error State ─────────────────────────────────────────────────────
function NotFoundState({ searchTerm }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="p-3 rounded-xl bg-[color:var(--status-danger-strong)]/15 mb-4">
        <AlertCircle size={32} className="text-[color:var(--status-danger)]/60" />
      </div>
      <p className="text-sm font-bold tt-sec mb-1">Asset not found</p>
      <p className="text-xs tt-muted max-w-[240px]">
        {searchTerm
          ? <>No asset matches <strong className="tt-label">"{searchTerm}"</strong>. Verify the ID and try again.</>
          : 'Type an asset ID above to look it up.'}
      </p>
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────────
export default function AssetPreviewPanel({
  assetId,
  isOpen,
  onClose,
  onTransfer,
  onHistory,
  onQRCode,
  onDelete,
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'IT Admin';

  const [searchInput, setSearchInput] = useState('');
  const [activeAssetId, setActiveAssetId] = useState(null);
  const [asset, setAsset] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [scanQueue, setScanQueue] = useState([]);
  const [compareId, setCompareId] = useState(null);
  const [compareInput, setCompareInput] = useState('');
  const [lifecycle, setLifecycle] = useState(null);
  const inputRef = useRef(null);

  // ── Sync external assetId prop ──────────────────────────────────
  useEffect(() => {
    if (isOpen && assetId) {
      setSearchInput(assetId);
      setActiveAssetId(assetId);
      setHasSearched(true);
    } else if (!isOpen) {
      // Reset when panel closes
      setSearchInput('');
      setActiveAssetId(null);
      setAsset(null);
      setError(null);
      setHasSearched(false);
    }
  }, [isOpen, assetId]);

  // ── Fetch asset preview data ────────────────────────────────────
  const fetchPreview = useCallback(async (id) => {
    if (!id || !id.trim()) return;
    const trimmed = id.trim();
    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const token = getStoredToken();
      const res = await fetch(`${BASE_URL}/api/assets/${encodeURIComponent(trimmed)}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) {
        setAsset(null);
        setError('not_found');
        setScanQueue(prev => prev.map(q => q.id === trimmed ? { ...q, status: 'not_found' } : q));
        setIsLoading(false);
        return;
      }

      if (!res.ok) {
        setAsset(null);
        setError('server');
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      setAsset(data);
      setError(null);
      // Update scan queue status
      setScanQueue(prev => prev.map(q => q.id === trimmed ? { ...q, status: 'scanned' } : q));
    } catch {
      setAsset(null);
      setError('network');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Fetch when activeAssetId changes ────────────────────────────
  useEffect(() => {
    if (activeAssetId) {
      fetchPreview(activeAssetId);
      // Fetch lifecycle data
      (async () => {
        const token = getStoredToken();
        const res = await fetch(`${BASE_URL}/api/assets/${encodeURIComponent(activeAssetId)}/lifecycle`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setLifecycle(await res.json());
        else setLifecycle(null);
      })();
    } else {
      setLifecycle(null);
    }
  }, [activeAssetId, fetchPreview]);

  // ── Keyboard: Escape to close ───────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // ── Focus search input on open ──────────────────────────────────
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Small delay to allow animation to start
      const timer = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ── Search submission ───────────────────────────────────────────
  const handleLookup = (e) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setActiveAssetId(searchInput.trim());
    }
  };

  // ── Quick action handlers ───────────────────────────────────────
  const handleTransfer = () => {
    onClose();
    setTimeout(() => onTransfer?.(asset), 200);
  };

  const handleHistory = () => {
    onClose();
    setTimeout(() => onHistory?.(asset), 200);
  };

  const handleQRCode = () => {
    onClose();
    setTimeout(() => onQRCode?.(asset), 200);
  };

  const handleDelete = () => {
    onClose();
    setTimeout(() => onDelete?.(asset), 200);
  };

  const handleCompare = () => {
    if (asset) setCompareId(asset.id);
  };

  // ── Dynamic custom fields for asset type ────────────────────────
  const dynamicFields = asset?.type ? (DYNAMIC_FIELDS[asset.type] || []) : [];
  const hasCustomAttributes = asset?.custom_attributes && Object.keys(asset.custom_attributes).length > 0;

  // ── Status badge color mapping ──────────────────────────────────
  const statusBadge = (status) => {
    switch (status) {
      case 'Deployed': return 'glass-badge-green';
      case 'In Storage': return 'glass-badge-gray';
      case 'In Repair': return 'glass-badge-amber';
      case 'Retired': return 'glass-badge-red';
      default: return 'glass-badge-gray';
    }
  };

  // ── Render ──────────────────────────────────────────────────────
  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="preview-backdrop"
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[90] bg-black/30 backdrop-blur-md"
              onClick={onClose}
            />

            {/* Panel */}
            <motion.div
              key="preview-panel"
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="fixed top-0 right-0 bottom-0 z-[95] w-[420px] max-md:w-full flex flex-col"
              style={{
                background: 'var(--modal-bg)',
                backdropFilter: 'blur(40px) saturate(200%)',
                WebkitBackdropFilter: 'blur(40px) saturate(200%)',
                borderLeft: '1px solid var(--glass-border)', boxShadow: '-8px 0 48px rgba(0,0,0,0.25)'
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-white/[0.02] pointer-events-none z-[1]" />

              {/* Header */}
              <div className="relative z-10 shrink-0 flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--glass-border-subtle)' }}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-[color:var(--status-info-strong)]/30 to-[color:var(--ui-purple-strong)]/20"><Eye size={20} className="text-[color:var(--status-info-hi)]" /></div>
                  <div>
                    <h2 className="text-base font-bold" style={{ color: 'var(--text-heading)' }}>Asset Quick Preview</h2>
                    <p className="text-[11px]" style={{ color: 'var(--text-on-glass-muted)' }}>Look up or preview any asset</p>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={() => setBulkMode(!bulkMode)} className={`p-2 rounded-full transition-all cursor-pointer ${bulkMode ? 'bg-[color:var(--status-info-strong)]/20 text-[color:var(--status-info-hi)]' : ''}`} style={{ color: bulkMode ? undefined : 'var(--text-on-glass-muted)' }} title="Bulk Scan Mode">
                    <ScanBarcode size={18} />
                  </button>
                )}
                <button onClick={onClose} className="p-2 rounded-full transition-all cursor-pointer" style={{ color: 'var(--text-on-glass-muted)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--nav-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}><X size={20} /></button>
              </div>
              {/* Bulk Scan Mode */}
              {bulkMode && isAdmin && (
                <BulkScanBar
                  onScan={(id) => {
                    setActiveAssetId(id);
                    setScanQueue(prev => {
                      const exists = prev.find(q => q.id === id);
                      if (exists) return prev;
                      return [...prev, { id, status: 'pending' }];
                    });
                  }}
                  queue={scanQueue}
                  currentId={activeAssetId}
                  onClear={() => setScanQueue([])}
                />
              )}
              {/* Search Bar */}
              <div className="relative z-10 shrink-0 p-4 border-b" style={{ borderColor: 'var(--glass-border-subtle)' }}>
                <form onSubmit={handleLookup} className="flex gap-2">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-on-glass-muted)' }} />
                    <input ref={inputRef} type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Type asset ID (e.g. PC-VFX-001)..." className="glass-input pl-10 pr-4 py-2.5 text-sm" />
                  </div>
                  <button type="submit" disabled={!searchInput.trim() || isLoading}
                    className="glass-btn glass-btn-primary px-4 py-2.5 text-xs flex items-center gap-2 disabled:opacity-40 cursor-pointer shrink-0">
                    {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Look Up
                  </button>
                </form>
              </div>
              {/* Content */}
              <div className="relative z-10 flex-1 overflow-y-auto">
                {isLoading ? <PanelSkeleton /> : error ? <NotFoundState searchTerm={hasSearched ? searchInput : ''} /> : asset ? (
                  <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-0">
                    {asset.assigned_to && (<motion.div variants={staggerItem} className="p-5 pb-0"><AssignmentWarning userName={asset.assigned_to} department={asset.dept} /></motion.div>)}
                    <motion.div variants={staggerItem} className="px-5 pt-5">
                      <div className="relative rounded-xl overflow-hidden bg-white/5 border border-white/10">
                        {asset.image_url ? <img src={`${BASE_URL}${asset.image_url}`} alt={asset.model} className="w-full h-48 object-cover" /> : <div className="w-full h-48 flex items-center justify-center"><ImageIcon size={40} className="tt-muted" /></div>}
                        <div className="absolute bottom-3 left-3"><span className={`glass-badge ${statusBadge(asset.status)} text-[11px] shadow-lg`}>{asset.status}</span></div>
                        {asset.ticketCount > 0 && <div className="absolute top-3 right-3"><span className="glass-badge glass-badge-red text-[10px] shadow-lg flex items-center gap-1"><Ticket size={10} /> {asset.ticketCount} open</span></div>}
                      </div>
                    </motion.div>
                    <motion.div variants={staggerItem} className="px-5 pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-lg font-black tracking-tight truncate mb-1" style={{ color: 'var(--text-heading)' }}>{asset.id}</h3>
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-on-glass-secondary)' }}>{asset.model}</p>
                        </div>
                        <span className="glass-badge glass-badge-blue text-[10px] shrink-0"><Tag size={10} /> {asset.type}</span>
                      </div>
                      {asset.serial_number && <div className="flex items-center gap-2 mt-2"><HardDrive size={12} style={{ color: 'var(--text-on-glass-muted)' }} /><span className="text-xs font-mono" style={{ color: 'var(--text-on-glass-muted)' }}>SN: {asset.serial_number}</span></div>}
                      {asset.purchase_date && <div className="flex items-center gap-2 mt-1"><Clock size={12} style={{ color: 'var(--text-on-glass-muted)' }} /><span className="text-xs" style={{ color: 'var(--text-on-glass-muted)' }}>Purchased: {asset.purchase_date}</span></div>}
                    {asset.warranty_expiry && <div className="flex items-center gap-2 mt-1"><ShieldCheck size={12} style={{ color: isExpired(asset.warranty_expiry) ? 'var(--badge-red-text)' : 'var(--badge-amber-text)' }} /><span className="text-xs" style={{ color: 'var(--text-on-glass-muted)' }}>Warranty: {formatDate(asset.warranty_expiry)}</span></div>}
                    </motion.div>
                    {(dynamicFields.length > 0 || hasCustomAttributes) && (
                      <motion.div variants={staggerItem} className="px-5 pt-4">
                        <div className="rounded-xl p-4 border border-white/10" style={{ background: 'var(--glass-bg-subtle)' }}>
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3 flex items-center gap-1.5" style={{ color: 'var(--badge-blue-text)' }}><HardDrive size={12} /> Technical Specifications</h4>
                          <div className="space-y-2">
                            {dynamicFields.map((f) => { const v = asset.custom_attributes?.[f.key]; return <div key={f.key} className="flex items-baseline justify-between gap-3"><span className="text-[11px] font-medium shrink-0" style={{ color: 'var(--text-on-glass-muted)' }}>{f.label}</span><span className="text-xs font-bold text-right truncate" style={{ color: 'var(--text-on-glass)' }}>{v || <span style={{ color: 'var(--text-on-glass-muted)' }}>{'\u2014'}</span>}</span></div>; })}
                            {hasCustomAttributes && Object.entries(asset.custom_attributes).map(([k, v]) => { if (dynamicFields.some(f => f.key === k) || !v) return null; return <div key={k} className="flex items-baseline justify-between gap-3"><span className="text-[11px] font-medium shrink-0 capitalize" style={{ color: 'var(--text-on-glass-muted)' }}>{k.replace(/_/g, ' ')}</span><span className="text-xs font-bold text-right truncate" style={{ color: 'var(--text-on-glass)' }}>{v}</span></div>; })}
                          </div>
                        </div>
                      </motion.div>
                    )}
                    <motion.div variants={staggerItem} className="px-5 pt-4">
                      <div className="rounded-xl p-4 border border-white/10" style={{ background: 'var(--glass-bg-subtle)' }}>
                        <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3 flex items-center gap-1.5" style={{ color: asset.assigned_to ? 'var(--badge-green-text)' : 'var(--text-on-glass-muted)' }}><User size={12} /> Assignment</h4>
                        {asset.assigned_to ? (
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center tt font-bold text-sm shrink-0" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.5), rgba(168,85,247,0.5))' }}>{asset.assigned_to.charAt(0)}</div>
                            <div className="min-w-0"><p className="text-sm font-bold truncate" style={{ color: 'var(--text-on-glass)' }}>{asset.assigned_to}</p><p className="text-[11px] truncate" style={{ color: 'var(--text-on-glass-muted)' }}>{asset.dept || 'No Department'}</p></div>
                          </div>
                        ) : <div className="flex items-center gap-2"><div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--glass-bg)' }}><Archive size={16} style={{ color: 'var(--text-on-glass-muted)' }} /></div><p className="text-sm" style={{ color: 'var(--text-on-glass-muted)' }}>In Storage — Unassigned</p></div>}
                      </div>
                    </motion.div>
                    {lifecycle?.milestones?.length > 0 && (
                      <motion.div variants={staggerItem} className="px-5 pt-4">
                        <div className="rounded-xl p-4 border border-white/10" style={{ background: 'var(--glass-bg-subtle)' }}>
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-4 flex items-center gap-1.5" style={{ color: 'var(--badge-blue-text)' }}><Clock size={12} /> Lifecycle Timeline</h4>
                          <AssetTimeline milestones={lifecycle.milestones} />
                        </div>
                      </motion.div>
                    )}
                    {asset.latestTransaction && (
                      <motion.div variants={staggerItem} className="px-5 pt-4">
                        <div className="rounded-xl p-4 border border-white/10" style={{ background: 'var(--glass-bg-subtle)' }}>
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3 flex items-center gap-1.5" style={{ color: 'var(--badge-blue-text)' }}><History size={12} /> Latest Activity</h4>
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className={`glass-badge text-[10px] ${asset.latestTransaction.action_type === 'TRANSFER' ? 'glass-badge-blue' : asset.latestTransaction.action_type === 'MAINTENANCE' ? 'glass-badge-orange' : 'glass-badge-gray'}`}>{asset.latestTransaction.action_type}</span>
                              <span className="text-[11px]" style={{ color: 'var(--text-on-glass-muted)' }}>{new Date(asset.latestTransaction.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                            </div>
                            {asset.latestTransaction.user_name && <p className="text-xs" style={{ color: 'var(--text-on-glass-secondary)' }}>By: <strong>{asset.latestTransaction.user_name}</strong></p>}
                            {asset.latestTransaction.notes && <p className="text-xs italic bg-white/5 rounded-lg p-2 border border-white/5" style={{ color: 'var(--text-on-glass-muted)' }}>"{asset.latestTransaction.notes}"</p>}
                          </div>
                        </div>
                      </motion.div>
                    )}
                    <div className="h-4" />
                  </motion.div>
                ) : <NotFoundState searchTerm="" />}
              </div>
              {/* Quick Actions Footer */}
              {asset && !isLoading && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.3 }}
                  className="relative z-10 shrink-0 p-4 border-t flex items-center gap-2" style={{ borderColor: 'var(--glass-border-subtle)', background: 'rgba(0,0,0,0.08)' }}>
                  <button onClick={handleQRCode} className="glass-btn px-3 py-2 text-[11px] flex items-center gap-1.5 cursor-pointer" title="QR Code"><QrCode size={13} /><span className="max-md:hidden">QR Code</span></button>
                  <button onClick={handleHistory} className="glass-btn px-3 py-2 text-[11px] flex items-center gap-1.5 cursor-pointer" title="History"><History size={13} /><span className="max-md:hidden">History</span></button>
                  {isAdmin && <>
                    <button onClick={handleCompare} className="glass-btn px-3 py-2 text-[11px] flex items-center gap-1.5 cursor-pointer" title="Compare with another asset"><ArrowLeftRight size={13} /><span className="max-md:hidden">Compare</span></button>
                    <button onClick={handleTransfer} className="glass-btn glass-btn-primary px-3 py-2 text-[11px] flex items-center gap-1.5 cursor-pointer" title="Transfer"><ArrowRightLeft size={13} /><span className="max-md:hidden">Transfer</span></button>
                    <button onClick={handleDelete} className="glass-btn glass-btn-danger px-3 py-2 text-[11px] flex items-center gap-1.5 cursor-pointer ml-auto" title="Delete"><Trash2 size={13} /><span className="max-md:hidden">Delete</span></button>
                  </>}
                </motion.div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <AssetComparePanel assetIdA={compareId} assetIdB={compareInput || null} isOpen={!!compareId} onClose={() => { setCompareId(null); setCompareInput(''); }} />
      {compareId && !compareInput && (
        <div className="fixed inset-0 z-[89] flex items-center justify-center" onClick={() => { setCompareId(null); setCompareInput(''); }}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative glass-modal max-w-sm w-full mx-4 p-6" onClick={e => e.stopPropagation()} style={{ borderRadius: '20px' }}>
            <h3 className="text-base font-bold mb-3" style={{ color: 'var(--text-heading)' }}>Compare With...</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-on-glass-muted)' }}>Enter the asset ID to compare against {compareId}:</p>
            <input type="text" autoFocus className="glass-input mb-4" placeholder="e.g. PC-VFX-002" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) setCompareInput(e.target.value.trim()); }} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setCompareId(null); setCompareInput(''); }} className="glass-btn px-4 py-2 text-xs">Cancel</button>
              <button onClick={() => { const inp = document.querySelector('.glass-modal input[type=text]'); if (inp?.value.trim()) setCompareInput(inp.value.trim()); }} className="glass-btn glass-btn-primary px-4 py-2 text-xs">Compare</button>
            </div>
          </div>
        </div>
      )}
    </ModalPortal>
  );
}
