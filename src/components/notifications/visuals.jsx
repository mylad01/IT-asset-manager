import React from 'react';
import { Server, HardDrive, ShieldAlert, Box, PackageX, MessageSquare, CalendarDays } from 'lucide-react';

/* Shared motion language: one ease, used everywhere notifications animate.
   easeOutExpo-style curve — fast start, silky settle, zero bounce. */
export const EASE = [0.16, 1, 0.3, 1];

export const typeIcons = {
  ticket: { icon: Box, color: 'text-[color:var(--ui-indigo)]' },
  asset: { icon: Box, color: 'text-[color:var(--status-info)]' },
  consumable: { icon: PackageX, color: 'text-[color:var(--status-warning)]' },
  system: { icon: Server, color: 'text-[color:var(--ui-purple)]' },
  backup: { icon: HardDrive, color: 'text-[color:var(--status-success)]' },
  auth: { icon: ShieldAlert, color: 'text-[color:var(--status-danger)]' },
  conversation: { icon: MessageSquare, color: 'text-[color:var(--ui-violet)]' },
  leave: { icon: CalendarDays, color: 'text-[color:var(--status-info)]' },
};

export const priorityStyles = {
  critical: { border: 'border-[color:var(--status-danger-strong)]/50', bg: 'bg-[color:var(--status-danger-strong)]/10', dot: 'bg-[color:var(--status-danger-strong)]' },
  warning: { border: 'border-[color:var(--status-warning-strong)]/50', bg: 'bg-[color:var(--status-warning-strong)]/10', dot: 'bg-[color:var(--status-warning-strong)]' },
  info: { border: 'border-[color:var(--ui-indigo-strong)]/50', bg: 'bg-[color:var(--ui-indigo-strong)]/10', dot: 'bg-[color:var(--ui-indigo-strong)]' },
};

export function getTypeIcon(type) {
  const config = typeIcons[type] || typeIcons.system;
  return React.createElement(config.icon, { size: 14, className: config.color });
}

export function getPriorityStyle(priority) {
  return priorityStyles[priority] || priorityStyles.info;
}
