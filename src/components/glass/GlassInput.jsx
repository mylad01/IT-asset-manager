import React from 'react';

export function GlassInput({ className = '', ...props }) {
  return (
    <input
      className={`glass-input ${className}`}
      {...props}
    />
  );
}

export function GlassSelect({ className = '', children, ...props }) {
  return (
    <select
      className={`glass-select ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function GlassTextarea({ className = '', ...props }) {
  return (
    <textarea
      className={`glass-input resize-none ${className}`}
      {...props}
    />
  );
}

export function GlassLabel({ children, className = '', required = false, ...props }) {
  return (
    <label className={`block text-xs font-bold text-white/60 uppercase tracking-wider mb-1.5 ${className}`} {...props}>
      {children}
      {required && <span className="text-[color:var(--status-danger)] ml-0.5">*</span>}
    </label>
  );
}
