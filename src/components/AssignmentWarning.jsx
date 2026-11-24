import React from 'react';
import { ShieldAlert } from 'lucide-react';

/**
 * Professional warning banner shown when an asset is currently assigned to someone.
 * Uses the same glass-styled amber/orange pattern as the TransferAssetModal.
 *
 * Props:
 *   userName   — name of the person the asset is assigned to
 *   department — department name (optional)
 *   className  — additional classes (optional)
 */
export default function AssignmentWarning({ userName, department, className = '' }) {
  if (!userName) return null;

  return (
    <div className={`bg-[color:var(--status-warning-strong)]/10 border border-[color:var(--status-warning)]/20 rounded-xl p-4 flex items-start gap-3 ${className}`}>
      <div className="p-1.5 rounded-lg bg-[color:var(--status-warning-strong)]/20 shrink-0 mt-0.5">
        <ShieldAlert size={18} className="text-[color:var(--status-warning)]" />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-bold text-[color:var(--status-warning-hi)] mb-1">
          Asset Currently Assigned
        </h4>
        <p className="text-xs tt-label leading-relaxed">
          This hardware is checked out to{' '}
          <strong className="text-[color:var(--status-warning-hi)]/80">{userName}</strong>
          {department && (
            <> ({department})</>
          )}.
          Please review the assignment details before proceeding.
        </p>
        <div className="flex items-center gap-2 mt-2.5">
          <span className="glass-badge glass-badge-orange text-[10px]">
            <ShieldAlert size={10} />
            Active Assignment
          </span>
        </div>
      </div>
    </div>
  );
}
