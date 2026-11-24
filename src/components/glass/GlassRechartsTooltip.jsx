import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Glass-styled tooltip for recharts charts with smooth animated transitions.
 * Uses framer-motion to fade+slide tooltip content in/out on each hover.
 *
 * Usage:
 *   <Tooltip content={<GlassRechartsTooltip />} />
 */
export default function GlassRechartsTooltip({ active, payload, label, valueFormatter }) {
  const isVisible = active && payload && payload.length > 0;

  return (
    <div
      style={{
        pointerEvents: 'none',
        position: 'relative',
        minWidth: '100px',
      }}
    >
      <AnimatePresence>
        {isVisible && (
          <motion.div
            key="tooltip-content"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{
              duration: 0.18,
              ease: [0.25, 0.46, 0.45, 0.94], // ease-out-quad
            }}
            style={{
              background: 'var(--modal-bg)',
              backdropFilter: 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              border: '1px solid var(--glass-border-subtle)',
              borderRadius: '12px',
              padding: '10px 14px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
              willChange: 'transform, opacity',
            }}
          >
            {label && (
              <div style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-on-glass-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '6px',
              }}>
                {label}
              </div>
            )}
            {payload.map((entry, idx) => (
              <motion.div
                key={`${entry.name}-${idx}`}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15, delay: idx * 0.03 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '3px 0',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: entry.color || entry.fill,
                    boxShadow: `0 0 6px ${entry.color || entry.fill}50`,
                    flexShrink: 0,
                  }}
                />
                <span style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--text-on-glass)',
                }}>
                  {entry.name}
                </span>
                <span style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--text-heading)',
                  marginLeft: 'auto',
                }}>
                  {valueFormatter
                    ? valueFormatter(entry.value)
                    : typeof entry.value === 'number'
                      ? entry.value.toLocaleString()
                      : entry.value
                  }
                </span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
