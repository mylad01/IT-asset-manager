import React from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { X, Printer } from 'lucide-react';
import ModalPortal from './ModalPortal';

export default function QRCodeModal({ isOpen, onClose, assetId, assetModel, assetDept }) {
  if (!isOpen || !assetId) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <ModalPortal>
      {/* ── On-screen modal ── */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden" onClick={onClose}>
        <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
        <div
          className="relative glass-modal max-w-sm w-full animate-glass-in overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />

          {/* Header */}
          <div className="relative z-20 flex justify-between items-center p-4 border-b border-white/10">
            <h2 className="font-bold text-white text-sm">Asset Tag Label</h2>
            <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors cursor-pointer">
              <X size={18} />
            </button>
          </div>

          {/* Preview card */}
          <div className="relative z-20 p-8 flex flex-col items-center justify-center text-center">
            <div className="qr-print-label">
              {/* Top accent bar */}
              <div className="qr-print-header">
                <span className="qr-print-brand">IT ASSET</span>
              </div>

              {/* QR code */}
              <div className="qr-print-qr-wrap">
                <QRCodeCanvas value={assetId} size={160} level={'H'} includeMargin={false} />
              </div>

              {/* Asset ID */}
              <div className="qr-print-id">{assetId}</div>

              {/* Separator */}
              <div className="qr-print-divider">
                <span></span>
                <span className="qr-print-divider-dot"></span>
                <span></span>
              </div>

              {/* Model */}
              <div className="qr-print-model">{assetModel || '—'}</div>

              {/* Footer */}
              <div className="qr-print-footer">
                <span>{assetDept || ''}</span>
                <span className="qr-print-date">{new Date().toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="relative z-20 p-4 border-t border-white/10 flex justify-end gap-3">
            <button onClick={onClose} className="glass-btn px-4 py-2 text-xs">
              Close
            </button>
            <button
              onClick={handlePrint}
              className="glass-btn glass-btn-primary px-4 py-2 text-xs flex items-center gap-2"
            >
              <Printer size={14} /> Print Label
            </button>
          </div>
        </div>
      </div>

      {/* ── Print-only label ── */}
      <div className="qr-print-container">
        <div className="qr-print-label qr-print-label--paper">
          <div className="qr-print-header">
            <span className="qr-print-brand">IT ASSET</span>
          </div>

          <div className="qr-print-qr-wrap qr-print-qr-wrap--large">
            <QRCodeCanvas value={assetId} size={200} level={'H'} includeMargin={false} />
          </div>

          <div className="qr-print-id qr-print-id--large">{assetId}</div>

          <div className="qr-print-divider">
            <span></span>
            <span className="qr-print-divider-dot"></span>
            <span></span>
          </div>

          <div className="qr-print-model">{assetModel || '—'}</div>

          <div className="qr-print-footer">
            <span>{assetDept || ''}</span>
            <span className="qr-print-date">{new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
