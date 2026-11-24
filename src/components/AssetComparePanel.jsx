import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ArrowLeftRight, Image as ImageIcon, AlertCircle, Loader2 } from 'lucide-react';
import { DYNAMIC_FIELDS } from '../utils/dynamicFields';
import { getStoredToken } from '../utils/appStorage';
import ModalPortal from './ModalPortal';
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const backdropVariants = { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } };
const panelVariants = {
  hidden: { y: '100%', opacity: 0.5 },
  visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 } },
  exit: { y: '100%', opacity: 0, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
};

const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } } };
const staggerItem = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 30, mass: 0.6 } },
};

async function fetchAsset(id) {
  const token = getStoredToken();
  const res = await fetch(`${BASE_URL}/api/assets/${encodeURIComponent(id)}/preview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

function SpecRow({ label: _label, left, right }) {
  const isDifferent = left !== right;
  return (
    <div className={`grid grid-cols-2 gap-4 py-2 border-b ${isDifferent ? 'bg-[color:var(--status-info-strong)]/5' : ''}`} style={{ borderColor: 'var(--glass-border-subtle)' }}>
      <div className="text-[11px] truncate" style={{ color: 'var(--text-on-glass-secondary)' }}>{left || <span style={{ color: 'var(--text-on-glass-muted)' }}>—</span>}</div>
      <div className="text-[11px] font-bold truncate" style={{ color: isDifferent ? 'var(--badge-blue-text)' : 'var(--text-on-glass)' }}>{right || <span style={{ color: 'var(--text-on-glass-muted)' }}>—</span>}</div>
    </div>
  );
}

export default function AssetComparePanel({ assetIdA, assetIdB, isOpen, onClose }) {
    const [assetA, setAssetA] = useState(null);
  const [assetB, setAssetB] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !assetIdA || !assetIdB) return;
    setLoading(true);
    setError(null);
    Promise.all([fetchAsset(assetIdA), fetchAsset(assetIdB)])
      .then(([a, b]) => {
        if (!a || !b) setError('One or both assets not found.');
        else { setAssetA(a); setAssetB(b); }
      })
      .catch(() => setError('Failed to load assets.'))
      .finally(() => setLoading(false));
  }, [isOpen, assetIdA, assetIdB]);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  const statusBadge = (s) => s === 'Deployed' ? 'glass-badge-green' : s === 'In Repair' ? 'glass-badge-amber' : s === 'Retired' ? 'glass-badge-red' : 'glass-badge-gray';

  const dynamicFields = assetA?.type ? (DYNAMIC_FIELDS[assetA.type] || []) : [];

  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div key="cb" variants={backdropVariants} initial="hidden" animate="visible" exit="exit" transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[85] bg-black/30 backdrop-blur-md" onClick={onClose} />
            <motion.div key="cp" variants={panelVariants} initial="hidden" animate="visible" exit="exit"
              className="fixed bottom-0 left-0 right-0 z-[88] max-h-[80vh] flex flex-col"
              style={{
                background: 'var(--modal-bg)',
                backdropFilter: 'blur(40px) saturate(200%)',
                WebkitBackdropFilter: 'blur(40px) saturate(200%)',
                borderTop: '1px solid var(--glass-border)',
                boxShadow: '0 -8px 48px rgba(0,0,0,0.25)',
                borderRadius: '20px 20px 0 0',
              }}>
              {/* Header */}
              <div className="relative z-10 shrink-0 flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--glass-border-subtle)' }}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-[color:var(--ui-indigo-strong)]/30 to-[color:var(--ui-purple-strong)]/20">
                    <ArrowLeftRight size={20} className="text-[color:var(--ui-indigo-hi)]" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold" style={{ color: 'var(--text-heading)' }}>Asset Comparison</h2>
                    <p className="text-[11px]" style={{ color: 'var(--text-on-glass-muted)' }}>
                      {assetIdA} vs {assetIdB}
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 rounded-full transition-all cursor-pointer" style={{ color: 'var(--text-on-glass-muted)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--nav-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}><X size={20} /></button>
              </div>

              {/* Content */}
              <div className="relative z-10 flex-1 overflow-y-auto p-5">
                {loading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-[color:var(--status-info)]" /></div>
                ) : error ? (
                  <div className="text-center py-12"><AlertCircle size={32} className="text-[color:var(--status-danger)]/50 mx-auto mb-3" /><p className="text-sm font-bold tt-sec">{error}</p></div>
                ) : assetA && assetB ? (
                  <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-4">
                    {/* Column headers */}
                    <motion.div variants={staggerItem} className="grid grid-cols-2 gap-4 mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/5 border border-white/10 shrink-0">
                          {assetA.image_url ? <img src={`${BASE_URL}${assetA.image_url}`} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon size={16} className="tt-muted" /></div>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-black truncate" style={{ color: 'var(--text-heading)' }}>{assetA.id}</p>
                          <span className={`glass-badge ${statusBadge(assetA.status)} text-[9px]`}>{assetA.status}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/5 border border-white/10 shrink-0">
                          {assetB.image_url ? <img src={`${BASE_URL}${assetB.image_url}`} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon size={16} className="tt-muted" /></div>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-black truncate" style={{ color: 'var(--text-heading)' }}>{assetB.id}</p>
                          <span className={`glass-badge ${statusBadge(assetB.status)} text-[9px]`}>{assetB.status}</span>
                        </div>
                      </div>
                    </motion.div>

                    <motion.div variants={staggerItem} className="rounded-xl overflow-hidden border border-white/10" style={{ background: 'var(--glass-bg-subtle)' }}>
                      <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--glass-border-subtle)' }}>
                        <h4 className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-on-glass-muted)' }}>Core Details</h4>
                      </div>
                      <div className="px-4">
                        <SpecRow label="Type" left={assetA.type} right={assetB.type} />
                        <SpecRow label="Model" left={assetA.model} right={assetB.model} />
                        <SpecRow label="Serial" left={assetA.serial_number} right={assetB.serial_number} />
                        <SpecRow label="Department" left={assetA.dept} right={assetB.dept} />
                        <SpecRow label="Assigned To" left={assetA.assigned_to} right={assetB.assigned_to} />
                        <SpecRow label="Purchase Date" left={assetA.purchase_date} right={assetB.purchase_date} />
                      </div>
                    </motion.div>

                    {dynamicFields.length > 0 && (
                        <motion.div variants={staggerItem} className="rounded-xl overflow-hidden border border-white/10" style={{ background: 'var(--glass-bg-subtle)' }}>
                          <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--glass-border-subtle)' }}>
                            <h4 className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--badge-blue-text)' }}>Technical Specs</h4>
                          </div>
                          <div className="px-4">
                            {dynamicFields.map(f => (
                              <SpecRow key={f.key} label={f.label} left={assetA.custom_attributes?.[f.key]} right={assetB.custom_attributes?.[f.key]} />
                            ))}
                          </div>
                        </motion.div>
                      )}
                  </motion.div>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
