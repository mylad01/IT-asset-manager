/**
 * Layout & Motion section — PLAN.MD §13 P2.
 *
 * Two GlassCards in one section component:
 *  - Layout & Density: density presets + font-scale slider (85–125%)
 *  - Motion & Effects: motion level + performance mode toggle
 *
 * All controls write through the shared changePref() pattern (optimistic
 * applyPreference → server PUT → Saved-tick), same as AppearanceSection.
 */
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Rows3, Type, Zap, Gauge, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../../utils/apiClient';
import GlassCard from '../glass/GlassCard';
import GlassBadge from '../glass/GlassBadge';
import { DENSITY_LEVELS, MOTION_LEVELS } from '../../config/preferencesRegistry';
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

function Toggle({ checked, onChange, accent = 'var(--status-success-strong)' }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      {/* accent arrives as a token value via --toggle-accent: a template-built
          `peer-checked:bg-${accent}-500` class is invisible to Tailwind's
          scanner (it never emitted a rule, so the ON state had no fill). */}
      <div className="w-11 h-6 bg-white/10 peer-focus:outline-none peer-focus:ring-2 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[color:var(--toggle-accent)]" style={{ '--toggle-accent': accent, borderColor: 'var(--glass-border-subtle)' }}></div>
    </label>
  );
}

export default function LayoutAndMotionSection() {
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

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="space-y-4">
      {/* ── Layout & Density ── */}
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tt flex items-center gap-2">
            <Rows3 className="w-5 h-5 text-[color:var(--ui-cyan)]" />
            Layout &amp; Density
          </h2>
          <GlassBadge variant="info">Per user</GlassBadge>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt">Spacing</p>
            <SavedTick show={savedRows.density} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {DENSITY_LEVELS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => changePref('density', d.value)}
                className={`p-3 rounded-xl border text-center transition-all ${
                  prefs.density === d.value
                    ? 'border-[color:var(--ui-cyan)]/70 bg-[color:var(--ui-cyan-strong)]/10 ring-1 ring-[color:var(--ui-cyan)]/40'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
                aria-pressed={prefs.density === d.value}
                title={d.hint}
              >
                <p className="text-sm font-medium tt">{d.label}</p>
                <p className="text-[11px] tt-label">{d.hint}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium tt flex items-center gap-1.5">
              <Type className="w-4 h-4 text-[color:var(--ui-cyan)]" /> Font size
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm tt-sec tabular-nums">{prefs.fontScale ?? 100}%</span>
              <SavedTick show={savedRows.fontScale} />
            </div>
          </div>
          <input
            type="range"
            min="85"
            max="125"
            step="5"
            value={prefs.fontScale ?? 100}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              applyPreference('fontScale', v); // instant DOM feedback while dragging
              setPrefs((prev) => ({ ...prev, fontScale: v }));
            }}
            onMouseUp={(e) => changePref('fontScale', parseInt(e.target.value, 10))}
            onTouchEnd={(e) => changePref('fontScale', parseInt(e.target.value, 10))}
            onKeyUp={(e) => changePref('fontScale', parseInt(e.target.value, 10))}
            className="w-full accent-[color:var(--ui-cyan-strong)]"
            aria-label="Font size percentage"
          />
          <div className="flex justify-between text-[11px] tt-label">
            <span>85%</span><span>100%</span><span>125%</span>
          </div>
        </div>
      </GlassCard>

      {/* ── Motion & Effects ── */}
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tt flex items-center gap-2">
            <Zap className="w-5 h-5 text-[color:var(--status-warning)]" />
            Motion &amp; Effects
          </h2>
          <GlassBadge variant="info">Per user</GlassBadge>
        </div>

        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt">Animation level</p>
            <SavedTick show={savedRows.motion} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MOTION_LEVELS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => changePref('motion', m.value)}
                className={`p-3 rounded-xl border text-center transition-all ${
                  prefs.motion === m.value
                    ? 'border-[color:var(--status-warning)]/70 bg-[color:var(--status-warning-strong)]/10 ring-1 ring-[color:var(--status-warning)]/40'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
                aria-pressed={prefs.motion === m.value}
                title={m.hint}
              >
                <p className="text-sm font-medium tt">{m.label}</p>
                <p className="text-[11px] tt-label">{m.hint}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
          <div className="flex items-center gap-3">
            <Gauge className="w-5 h-5 text-[color:var(--status-success)]" />
            <div>
              <p className="font-medium tt text-sm flex items-center gap-2">
                Performance mode
                <SavedTick show={savedRows.performanceMode} />
              </p>
              <p className="text-xs tt-label">Drop blur effects and heavy shadows — for weak GPUs and battery life</p>
            </div>
          </div>
          <Toggle
            checked={prefs.performanceMode === true}
            onChange={(v) => changePref('performanceMode', v)}
          />
        </div>
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
