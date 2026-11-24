import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import GlassRechartsTooltip from './glass/GlassRechartsTooltip';
import GlassRechartsLegend from './glass/GlassRechartsLegend';

const COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

const RADIAN = Math.PI / 180;
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

export default function AssetDistributionChart({ data, renderTooltip }) {
  const [activeIndex, setActiveIndex] = useState(null);

  if (!Array.isArray(data) || data.length === 0) {
    return <div className="flex items-center justify-center h-64 tt-label">No data available</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="h-64"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderCustomizedLabel}
            outerRadius={100}
            dataKey="value"
            animationBegin={0}
            animationDuration={800}
            animationEasing="ease-out"
            onMouseEnter={(_, index) => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={COLORS[index % COLORS.length]}
                opacity={activeIndex === null || activeIndex === index ? 1 : 0.5}
                style={{ filter: activeIndex === index ? 'drop-shadow(0 0 6px rgba(255,255,255,0.3))' : 'none', transition: 'opacity 300ms, filter 300ms' }}
              />
            ))}
          </Pie>
          <Tooltip
            content={renderTooltip || <GlassRechartsTooltip />}
            wrapperStyle={{ outline: 'none' }}
          />
          <Legend content={<GlassRechartsLegend />} />
        </PieChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
