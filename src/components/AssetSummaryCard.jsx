import React from 'react'; // Imports React library

// Hue prop → semantic theme token family (index.css :root). The card sits on
// white, so the value renders at the `-darkest` tier below.
const CARD_VALUE_COLORS = {
  gray: '--ui-neutral',
  blue: '--status-info',
  green: '--status-success',
  emerald: '--status-success',
  red: '--status-danger',
  amber: '--status-warning',
  orange: '--status-warning',
  purple: '--ui-purple',
  indigo: '--ui-indigo',
};

export default function AssetSummaryCard({ title, count, color = "gray" }) { // Component receives title, count, and optional color prop
  return ( // Returns the card UI
    <div className="bg-white p-6 rounded-lg shadow-sm border border-[color:var(--ui-neutral-hi)]"> {/* Card container */}
      <div className="text-[color:var(--ui-neutral-strong)] text-sm font-medium">{title}</div> {/* Card title */}
      {/* Semantic token via custom property: a template-built `text-${color}-900`
          class is invisible to Tailwind's scanner (it never emitted a rule). */}
      <div className="text-3xl font-bold mt-2" style={{ color: `var(${CARD_VALUE_COLORS[color] || CARD_VALUE_COLORS.gray}-darkest)` }}>{count}</div> {/* Card value with dynamic color styling */}
    </div> // Closes container
  ); // Ends return
} // Closes component