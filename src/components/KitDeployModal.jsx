import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, Zap, AlertTriangle, CheckCircle2, Package, Search,
  Image as ImageIcon, Loader2, ChevronDown, ChevronUp
} from 'lucide-react';
import ModalPortal from './ModalPortal';
import ScrollArea from './glass/ScrollArea';
import api from '../utils/apiClient';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const backdropVariants = { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } };
const panelVariants = {
  hidden: { y: '100%', opacity: 0.5 },
  visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 } },
  exit: { y: '100%', opacity: 0, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
};

/**
 * KitDeployModal
 *
 * Shows available assets for each component type in a kit.
 * The admin selects which specific assets to assign before deploying.
 *
 * Props:
 *   kitId       — ID of the kit to deploy
 *   kitName     — display name
 *   userId      — target user ID
 *   deptId      — target department ID
 *   isOpen      — modal visibility
 *   onClose     — callback when closed
 *   onDeployed  — callback after successful deploy
 */
export default function KitDeployModal({ kitId, kitName, userId, deptId, isOpen, onClose, onDeployed }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState(null);
  // selections: { "Workstation": ["WS-001"], "Camera": ["CAM-001", "CAM-002"] }
  const [selections, setSelections] = useState({});
  const [expandedTypes, setExpandedTypes] = useState({});
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch kit preview when opened
  useEffect(() => {
    if (!isOpen || !kitId) return;
    setLoading(true);
    setError(null);
    setSelections({});
    setExpandedTypes({});
    setSearchQuery('');

    const fetchPreview = async () => {
      const { ok, data, error: err } = await api.get(`/api/kits/${kitId}/preview`, { showToast: false });
      if (ok && data) {
        setPreview(data);
        // Pre-expand types that have shortages
        const expanded = {};
        data.components?.forEach(c => {
          expanded[c.asset_type] = true;
        });
        setExpandedTypes(expanded);
      } else {
        setError(err || 'Failed to load kit details.');
      }
      setLoading(false);
    };
    fetchPreview();
  }, [isOpen, kitId]);

  // Toggle asset selection
  const toggleAsset = (assetType, assetId) => {
    setSelections(prev => {
      const current = prev[assetType] || [];
      const next = current.includes(assetId)
        ? current.filter(id => id !== assetId)
        : [...current, assetId];
      return { ...prev, [assetType]: next };
    });
  };

  // Auto-select first N assets for a type
  const autoSelect = (assetType, count) => {
    const comp = preview?.components?.find(c => c.asset_type === assetType);
    if (!comp) return;
    const autoIds = comp.available.slice(0, count).map(a => a.id);
    setSelections(prev => ({ ...prev, [assetType]: autoIds }));
  };

  // Toggle expand/collapse for a type
  const toggleExpand = (assetType) => {
    setExpandedTypes(prev => ({ ...prev, [assetType]: !prev[assetType] }));
  };

  // Handle deploy
  const handleDeploy = async () => {
    setDeploying(true);
    const { ok, data, error: err } = await api.post(`/api/kits/${kitId}/deploy`, {
      user_id: userId,
      dept_id: deptId,
      asset_selections: selections,
    });
    setDeploying(false);
    if (ok) {
      onDeployed?.(data);
      onClose();
    } else {
      setError(err || 'Deployment failed.');
    }
  };

  // Count total selected across all types
  const totalSelected = Object.values(selections).reduce((sum, arr) => sum + arr.length, 0);
  const totalRequested = preview?.components?.reduce((sum, c) => sum + c.requested, 0) || 0;

  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div key="kdm-backdrop" variants={backdropVariants} initial="hidden" animate="visible" exit="exit"
              transition={{ duration: 0.2 }} className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-md" onClick={onClose} />
            <motion.div key="kdm-panel" variants={panelVariants} initial="hidden" animate="visible" exit="exit"
              className="fixed bottom-0 left-0 right-0 z-[105] max-h-[85vh] flex flex-col"
              style={{
                background: 'var(--modal-bg)', backdropFilter: 'blur(40px) saturate(200%)',
                WebkitBackdropFilter: 'blur(40px) saturate(200%)',
                borderTop: '1px solid var(--glass-border)', boxShadow: '0 -8px 48px rgba(0,0,0,0.25)',
                borderRadius: '20px 20px 0 0',
              }}>

              {/* Header */}
              <div className="relative z-10 shrink-0 flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--glass-border-subtle)' }}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-[color:var(--status-info-strong)]/30 to-[color:var(--ui-purple-strong)]/20">
                    <Package size={20} className="text-[color:var(--status-info-hi)]" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold" style={{ color: 'var(--text-heading)' }}>Deploy: {kitName}</h2>
                    <p className="text-[11px]" style={{ color: 'var(--text-on-glass-muted)' }}>Select which assets to assign</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 rounded-full transition-all cursor-pointer"
                  style={{ color: 'var(--text-on-glass-muted)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--nav-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <ScrollArea className="z-10 flex-1" contentClassName="p-5">
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 size={24} className="animate-spin text-[color:var(--status-info)]" />
                    <span className="ml-3 text-sm" style={{ color: 'var(--text-on-glass-muted)' }}>Loading available assets...</span>
                  </div>
                ) : error ? (
                  <div className="text-center py-12">
                    <AlertTriangle size={32} className="text-[color:var(--status-danger)]/50 mx-auto mb-3" />
                    <p className="text-sm font-bold tt-sec">{error}</p>
                  </div>
                ) : preview ? (
                  <div className="space-y-4">
                    {/* Summary bar */}
                    <div className="p-3 rounded-xl border space-y-3" style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-border-subtle)' }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-on-glass-muted)' }}>Selection</span>
                          <span className="text-sm font-bold" style={{ color: totalSelected >= totalRequested ? 'var(--badge-green-text)' : 'var(--badge-blue-text)' }}>
                            {totalSelected}/{totalRequested} assets
                          </span>
                        </div>
                        <button onClick={() => {
                        // Auto-select all needed
                        const auto = {};
                        preview.components.forEach(c => {
                          auto[c.asset_type] = c.available.slice(0, c.requested).map(a => a.id);
                        });
                        setSelections(auto);
                      }} className="text-[11px] font-bold px-3 py-1 rounded-lg transition-all cursor-pointer hover:bg-white/10"
                        style={{ color: 'var(--badge-blue-text)' }}>
                        Auto-Fill
                      </button>
                      </div>
                      {/* Search bar */}
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-on-glass-muted)' }} />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search assets by ID, model, or serial number..."
                          className="glass-input pl-9 pr-3 py-2 text-xs w-full"
                        />
                      </div>
                    </div>

                    {/* Component rows */}
                    {preview.components.map((comp, idx) => {
                      const selected = selections[comp.asset_type] || [];
                      // Filter assets by search query
                      const q = searchQuery.toLowerCase().trim();
                      const filteredAssets = q
                        ? comp.available.filter(a =>
                            a.id.toLowerCase().includes(q) ||
                            a.model?.toLowerCase().includes(q) ||
                            a.serial_number?.toLowerCase().includes(q)
                          )
                        : comp.available;
                      const isExpanded = expandedTypes[comp.asset_type];
                      const hasShortfall = comp.shortfall > 0;
                      const allSelected = selected.length >= comp.requested;

                      return (
                        <motion.div key={comp.asset_type + idx}
                          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="rounded-xl border overflow-hidden"
                          style={{ background: 'var(--glass-bg-subtle)', borderColor: allSelected ? 'rgba(52,211,153,0.3)' : 'var(--glass-border-subtle)' }}>

                          {/* Type header */}
                          <button onClick={() => toggleExpand(comp.asset_type)}
                            className="w-full flex items-center justify-between p-4 text-left cursor-pointer hover:bg-white/5 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className={`p-1.5 rounded-lg ${allSelected ? 'bg-[color:var(--status-success-strong)]/20' : 'bg-white/10'}`}>
                                {allSelected ? <CheckCircle2 size={16} className="text-[color:var(--status-success)]" /> :
                                  <Package size={16} style={{ color: 'var(--text-on-glass-muted)' }} />}
                              </div>
                              <div>
                                <p className="text-sm font-bold" style={{ color: 'var(--text-heading)' }}>{comp.asset_type}</p>
                                <p className="text-[10px]" style={{ color: 'var(--text-on-glass-muted)' }}>
                                  Need {comp.requested} · {comp.availableCount} available
                                  {hasShortfall && <span className="text-[color:var(--status-warning)] ml-1">· {comp.shortfall} short</span>}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                                style={{
                                  background: allSelected ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.05)',
                                  color: allSelected ? 'var(--badge-green-text)' : 'var(--text-on-glass-muted)',
                                }}>
                                {selected.length}/{comp.requested}
                              </span>
                              {isExpanded ? <ChevronUp size={14} style={{ color: 'var(--text-on-glass-muted)' }} /> :
                                <ChevronDown size={14} style={{ color: 'var(--text-on-glass-muted)' }} />}
                            </div>
                          </button>

                          {/* Asset list */}
                          {isExpanded && (
                            <div className="px-4 pb-4 space-y-1.5">
                              {comp.available.length === 0 ? (
                                <div className="text-xs py-3 text-center" style={{ color: 'var(--text-on-glass-muted)' }}>
                                  No unassigned assets of this type in storage
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-on-glass-muted)' }}>
                                      {q ? `${filteredAssets.length} matching` : 'Available Assets'}
                                    </span>
                                    <button onClick={(e) => { e.stopPropagation(); autoSelect(comp.asset_type, comp.requested); }}
                                      className="text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer hover:bg-white/10 transition-colors"
                                      style={{ color: 'var(--badge-blue-text)' }}>
                                      Auto-select {comp.requested}
                                    </button>
                                  </div>
                                  {filteredAssets.length === 0 && q ? (
                                    <div className="text-xs py-3 text-center" style={{ color: 'var(--text-on-glass-muted)' }}>
                                      No assets match "{searchQuery}"
                                    </div>
                                  ) : filteredAssets.map(asset => {
                                    const isSelected = selected.includes(asset.id);
                                    // customAttrs intentionally unused — parse reserved for future use
                                    return (
                                      <button key={asset.id} onClick={() => toggleAsset(comp.asset_type, asset.id)}
                                        className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all text-left cursor-pointer ${
                                          isSelected ? 'bg-[color:var(--status-info-strong)]/10 border-[color:var(--status-info)]/30' : 'hover:bg-white/5 border-transparent'
                                        }`}>
                                        {/* Thumbnail */}
                                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 border border-white/10 shrink-0">
                                          {asset.image_url ? (
                                            <img src={`${BASE_URL}${asset.image_url}`} alt="" className="w-full h-full object-cover" />
                                          ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                              <ImageIcon size={14} className="tt-muted" />
                                            </div>
                                          )}
                                        </div>
                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs font-bold truncate" style={{ color: 'var(--text-heading)' }}>{asset.id}</p>
                                          <p className="text-[10px] truncate" style={{ color: 'var(--text-on-glass-secondary)' }}>{asset.model}</p>
                                          {asset.serial_number && (
                                            <p className="text-[9px] font-mono truncate" style={{ color: 'var(--text-on-glass-muted)' }}>SN: {asset.serial_number}</p>
                                          )}
                                        </div>
                                        {/* Checkbox */}
                                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                                          isSelected ? 'bg-[color:var(--status-info-strong)] border-[color:var(--status-info)]' : 'border-white/20'
                                        }`}>
                                          {isSelected && <CheckCircle2 size={12} className="tt" />}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </>
                              )}
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                ) : null}
              </ScrollArea>

              {/* Footer */}
              <div className="relative z-10 shrink-0 p-5 border-t flex items-center justify-between"
                style={{ borderColor: 'var(--glass-border-subtle)', background: 'rgba(0,0,0,0.08)' }}>
                <div className="text-xs" style={{ color: 'var(--text-on-glass-muted)' }}>
                  {totalSelected > 0
                    ? <span><strong style={{ color: 'var(--text-on-glass)' }}>{totalSelected}</strong> of {totalRequested} assets selected</span>
                    : <span>Select at least one asset per component</span>
                  }
                </div>
                <div className="flex gap-2">
                  <button onClick={onClose}
                    className="glass-btn px-4 py-2 text-xs cursor-pointer">
                    Cancel
                  </button>
                  <button onClick={handleDeploy}
                    disabled={deploying || totalSelected === 0}
                    className="glass-btn glass-btn-primary px-5 py-2 text-xs flex items-center gap-2 cursor-pointer disabled:opacity-40">
                    {deploying ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    {deploying ? 'Deploying...' : `Deploy ${totalSelected} Asset${totalSelected !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
