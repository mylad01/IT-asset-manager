import React, { useState } from 'react';
import { X, ZoomIn, ZoomOut, Download, RotateCcw } from 'lucide-react';
import ModalPortal from './ModalPortal';

export default function ImageViewerModal({ isOpen, imageUrl, altText, onClose }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleZoomIn = (e) => { e.stopPropagation(); setScale((prev) => Math.min(prev + 0.5, 4)); };
  const handleZoomOut = (e) => { e.stopPropagation(); setScale((prev) => Math.max(prev - 0.5, 0.5)); };
  const handleReset = (e) => { e.stopPropagation(); setScale(1); setPosition({ x: 0, y: 0 }); };
  const handleMouseDown = (e) => { e.stopPropagation(); e.preventDefault(); setIsDragging(true); setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y }); };
  const handleMouseMove = (e) => { if (!isDragging) return; e.stopPropagation(); setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); };
  const handleMouseUp = (e) => { e.stopPropagation(); setIsDragging(false); };
  const handleDownload = (e) => { e.stopPropagation(); const link = document.createElement('a'); link.href = imageUrl; link.download = altText ? `${altText.replace(/\s+/g, '-')}-photo` : 'asset-photo'; document.body.appendChild(link); link.click(); document.body.removeChild(link); };
  const handleClose = () => { setScale(1); setPosition({ x: 0, y: 0 }); setIsDragging(false); onClose(); };

  if (!isOpen || !imageUrl) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] backdrop-blur-lg overflow-hidden" onClick={handleClose} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      <button onClick={handleClose} className="absolute top-6 right-6 tt-label hover:tt transition-colors p-3 rounded-full z-50 bg-white/10 hover:bg-white/20" title="Close Viewer"><X size={24} /></button>
      <div className="relative w-full h-full flex items-center justify-center">
        <img src={imageUrl} alt={altText || "Hardware preview"} draggable={false} style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, transition: isDragging ? 'none' : 'transform 0.1s ease-out' }} className={`max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`} onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
      </div>
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-1 glass-modal p-2 z-50" onClick={(e) => e.stopPropagation()}>
        <button onClick={handleZoomOut} disabled={scale <= 0.5} className="p-3 rounded-xl tt-sec hover:tt hover:bg-white/10 disabled:opacity-30 transition-all" title="Zoom Out"><ZoomOut size={18} /></button>
        <span className="tt-sec font-mono text-xs font-bold w-12 text-center select-none">{Math.round(scale * 100)}%</span>
        <button onClick={handleZoomIn} disabled={scale >= 4} className="p-3 rounded-xl tt-sec hover:tt hover:bg-white/10 disabled:opacity-30 transition-all" title="Zoom In"><ZoomIn size={18} /></button>
        <div className="w-px h-6 bg-white/20 mx-1"></div>
        <button onClick={handleReset} className="p-3 rounded-xl tt-sec hover:tt hover:bg-white/10 transition-all" title="Reset"><RotateCcw size={18} /></button>
        <div className="w-px h-6 bg-white/20 mx-1"></div>
        <button onClick={handleDownload} className="p-3 rounded-xl text-[color:var(--status-info-hi)] hover:text-[color:var(--status-info-hi)] hover:bg-[color:var(--status-info-strong)]/20 transition-all" title="Download"><Download size={18} /></button>
      </div>
    </div>
    </ModalPortal>
  );
}
