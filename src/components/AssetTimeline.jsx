import React from 'react';
import { motion } from 'framer-motion';
import {
  ShoppingCart, Shield, Plus, Rocket, ArrowRightLeft, Archive,
  Wrench, FileText, Pencil, Trash2, Circle, AlertTriangle,
  Clock, ShieldCheck,
} from 'lucide-react';

const ICONS = {
  ShoppingCart, Shield, Plus, Rocket, ArrowRightLeft, Archive,
  Wrench, FileText, Pencil, Trash2, Circle,
};

const COLORS = {
  emerald: {
    dot: 'bg-[color:var(--status-success-strong)]', ring: 'ring-[color:var(--status-success-strong)]/30',
    badge: 'bg-[color:var(--status-success-strong)]/15 border-[color:var(--status-success)]/25 text-[color:var(--status-success-hi)]',
    line: 'from-[color:var(--status-success-strong)]/40',
  },
  amber: {
    dot: 'bg-[color:var(--status-warning-strong)]', ring: 'ring-[color:var(--status-warning-strong)]/30',
    badge: 'bg-[color:var(--status-warning-strong)]/15 border-[color:var(--status-warning)]/25 text-[color:var(--status-warning-hi)]',
    line: 'from-[color:var(--status-warning-strong)]/40',
  },
  red: {
    dot: 'bg-[color:var(--status-danger-strong)]', ring: 'ring-[color:var(--status-danger-strong)]/30',
    badge: 'bg-[color:var(--status-danger-strong)]/15 border-[color:var(--status-danger)]/25 text-[color:var(--status-danger-hi)]',
    line: 'from-[color:var(--status-danger-strong)]/40',
  },
  blue: {
    dot: 'bg-[color:var(--status-info-strong)]', ring: 'ring-[color:var(--status-info-strong)]/30',
    badge: 'bg-[color:var(--status-info-strong)]/15 border-[color:var(--status-info)]/25 text-[color:var(--status-info-hi)]',
    line: 'from-[color:var(--status-info-strong)]/40',
  },
  purple: {
    dot: 'bg-[color:var(--ui-purple-strong)]', ring: 'ring-[color:var(--ui-purple-strong)]/30',
    badge: 'bg-[color:var(--ui-purple-strong)]/15 border-[color:var(--ui-purple)]/25 text-[color:var(--ui-purple-hi)]',
    line: 'from-[color:var(--ui-purple-strong)]/40',
  },
  green: {
    dot: 'bg-[color:var(--status-success-strong)]', ring: 'ring-[color:var(--status-success-strong)]/30',
    badge: 'bg-[color:var(--status-success-strong)]/15 border-[color:var(--status-success)]/25 text-[color:var(--status-success-hi)]',
    line: 'from-[color:var(--status-success-strong)]/40',
  },
  gray: {
    dot: 'bg-[color:var(--ui-neutral-strong)]', ring: 'ring-[color:var(--ui-neutral-strong)]/30',
    badge: 'bg-[color:var(--ui-neutral-strong)]/15 border-[color:var(--ui-neutral)]/25 text-[color:var(--ui-neutral-hi)]',
    line: 'from-[color:var(--ui-neutral-strong)]/40',
  },
  orange: {
    dot: 'bg-[color:var(--status-warning-strong)]', ring: 'ring-[color:var(--status-warning-strong)]/30',
    badge: 'bg-[color:var(--status-warning-strong)]/15 border-[color:var(--status-warning)]/25 text-[color:var(--status-warning-hi)]',
    line: 'from-[color:var(--status-warning-strong)]/40',
  },
  slate: {
    dot: 'bg-[color:var(--ui-neutral-strong)]', ring: 'ring-[color:var(--ui-neutral-strong)]/30',
    badge: 'bg-[color:var(--ui-neutral-strong)]/15 border-[color:var(--ui-neutral)]/25 text-[color:var(--ui-neutral-hi)]',
    line: 'from-[color:var(--ui-neutral-strong)]/40',
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: (i) => ({
    opacity: 1, x: 0,
    transition: { delay: i * 0.06, duration: 0.35, ease: 'easeOut' },
  }),
};

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function isExpired(dateStr) {
  return new Date(dateStr) < new Date();
}

function daysUntil(dateStr) {
  const d = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  return d;
}

export default function AssetTimeline({ milestones = [] }) {
  if (milestones.length === 0) {
    return (
      <div className="text-center py-8">
        <Clock size={24} className="mx-auto mb-2 text-white/20" />
        <p className="text-sm tt-muted">No lifecycle events recorded</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[19px] top-2 bottom-2 w-px bg-gradient-to-b from-[color:var(--status-info-strong)]/30 via-white/10 to-white/5" />

      <div className="space-y-1">
        {milestones.map((m, i) => {
          const Icon = ICONS[m.icon] || Circle;
          const color = COLORS[m.color] || COLORS.slate;
          const isWarrantyExpiry = m.type === 'warranty_expiry';
          const expired = isWarrantyExpiry && isExpired(m.date);
          const daysLeft = isWarrantyExpiry ? daysUntil(m.date) : null;

          return (
            <motion.div
              key={`${m.type}-${m.date}-${i}`}
              custom={i}
              variants={itemVariants}
              initial="hidden"
              animate="visible"
              className="relative flex items-start gap-3 group"
            >
              {/* Dot */}
              <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 border-[rgba(20,20,40,0.75)] ${color.dot} ${color.ring} ring-4 shadow-sm`}>
                <Icon size={14} className="text-white" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-4">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-xs font-bold uppercase tracking-wider ${color.badge} border px-2 py-0.5 rounded`}>
                    {m.label}
                  </span>
                  {isWarrantyExpiry && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      expired
                        ? 'bg-[color:var(--status-danger-strong)]/20 text-[color:var(--status-danger-hi)] border border-[color:var(--status-danger)]/30'
                        : daysLeft <= 30
                          ? 'bg-[color:var(--status-warning-strong)]/20 text-[color:var(--status-warning-hi)] border border-[color:var(--status-warning)]/30 animate-pulse'
                          : 'bg-[color:var(--status-success-strong)]/20 text-[color:var(--status-success-hi)] border border-[color:var(--status-success)]/30'
                    }`}>
                      {expired ? (
                        <span className="flex items-center gap-1"><AlertTriangle size={8} /> Expired</span>
                      ) : (
                        <span className="flex items-center gap-1"><ShieldCheck size={8} /> {daysLeft}d left</span>
                      )}
                    </span>
                  )}
                </div>
                <p className="text-xs font-medium tt-label mt-1">{m.detail}</p>
                <time className="text-[10px] tt-muted mt-0.5 block">
                  {formatDateTime(m.date)}
                </time>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
