import React, { useState, useEffect, useCallback } from 'react';
import { X, History, ArrowRight, PenLine, Send } from 'lucide-react';
import api from '../utils/apiClient';
import AssetTimeline from './AssetTimeline';
import ModalPortal from './ModalPortal';
import ScrollArea from './glass/ScrollArea';
import toast from 'react-hot-toast';

export default function AssetHistoryModal({ isOpen, asset, onClose }) {
  const [history, setHistory] = useState([]);
  const [lifecycle, setLifecycle] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [newLogNote, setNewLogNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchTimeline = useCallback(async () => {
    if (!asset?.id) return;
    setIsLoading(true);
    const [historyRes, lifecycleRes] = await Promise.all([
      api.get(`/api/assets/${asset.id}/history`, { showToast: false }),
      api.get(`/api/assets/${asset.id}/lifecycle`, { showToast: false }),
    ]);
    setHistory(historyRes.ok && Array.isArray(historyRes.data) ? historyRes.data : []);
    setLifecycle(lifecycleRes.ok ? lifecycleRes.data : null);
    setIsLoading(false);
  }, [asset?.id]);

  useEffect(() => { if (isOpen) fetchTimeline(); }, [isOpen, fetchTimeline]);

  const handleAddLog = async (e) => {
    e.preventDefault();
    if (!newLogNote.trim()) return;
    setIsSubmitting(true);
    const { ok, error: err } = await api.post(`/api/assets/${asset.id}/log`, { notes: newLogNote, action_type: 'MAINTENANCE' });
    if (ok) {
      setNewLogNote('');
      fetchTimeline();
      toast.success('Note added to history');
    } else {
      toast.error(err || 'Failed to add note');
    }
    setIsSubmitting(false);
  };

  if (!isOpen || !asset) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
      <div className="relative glass-modal max-w-2xl w-full animate-glass-in flex flex-col h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
        <div className="relative z-20 flex items-center justify-between p-5 border-b border-white/10 shrink-0 bg-gradient-to-r from-[color:var(--status-info-strong)]/30 to-[color:var(--ui-purple-strong)]/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/10"><History size={22} className="tt" /></div>
            <div><h2 className="text-lg font-bold tt">Chain of Custody Log</h2><p className="tt-label text-sm">{asset.model} ({asset.id})</p></div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full tt-label hover:tt hover:bg-white/15 transition-all cursor-pointer"><X size={20} /></button>
        </div>

        <ScrollArea className="z-20 flex-1" contentClassName="p-6 bg-white/[0.02]">
          {isLoading ? (
            <div className="text-center py-8 tt-muted font-medium">Loading ledger records...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 tt-muted italic">No records found for this asset.</div>
          ) : (
            <>
              {/* Lifecycle Timeline Overview */}
              {lifecycle?.milestones?.length > 0 && (
                <div className="mb-6 p-4 rounded-xl border border-white/10" style={{ background: 'var(--glass-bg-subtle)' }}>
                  <h3 className="text-xs font-bold uppercase tracking-wider tt-label mb-3">Lifecycle Timeline</h3>
                  <AssetTimeline milestones={lifecycle.milestones} />
                </div>
              )}

              {/* Detailed Chain of Custody Log */}
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/15 before:to-transparent">
                {history.map((log) => (
                  <div key={log.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-[rgba(20,20,40,0.75)] tt shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 ${log.action_type === 'MAINTENANCE' ? 'bg-[color:var(--status-warning-strong)]/80' : 'bg-[color:var(--status-info-strong)]/80'}`}>
                      {log.action_type === 'MAINTENANCE' ? <PenLine size={14} /> : <ArrowRight size={14} className="md:group-odd:rotate-180" />}
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] glass-card p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`font-bold text-xs uppercase tracking-wider ${log.action_type === 'MAINTENANCE' ? 'text-[color:var(--status-warning-hi)]' : 'text-[color:var(--status-info-hi)]'}`}>{log.action_type}</span>
                        <time className="text-xs tt-muted font-medium">{new Date(log.timestamp).toLocaleString()}</time>
                      </div>
                      <div className="text-sm font-bold tt mb-1">Target: {log.user_name || <span className="tt-muted italic">Storage Room</span>}</div>
                      {log.notes && (<div className="text-sm tt-label bg-white/5 p-2 rounded-lg border border-white/5 mt-2 italic">"{log.notes}"</div>)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </ScrollArea>

        <div className="relative z-20 p-4 border-t border-white/10 shrink-0 bg-white/5">
          <form onSubmit={handleAddLog} className="flex gap-2">
            <input type="text" placeholder="Add a manual maintenance or audit note..." value={newLogNote} onChange={(e) => setNewLogNote(e.target.value)} className="flex-1 glass-input" required />
            <button type="submit" disabled={isSubmitting || !newLogNote.trim()} className="glass-btn glass-btn-primary px-4 py-2 flex items-center gap-2 disabled:opacity-50 transition-colors text-xs cursor-pointer"><Send size={14} /> Save Note</button>
          </form>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
