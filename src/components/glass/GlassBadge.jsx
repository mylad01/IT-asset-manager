import React from 'react';

const colorMap = {
  green: 'glass-badge-green',
  blue: 'glass-badge-blue',
  red: 'glass-badge-red',
  purple: 'glass-badge-purple',
  amber: 'glass-badge-amber',
  orange: 'glass-badge-orange',
  gray: 'glass-badge-gray',
};

export default function GlassBadge({ children, color = 'gray', icon: Icon, className = '' }) {
  const colorClass = colorMap[color] || colorMap.gray;
  return (
    <span className={`glass-badge ${colorClass} ${className}`}>
      {Icon && <Icon size={12} />}
      {children}
    </span>
  );
}
