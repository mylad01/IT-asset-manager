/**
 * Tables & Data section — PLAN.MD §13 P2.
 *
 * Global table defaults (page size, date/time format, totals line) ride the
 * registry + ui_prefs blob. Per-table overrides (column visibility, local
 * page size) live in localStorage via useTablePrefs and are managed from
 * each table's own column picker — this section only sets the defaults.
 */
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Table2, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../../utils/apiClient';
import GlassCard from '../glass/GlassCard';
import GlassBadge from '../glass/GlassBadge';
import { PAGE_SIZES, DATE_FORMATS } from '../../config/preferencesRegistry';
import { applyPreference, readStoredPrefs } from '../../config/applyPreferences';

function SavedTick({ show }) {
  return (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--status-success)] transition-opacity duration-300 shrink-0 ${show ? 'opacity-100' : 'opacity-0'}`}
    >
      <CheckCircle size={12} /> Saved
    </span>
  );
}

export default function TablesAndDataSection() {
  const [prefs, setPrefs] = useState(() => readStoredPrefs());
  const [savedRows, setSavedRows] = useState({});
  const [error, setError] = useState('');

  useEffect(() => () => setError(''), []);

  const flashSaved = (key) => {
    setSavedRows((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => setSavedRows((prev) => ({ ...prev, [key]: false })), 2200);
  };

  const changePref = async (key, value) => {
    setError('');
    applyPreference(key, value);
    setPrefs((prev) => ({ ...prev, [key]: value }));
    const { ok, error: err } = await api.put('/api/auth/preferences', { [key]: value });
    if (!ok) setError(err || 'Failed to save preference');
    else flashSaved(key);
  };

  const Segmented = ({ options, value, onChange }) => (
    <div className="grid grid-cols-3 gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`p-2.5 rounded-xl border text-center transition-all ${
            value === o.value
              ? 'border-[color:var(--status-info)]/70 bg-[color:var(--status-info-strong)]/10 ring-1 ring-[color:var(--status-info)]/40'
              : 'border-white/10 bg-white/5 hover:bg-white/10'
          }`}
          aria-pressed={value === o.value}
          title={o.hint}
        >
          <p className="text-sm font-medium tt">{o.label}</p>
          {o.hint && <p className="text-[11px] tt-label">{o.hint}</p>}
        </button>
      ))}
    </div>
  );

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.11 }} className="space-y-4">
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tt flex items-center gap-2">
            <Table2 className="w-5 h-5 text-[color:var(--status-info)]" />
            Tables &amp; Data
          </h2>
          <GlassBadge variant="info">Per user</GlassBadge>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt">Rows per page (paginated tables)</p>
            <SavedTick show={savedRows.pageSize} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {PAGE_SIZES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => changePref('pageSize', n)}
                className={`p-2.5 rounded-xl border text-center transition-all ${
                  prefs.pageSize === n
                    ? 'border-[color:var(--status-info)]/70 bg-[color:var(--status-info-strong)]/10 ring-1 ring-[color:var(--status-info)]/40'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
                aria-pressed={prefs.pageSize === n}
              >
                <p className="text-sm font-bold tt tabular-nums">{n}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt">Date format</p>
            <SavedTick show={savedRows.dateFormat} />
          </div>
          <Segmented options={DATE_FORMATS} value={prefs.dateFormat} onChange={(v) => changePref('dateFormat', v)} />
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt">Time format</p>
            <SavedTick show={savedRows.timeFormat} />
          </div>
          <Segmented
            options={[{ value: '12h', label: '12-hour', hint: '2:30 PM' }, { value: '24h', label: '24-hour', hint: '14:30' }]}
            value={prefs.timeFormat}
            onChange={(v) => changePref('timeFormat', v)}
          />
        </div>

        <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
          <div>
            <p className="font-medium tt text-sm flex items-center gap-2">
              Hide result counts
              <SavedTick show={savedRows.hideColumnTotals} />
            </p>
            <p className="text-xs tt-label">Don't show the "N results" line above tables</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.hideColumnTotals === true}
              onChange={(e) => changePref('hideColumnTotals', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-white/10 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[color:var(--status-info-strong)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[color:var(--status-info-strong)]"></div>
          </label>
        </div>

        <p className="text-[11px] tt-muted mt-3">
          Per-table settings (visible columns) are managed from the columns button on each table and stay on this device.
        </p>
      </GlassCard>

      {error && (
        <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
    </motion.section>
  );
}
