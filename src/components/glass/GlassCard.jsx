import React from 'react';

export default function GlassCard({ 
  children, 
  className = '', 
  hover = true, 
  padding = 'p-6',
  as = 'div',
  ...props 
}) {
  const Component = as;
  return (
    <Component
      className={`
        glass-card glass-shine
        ${padding}
        ${hover ? '' : 'hover:transform-none hover:shadow-none'}
        ${className}
      `}
      {...props}
    >
      {children}
    </Component>
  );
}
