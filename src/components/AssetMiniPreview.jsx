import React, { useState, useEffect, useRef } from 'react';
import { Tag, User } from 'lucide-react';
import { getStoredToken } from '../utils/appStorage';
import { getApiBaseUrl } from '../utils/apiBase';

const BASE_URL = getApiBaseUrl();

/**
 * Lightweight hover tooltip that shows an asset thumbnail, status, and model.
 * Appears after a short delay to avoid flicker on rapid mouse movement.
 *
 * Props:
 *   assetId   — the asset ID to fetch preview data for
 *   children  — the trigger element (usually the Asset ID cell)
 */
export default function AssetMiniPreview({ assetId, children }) {
  const [show, setShow] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const containerRef = useRef(null);

  const statusBadge = (s) => {
    switch (s) {
      case 'Deployed': return 'glass-badge-green';
      case 'In Storage': return 'glass-badge-gray';
      case 'In Repair': return 'glass-badge-amber';
      case 'Retired': return 'glass-badge-red';
      default: return 'glass-badge-gray';
    }
  };

  const fetchMini = async () => {
    if (data) return; // Already cached
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await fetch(`${BASE_URL}/api/assets/${encodeURIComponent(assetId)}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const handleEnter = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setShow(true);
      fetchMini();
    }, 400); // 400ms delay before showing
  };

  const handleLeave = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShow(false), 150);
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {show && (
        <div
          className="absolute z-[200] bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 pointer-events-none"
          onMouseEnter={() => clearTimeout(timerRef.current)}
          onMouseLeave={handleLeave}
        >
          <div
            className="rounded-xl border overflow-hidden shadow-xl"
            style={{
              background: 'var(--modal-bg)',
              backdropFilter: 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              borderColor: 'var(--glass-border)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
          >
            {loading && !data ? (
              <div className="p-3 animate-pulse">
                <div className="h-16 bg-white/10 rounded-lg mb-2" />
                <div className="h-3 bg-white/10 rounded w-2/3" />
              </div>
            ) : data ? (
              <>
                {/* Thumbnail */}
                <div className="h-20 bg-white/5 relative overflow-hidden">
                  {data.image_url ? (
                    <img src={`${BASE_URL}${data.image_url}`} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/15">
                      <Tag size={20} />
                    </div>
                  )}
                  <div className="absolute bottom-1.5 left-1.5">
                    <span className={`glass-badge ${statusBadge(data.status)} text-[9px] px-1.5 py-0.5 shadow-md`}>
                      {data.status}
                    </span>
                  </div>
                </div>
                {/* Info */}
                <div className="p-2.5 space-y-1">
                  <p className="text-[11px] font-black truncate" style={{ color: 'var(--text-heading)' }}>
                    {data.id}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--text-on-glass-secondary)' }}>
                    {data.model}
                  </p>
                  <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: 'var(--glass-border-subtle)' }}>
                    <span className="glass-badge glass-badge-blue text-[8px] px-1.5 py-0.5">{data.type}</span>
                    {data.assigned_to && (
                      <span className="flex items-center gap-0.5 text-[9px]" style={{ color: 'var(--text-on-glass-muted)' }}>
                        <User size={9} /> {data.assigned_to.split(' ')[0]}
                      </span>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent"
            style={{ borderTopColor: 'var(--glass-border)' }} />
        </div>
      )}
    </div>
  );
}
