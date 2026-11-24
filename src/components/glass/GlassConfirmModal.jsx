import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import ModalPortal from '../ModalPortal';

export default function GlassConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
  children,
}) {
  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (onConfirm) await onConfirm();
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
        <div className="relative glass-modal max-w-md w-full animate-glass-in overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
          <div className="relative z-20 p-6">
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-xl bg-[color:var(--status-danger-strong)]/20 shrink-0 mt-0.5">
                <AlertTriangle size={20} className="text-[color:var(--status-danger)]" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-white">{title}</h3>
                {children ? (
                  <div className="text-white/50 text-sm mt-2">{children}</div>
                ) : (
                  <p className="text-white/50 text-sm mt-2">{message}</p>
                )}
              </div>
              <button onClick={onClose} className="p-1 rounded-full text-white/30 hover:text-white hover:bg-white/10 transition-all cursor-pointer shrink-0">
                <X size={16} />
              </button>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-white/10">
              <button onClick={onClose} disabled={isLoading} className="glass-btn px-4 py-2 text-xs">
                {cancelText}
              </button>
              <button
                onClick={handleConfirm}
                disabled={isLoading}
                className={`glass-btn px-4 py-2 text-xs font-semibold disabled:opacity-50 ${variant === 'danger' ? 'glass-btn-danger' : 'glass-btn-primary'}`}
              >
                {isLoading ? 'Processing...' : confirmText}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
