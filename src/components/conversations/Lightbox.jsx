// Lightbox.jsx — fullscreen media viewer for conversation attachments.
//
// Opens from any image/video click in the chat. Features:
//   - zoom (wheel or double-click)
//   - prev/next across ALL media attachments currently loaded in the chat
//     (arrow keys and on-screen buttons)
//   - Esc closes, download button uses the auth-blob path
//   - caption with filename + size

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from 'lucide-react';
import { downloadAttachment, useObjectUrl } from './AttachmentCard';
import formatBytes from '../../utils/formatBytes';

export default function Lightbox({ items, index, onClose, onNavigate }) {
  const [zoom, setZoom] = useState(1);
  const current = items?.[index];
  const isMediaItem = !!(current && (current.kind === 'image' || current.kind === 'video'));
  // Hooks stay unconditional (early return for a missing item comes after).
  const { url: mediaUrlRaw, failed: mediaFailed } = useObjectUrl(current, isMediaItem);
  const mediaUrl = isMediaItem && !mediaFailed ? mediaUrlRaw : null;

  const go = useCallback((delta) => {
    if (!items || items.length < 2) return;
    const next = (index + delta + items.length) % items.length;
    onNavigate?.(next);
    setZoom(1);
  }, [items, index, onNavigate]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (!current) return null;

  const isImage = current.kind === 'image';
  const isVideo = current.kind === 'video';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={`Media viewer: ${current.filename}`}
      >
        {/* Caption + actions */}
        <div
          className="absolute top-4 left-0 right-0 flex items-center justify-between px-4 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="min-w-0">
            <p className="text-sm text-white/90 truncate">{current.filename}</p>
            <p className="text-[10px] text-white/50">
              {formatBytes(current.file_size)}{items.length > 1 ? ` · ${index + 1} / ${items.length}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="p-2 rounded-lg text-white/70 hover:bg-white/10" aria-label="Zoom out"><ZoomOut size={18} /></button>
            <button onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="p-2 rounded-lg text-white/70 hover:bg-white/10" aria-label="Zoom in"><ZoomIn size={18} /></button>
            <button onClick={() => downloadAttachment(current)} className="p-2 rounded-lg text-white/70 hover:bg-white/10" aria-label="Download"><Download size={18} /></button>
            <button onClick={onClose} className="p-2 rounded-lg text-white/70 hover:bg-white/10" aria-label="Close"><X size={18} /></button>
          </div>
        </div>

        {/* Media */}
        <motion.div
          key={`${current.id}-${index}`}
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="max-w-[92vw] max-h-[82vh] flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => {
            if (!isImage) return;
            e.preventDefault();
            setZoom((z) => Math.min(4, Math.max(0.5, z - Math.sign(e.deltaY) * 0.15)));
          }}
          onDoubleClick={() => isImage && setZoom((z) => (z > 1 ? 1 : 2))}
        >
          {isImage && mediaUrl && (
            <img
              src={mediaUrl}
              alt={current.filename}
              style={{ transform: `scale(${zoom})` }}
              className="max-w-full max-h-[82vh] object-contain rounded-lg transition-transform duration-150"
              draggable={false}
            />
          )}
          {isImage && !mediaUrl && (
            <div className="w-64 h-64 rounded-lg bg-white/5 animate-pulse" />
          )}
          {isVideo && mediaUrl && (
            <video src={mediaUrl} controls autoPlay className="max-w-full max-h-[82vh] rounded-lg" />
          )}
          {isVideo && !mediaUrl && (
            <div className="w-64 h-40 rounded-lg bg-white/5 animate-pulse" />
          )}
        </motion.div>

        {/* Prev / next */}
        {items.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
              aria-label="Previous media"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); go(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
              aria-label="Next media"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
