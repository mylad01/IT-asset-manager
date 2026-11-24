import React from 'react';
import { X } from 'lucide-react';
import ModalPortal from '../ModalPortal';
import ScrollArea from './ScrollArea';

export default function GlassModal({
  isOpen,
  onClose,
  children,
  maxWidth = 'max-w-lg',
  showClose = true,
  headerIcon: Icon,
  headerTitle,
  headerSubtitle,
  headerColor = 'from-[color:var(--status-info-deep)]/40 to-[color:var(--ui-purple-deep)]/30',
}) {
  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
      
      <div
        className={`relative glass-modal ${maxWidth} w-full animate-glass-in`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Specular highlight overlay */}
        <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />

        {/* Header */}
        {(headerTitle || showClose) && (
          <div className={`relative z-20 flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r ${headerColor}`}>
            <div className="flex items-center gap-3">
              {Icon && (
                <div className="p-2 rounded-xl bg-white/15">
                  <Icon size={22} className="text-white" />
                </div>
              )}
              <div>
                {headerTitle && <h2 className="text-lg font-bold text-white">{headerTitle}</h2>}
                {headerSubtitle && <p className="text-white/50 text-sm mt-0.5">{headerSubtitle}</p>}
              </div>
            </div>
            {showClose && (
              <button
                onClick={onClose}
                className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/15 transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <ScrollArea className="z-20" contentClassName="max-h-[80vh]">
          {children}
        </ScrollArea>
      </div>
    </div>
    </ModalPortal>
  );
}
