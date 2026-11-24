import React, { useState, useCallback } from 'react';
import { isRealISODate } from '../../shared/leaveDates.js';

/**
 * Real-calendar date validator that mirrors the leave Zod `dateStr` refine:
 *   - YYYY-MM-DD format
 *   - must be a real calendar date (rejects 2026-02-30 etc.)
 * Calendar truth lives in shared/leaveDates.js so the unit suite
 * (scripts/testLeaveDates.js) covers what the UI enforces.
 */
function validateDate(value) {
  if (!value) return 'Date is required.';
  if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(String(value))) return 'Date must be YYYY-MM-DD.';
  if (!isRealISODate(value)) return 'Date must be a real calendar date.';
  return '';
}

export default function DateRangePicker({ value, onChange, label = 'Date Range' }) {
  const [start, setStart] = useState(value?.start_date || value?.start || '');
  const [end, setEnd] = useState(value?.end_date || value?.end || '');

  const startError = validateDate(start);
  const endError = end ? validateDate(end) || (end < start ? 'End must be on or after start.' : '') : '';

  const onChangePair = useCallback((key, next) => {
    if (key === 'start') {
      setStart(next);
      onChange({ start_date: next, end_date: end });
    } else {
      setEnd(next);
      onChange({ start_date: start, end_date: next });
    }
  }, [start, end, onChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold tt-label uppercase tracking-wider">{label} <span className="text-[color:var(--status-danger)]">*</span></label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold tt-muted uppercase tracking-wider mb-1">Start Date</label>
          <input
            type="date"
            value={start}
            onChange={(e) => onChangePair('start', e.target.value)}
            className={`glass-input ${startError ? 'focus:ring-2 focus:ring-[color:var(--status-danger)]/50' : ''}`}
            max={end || undefined}
          />
          {startError && <p className="text-[10px] text-[color:var(--status-danger)] mt-1 font-medium">{startError}</p>}
        </div>
        <div>
          <label className="block text-[10px] font-bold tt-muted uppercase tracking-wider mb-1">End Date</label>
          <input
            type="date"
            value={end}
            onChange={(e) => onChangePair('end', e.target.value)}
            className={`glass-input ${endError ? 'focus:ring-2 focus:ring-[color:var(--status-danger)]/50' : ''}`}
            min={start || undefined}
          />
          {endError && <p className="text-[10px] text-[color:var(--status-danger)] mt-1 font-medium">{endError}</p>}
        </div>
      </div>
    </div>
  );
}
