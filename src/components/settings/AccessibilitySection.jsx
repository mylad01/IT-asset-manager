/**
 * Accessibility section — PLAN.MD §13 P3.
 * Three opt-in toggles (reduced transparency / always-on focus rings /
 * larger touch targets) backed by the preferences registry. Same
 * optimistic-apply → server PUT pattern as AppearanceSection.
 */
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Accessibility, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../../utils/apiClient';
import GlassCard from '../glass/GlassCard';
import GlassBadge from '../glass/GlassBadge';
import { applyPreference, readStoredPrefs } from '../../config/applyPreferences';

const A11Y_ROWS = [
  { key: 'reducedTransparency', label: 'Reduced transparency', hint: 'Solid surfaces instead of translucent glass — keeps depth, drops see-through fills' },
  { key: 'alwaysFocusRings', label: 'Always-visible focus rings', hint: 'Never hide where keyboard focus is — recommended for keyboard navigation' },
  { key: 'largerTouchTargets', label: 'Larger touch targets', hint: 'Bigger minimum hit areas for buttons, checkboxes and links' },
];

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

export default function AccessibilitySection() {
  const [prefs, setPrefs] = useState(() => readStoredPrefs());
  const [savedRows, setSavedRows] = useState({});
  const [error, setError] = useState('');

  useEffect(() => () => setError(''), []);

  const flashSaved = (key) => {
    setSavedRows((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => setSavedRows((prev) => ({ ...prev, [key]: false })), 2200);
  };

  const toggle = async (key, value) => {
    setError('');
    applyPreference(key, value);
    setPrefs((prev) => ({ ...prev, [key]: value }));
    const { ok, error: err } = await api.put('/api/auth/preferences', { [key]: value });
    if (!ok) setError(err || 'Failed to save preference');
    else flashSaved(key);
  };

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="space-y-4">
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tt flex items-center gap-2">
            <Accessibility className="w-5 h-5 text-[color:var(--status-success)]" />
            Accessibility
          </h2>
          <GlassBadge variant="info">Per user</GlassBadge>
        </div>

        <p className="tt-sec mb-4">
          Comfort options for vision, motion and motor accessibility — they apply instantly and follow your account.
        </p>

        <div className="space-y-4">
          {A11Y_ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-medium tt flex items-center gap-2">
                    {row.label}
                    <SavedTick show={savedRows[row.key]} />
                  </p>
                  <p className="text-xs tt-label">{row.hint}</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!prefs[row.key]}
                  onChange={(e) => toggle(row.key, e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[color:var(--status-success-strong)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[color:var(--ui-neutral-hi)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[color:var(--status-success-strong)]"></div>
              </label>
            </div>
          ))}
        </div>

        {error && (
          <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold flex items-center gap-2 mt-4">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
      </GlassCard>
    </motion.section>
  );
}
