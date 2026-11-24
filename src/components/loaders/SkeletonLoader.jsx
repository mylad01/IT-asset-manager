import React from 'react';

export const TableSkeleton = ({ rows = 5, columns = 4 }) => (
  <div className="animate-pulse space-y-4">
    <div className="h-4 bg-white/10 rounded w-1/4 mb-6"></div>
    <div className="space-y-3">
      {[...Array(rows)].map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {[...Array(columns)].map((_, colIndex) => (
            <div key={colIndex} className={`h-4 bg-white/5 rounded flex-1 ${colIndex === 0 ? 'w-1/6' : ''}`}></div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

export const CardSkeleton = () => (
  <div className="glass-card p-6 animate-pulse">
    <div className="h-4 bg-white/10 rounded w-1/3 mb-4"></div>
    <div className="h-8 bg-white/5 rounded w-1/4 mb-2"></div>
    <div className="space-y-2">
      <div className="h-3 bg-white/5 rounded w-full"></div>
      <div className="h-3 bg-white/5 rounded w-3/4"></div>
    </div>
  </div>
);

export const ChartSkeleton = () => (
  <div className="h-64 glass-card p-6 animate-pulse flex flex-col">
    <div className="h-4 bg-white/10 rounded w-1/4 mb-6"></div>
    <div className="flex-1 flex items-center justify-center">
      <div className="w-32 h-32 border-4 border-white/10 border-t-[color:var(--status-info)] rounded-full animate-spin"></div>
    </div>
  </div>
);

export const TextSkeleton = ({ lines = 3 }) => (
  <div className="animate-pulse space-y-2">
    {[...Array(lines)].map((_, index) => (
      <div key={index} className={`h-3 bg-white/10 rounded ${index === 0 ? 'w-3/4' : index === 1 ? 'w-1/2' : 'w-2/3'}`}></div>
    ))}
  </div>
);

export const PageHeaderSkeleton = () => (
  <div className="animate-pulse">
    <div className="h-8 bg-white/10 rounded w-1/3 mb-2"></div>
    <div className="h-4 bg-white/5 rounded w-1/2"></div>
  </div>
);
