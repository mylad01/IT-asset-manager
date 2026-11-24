// AttachmentCard.jsx — renders one attachment inline.
//
// Replaces the old "📎 filename" link-to-new-tab UX:
//   image → inline thumbnail, click opens the lightbox
//   video → inline <video> player (Range streaming makes seeking work)
//   file  → professional file card with a one-click auth-blob download
// All fetches go through the authenticated attachment endpoint; plain link
// navigation would never carry the Authorization header.

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Download, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import formatBytes from '../../utils/formatBytes';
import { getStoredToken } from '../../utils/appStorage';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';


/**
 * Fetch an attachment with the Authorization header and return a blob object
 * URL. <img src>/<video src> cannot send headers, so inline media MUST go
 * through this (a token query-param would leak the JWT into request logs).
 * Caller owns the URL lifecycle via useObjectUrl (revoke on unmount).
 */
export async function fetchAttachmentBlobUrl(att) { // eslint-disable-line react/only-export-components
  const res = await fetch(`${BASE_URL}${att.url}`, {
    headers: { Authorization: `Bearer ${getStoredToken()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/** Small hook wrapper: resolves a blob URL for an attachment, revoking on change/unmount. */
export function useObjectUrl(att, enabled = true) { // eslint-disable-line react/only-export-components
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) { setUrl(null); return undefined; }
    let cancelled = false;
    let current = null;
    fetchAttachmentBlobUrl(att)
      .then((u) => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        current = u;
        setUrl(u);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [att?.url]); // eslint-disable-line react-hooks/exhaustive-deps -- identity is the URL
  return { url, failed };
}

/** Download via authenticated fetch → blob, so no new-tab auth problems. */
export async function downloadAttachment(att) { // eslint-disable-line react/only-export-components
  try {
    const res = await fetch(`${BASE_URL}${att.url}`, {
      headers: { Authorization: `Bearer ${getStoredToken()}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = att.filename || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  } catch {
    toast.error('Download failed');
  }
}

export default function AttachmentCard({ attachment, onOpenMedia, size = 'default' }) {
  const { kind, filename, file_size, mime_type } = attachment;
  // Inline media loads through the auth-blob path (see fetchAttachmentBlobUrl):
  // a plain src= would 401 because <img>/<video> cannot send the auth header.
  const { url: blobUrl, failed: fetchFailed } = useObjectUrl(attachment, kind === 'image' || kind === 'video');

  if (kind === 'image' && !fetchFailed) {
    if (!blobUrl) {
      // Loading placeholder (and terminal fallback if the fetch failed).
      return (
        <div className={`rounded-xl border border-white/10 bg-black/30 animate-pulse ${size === 'grid' ? 'w-full h-28' : 'max-w-[260px] h-40'}`} />
      );
    }
    return (
      <motion.button
        type="button"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => onOpenMedia?.(attachment)}
        className={`block relative rounded-xl overflow-hidden border border-white/10 bg-black/30 ${size === 'grid' ? 'w-full' : 'max-w-[260px]'}`}
        aria-label={`Open image ${filename}`}
      >
        <img
          src={blobUrl}
          alt={filename}
          className={`w-full object-cover ${size === 'grid' ? 'h-28' : 'max-h-[260px]'}`}
          draggable={false}
        />
      </motion.button>
    );
  }

  // kind === 'image' with a failed fetch falls through to the file card below.

  if (kind === 'video') {
    if (!blobUrl) {
      return (
        <div className={`rounded-xl border border-white/10 bg-black/40 animate-pulse ${size === 'grid' ? 'w-full h-28' : 'max-w-[320px] h-44'}`} />
      );
    }
    return (
      <div className={`relative rounded-xl overflow-hidden border border-white/10 bg-black/40 ${size === 'grid' ? 'w-full' : 'max-w-[320px]'}`}>
        <video
          src={blobUrl}
          controls
          preload="metadata"
          className={`w-full object-contain ${size === 'grid' ? 'h-28' : 'max-h-[280px]'}`}
          onClick={(e) => { if (e.detail === 2) onOpenMedia?.(attachment); }}
        />
        <p className="px-2 py-1 text-[10px] tt-muted truncate">{filename} · {formatBytes(file_size)}</p>
      </div>
    );
  }

  // Generic file card (pdf, txt, or anything that failed preview)
  const isPdf = mime_type === 'application/pdf';
  return (
    <div className={`flex items-center gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/10 ${size === 'grid' ? 'w-full' : 'min-w-[200px] max-w-[280px]'}`}>
      <div className={`p-2 rounded-lg shrink-0 ${isPdf ? 'bg-[color:var(--status-danger-strong)]/15' : 'bg-[color:var(--status-info-strong)]/15'}`}>
        {isPdf ? <FileText size={16} className="text-[color:var(--status-danger)]" /> : <AlertTriangle size={16} className="text-[color:var(--status-info)]" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium tt truncate">{filename}</p>
        <p className="text-[10px] tt-muted">{formatBytes(file_size)}{isPdf ? ' · PDF' : ''}</p>
      </div>
      <button
        type="button"
        onClick={() => downloadAttachment(attachment)}
        className="p-1.5 rounded-lg hover:bg-white/10 text-[color:var(--ui-violet)] hover:text-[color:var(--ui-violet-hi)] transition-colors shrink-0"
        title="Download"
        aria-label={`Download ${filename}`}
      >
        <Download size={14} />
      </button>
    </div>
  );
}
