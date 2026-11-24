import React from 'react';

/**
 * Glass-styled custom legend for recharts charts.
 *
 * Usage:
 *   <Legend content={<GlassRechartsLegend />} />
 */
export default function GlassRechartsLegend({ payload }) {
  if (!payload || !payload.length) return null;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: '12px',
      padding: '8px 12px',
      borderRadius: '10px',
      background: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
    }}>
      {payload.map((entry, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: entry.color,
              boxShadow: `0 0 6px ${entry.color}40`,
            }}
          />
          <span style={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.7)',
          }}>
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}
