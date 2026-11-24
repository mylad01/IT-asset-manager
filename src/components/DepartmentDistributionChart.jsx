import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { motion } from 'framer-motion';
import GlassRechartsTooltip from './glass/GlassRechartsTooltip';

const COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

export default function DepartmentDistributionChart({ assets, renderTooltip }) {
  const [activeIndex, setActiveIndex] = useState(null);

  if (!Array.isArray(assets) || assets.length === 0) {
    return <div className="flex items-center justify-center h-64 text-white/50">No data available</div>;
  }

  const departments = [...new Set(assets.map(a => a.dept || 'Unassigned'))];
  const data = departments.map(dept => ({
    name: dept,
    value: assets.filter(a => (a.dept || 'Unassigned') === dept).length,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="h-64"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          barCategoryGap="20%"
          onMouseMove={(state) => {
            if (state?.activeTooltipIndex !== undefined) {
              setActiveIndex(state.activeTooltipIndex);
            }
          }}
          onMouseLeave={() => setActiveIndex(null)}
        >
          <XAxis
            dataKey="name"
            tick={{ fill: 'var(--text-label)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--glass-border-subtle)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--text-label)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={renderTooltip || <GlassRechartsTooltip />}
            wrapperStyle={{ outline: 'none' }}
            cursor={{ fill: 'var(--nav-hover)', radius: 4 }}
          />
          <Bar
            dataKey="value"
            radius={[6, 6, 0, 0]}
            animationDuration={800}
            animationEasing="ease-out"
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={COLORS[index % COLORS.length]}
                opacity={activeIndex === null || activeIndex === index ? 1 : 0.6}
                style={{ transition: 'opacity 300ms' }}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
