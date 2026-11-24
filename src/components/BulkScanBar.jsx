import React, { useState, useRef } from 'react';
import { ScanBarcode, Plus, CheckCircle2 } from 'lucide-react';

/**
 * Bulk scan input bar shown when the panel is in "Bulk Scan" mode.
 * Lets admins queue multiple asset IDs and step through them.
 *
 * Props:
 *   onScan    — callback(assetId) when user submits an ID
 *   queue     — array of { id, status: 'pending'|'scanned'|'not_found' }
 *   onClear   — callback to clear the queue
 *   currentId — the currently active asset ID being previewed
 */
export default function BulkScanBar({ onScan, queue, onClear, currentId }) {
  const [input, setInput] = useState('');
  const inputRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) {
      onScan(input.trim());
      setInput('');
      inputRef.current?.focus();
    }
  };

  const scanned = queue.filter(q => q.status === 'scanned').length;
  const notFound = queue.filter(q => q.status === 'not_found').length;

  return (
    <div className="px-4 pb-3 space-y-2">
      {/* Scan input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-on-glass-muted)' }} />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Scan or type next asset ID..."
            className="glass-input pl-9 pr-3 py-2 text-xs"
          />
        </div>
        <button type="submit" disabled={!input.trim()} className="glass-btn glass-btn-primary px-3 py-2 text-[11px] flex items-center gap-1 disabled:opacity-40 cursor-pointer">
          <Plus size={12} /> Add
        </button>
      </form>

      {/* Queue summary */}
      {queue.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-on-glass-muted)' }}>
            Queue:
          </span>
          <div className="flex items-center gap-1 flex-wrap">
            {queue.map((item, i) => (
              <span
                key={`${item.id}-${i}`}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border cursor-pointer transition-all ${
                  item.id === currentId ? 'ring-2 ring-[color:var(--status-info)]/50 ' : ''
                }${
                  item.status === 'scanned' ? 'bg-[color:var(--status-success-strong)]/20 border-[color:var(--status-success)]/30 text-[color:var(--status-success-hi)]' :
                  item.status === 'not_found' ? 'bg-[color:var(--status-danger-strong)]/20 border-[color:var(--status-danger)]/30 text-[color:var(--status-danger-hi)]' :
                  'bg-white/5 border-white/15 tt-label'
                }`}
                title={item.status === 'scanned' ? 'Scanned' : item.status === 'not_found' ? 'Not found' : 'Pending'}
              >
                {item.status === 'scanned' ? <CheckCircle2 size={9} className="inline mr-0.5" /> : null}
                {item.id}
              </span>
            ))}
          </div>
          <span className="text-[10px] ml-auto" style={{ color: 'var(--text-on-glass-muted)' }}>
            {scanned}/{queue.length} scanned{notFound > 0 ? ` · ${notFound} not found` : ''}
          </span>
          <button onClick={onClear} className="text-[10px] font-bold hover:text-[color:var(--status-danger)] transition-colors cursor-pointer" style={{ color: 'var(--text-on-glass-muted)' }}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
