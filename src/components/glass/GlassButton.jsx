import React from 'react';

const variants = {
  default: 'glass-btn',
  primary: 'glass-btn glass-btn-primary',
  danger: 'glass-btn glass-btn-danger',
  indigo: 'glass-btn glass-btn-indigo',
};

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export default function GlassButton({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  disabled = false,
  ...props
}) {
  return (
    <button
      className={`${variants[variant] || variants.default} ${sizes[size] || sizes.md} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} inline-flex items-center justify-center gap-2 font-semibold ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
