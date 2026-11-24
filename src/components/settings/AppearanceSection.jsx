/**
 * Appearance section — PLAN.MD §13 P1.
 *
 * Theme + glass-intensity controls backed by the preferences registry.
 * Every control writes through applyPreference() (instant DOM effect +
 * localStorage) and PUT /api/auth/preferences (server persistence, any
 * role — per-user scope). Save-state per control mirrors the existing
 * SavedTick pattern from the lifecycle rows.
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Palette, Layers, Sparkles, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../../utils/apiClient';
import GlassCard from '../glass/GlassCard';
import GlassBadge from '../glass/GlassBadge';
import { THEME_PRESETS, GLASS_LEVELS, DECOR_LEVELS } from '../../config/preferencesRegistry';
import { applyPreference, previewPreference, revertPreference, readStoredPrefs } from '../../config/applyPreferences';

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

export default function AppearanceSection() {
  const [prefs, setPrefs] = useState(() => readStoredPrefs());
  const [savedRows, setSavedRows] = useState({});
  const [error, setError] = useState('');
  // Hover-to-preview (PLAN.MD §13 "try this theme"): hovering a preset
  // chip applies it DOM-only (no blob/_touched/server writes); leaving the
  // gallery restores the committed theme captured at hover-start.
  const [previewed, setPreviewed] = useState(null);
  const committedRef = useRef(null);
  // Decor chips mirror the same preview/revert pattern, keyed separately so
  // a decor hover can never clobber an in-flight theme preview (and vice
  // versa) — two independent keys, two independent committed snapshots.
  const [decorPreviewed, setDecorPreviewed] = useState(null);
  const decorCommittedRef = useRef(null);

  useEffect(() => () => setError(''), []);

  const flashSaved = (key) => {
    setSavedRows((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => setSavedRows((prev) => ({ ...prev, [key]: false })), 2200);
  };

  const changePref = async (key, value) => {
    setError('');
    // A click TURNS an active preview into a commit: drop the preview
    // bookkeeping FIRST (without reverting — the value is applied for real
    // on the next line), so the gallery's later mouse-leave can't snap the
    // DOM back to the pre-hover value while the blob holds the new one.
    // After this, the save-failure revert below falls back to prefs[key]
    // (the last committed value), which is exactly the truth.
    if (key === 'theme' && previewed !== null) {
      setPreviewed(null);
      committedRef.current = null;
    }
    if (key === 'decor' && decorPreviewed !== null) {
      setDecorPreviewed(null);
      decorCommittedRef.current = null;
    }
    // 1. Optimistic DOM + localStorage (instant, works even if the save fails).
    applyPreference(key, value);
    setPrefs((prev) => ({ ...prev, [key]: value }));
    // 2. Server persistence (any role — per-user prefs route).
    const { ok, error: err } = await api.put('/api/auth/preferences', { [key]: value });
    if (!ok) {
      setError(err || 'Failed to save preference');
      // The optimistic write didn't stick on the server — revert the DOM
      // (and storage) to the committed value so the user sees the truth.
      revertPreference(key, committedRef.current?.[key] ?? prefs[key]);
      setPrefs((prev) => ({ ...prev, [key]: readStoredPrefs()[key] }));
    } else {
      flashSaved(key);
      // (The old hand-rolled toast-banners-pref dispatch is gone —
      // applyPreference's payload-free prefs-changed ping covers it.)
    }
  };

  // ── Hover-to-preview ────────────────────────────────────────────────
  const beginPreview = (value) => {
    if (previewed !== null || value === prefs.theme) return;
    // Capture the committed theme ONCE at hover-start (only the committed
    // value — never a preview value — may be restored on mouse-leave).
    if (!committedRef.current) committedRef.current = { theme: prefs.theme };
    setPreviewed(value);
    previewPreference('theme', value);
  };

  const endPreview = () => {
    if (previewed === null) return;
    setPreviewed(null);
    revertPreference('theme', committedRef.current.theme);
    committedRef.current = null;
  };

  // ── Hover-to-preview (decor — same pattern as the theme gallery) ──────
  // Unlike the theme guard, a second hover UPDATES the preview live (you
  // sweep across four chips and see each one); the committed snapshot is
  // still captured exactly once at hover-start.
  const beginDecorPreview = (value) => {
    if (value === prefs.decor) { endDecorPreview(); return; } // hovering the committed chip → show the truth
    if (!decorCommittedRef.current) decorCommittedRef.current = { decor: prefs.decor };
    setDecorPreviewed(value);
    previewPreference('decor', value);
  };

  const endDecorPreview = () => {
    if (decorPreviewed === null) return;
    setDecorPreviewed(null);
    revertPreference('decor', decorCommittedRef.current.decor);
    decorCommittedRef.current = null;
  };

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="space-y-4">
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tt flex items-center gap-2">
            <Palette className="w-5 h-5 text-[color:var(--ui-indigo)]" />
            Appearance
          </h2>
          <GlassBadge variant="info">Per user</GlassBadge>
        </div>

        <p className="tt-sec mb-4">
          Your personal look for this workspace — changes apply instantly and follow your account.
        </p>

        {/* Theme presets */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt">Theme</p>
            <SavedTick show={savedRows.theme} />
          </div>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            onMouseLeave={endPreview}
          >
            {THEME_PRESETS.map((t) => {
              const isPreview = previewed === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => changePref('theme', t.value)}
                  onMouseEnter={() => beginPreview(t.value)}
                  onFocus={() => beginPreview(t.value)}
                  onBlur={endPreview}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    isPreview
                      ? 'border-[color:var(--status-warning)]/70 bg-[color:var(--status-warning-strong)]/10 ring-1 ring-[color:var(--status-warning)]/40'
                      : prefs.theme === t.value
                        ? 'border-[color:var(--ui-indigo)]/70 bg-[color:var(--ui-indigo-strong)]/10 ring-1 ring-[color:var(--ui-indigo)]/40'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                // aria-pressed reflects the COMMITTED state only — a hover
                // preview must never read as a selection to assistive tech.
                  aria-pressed={prefs.theme === t.value}
                  title={t.hint}
                >
                  {/* Swatch comes from the registry — adding a preset needs
                      no JSX change (PLAN.MD §13: presets are data). */}
                  <div
                    className="h-10 rounded-lg mb-2 border border-white/15"
                    style={{ background: t.swatch }}
                  />
                  <p className="text-sm font-medium tt">{t.label}</p>
                  <p className="text-[11px] tt-label">{t.hint}</p>
                  {isPreview && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--status-warning-hi)]">
                      Previewing — click to keep
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] tt-muted mt-2">
            Hover a preset to try it on instantly — nothing is saved until you click.
          </p>
        </div>

        {/* Surface decor (registry `decor` — the trend layer) */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[color:var(--ui-pink)]" /> Surface effect
            </p>
            <SavedTick show={savedRows.decor} />
          </div>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            onMouseLeave={endDecorPreview}
          >
            {DECOR_LEVELS.map((d) => {
              const isPreview = decorPreviewed === d.value;
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => changePref('decor', d.value)}
                  onMouseEnter={() => beginDecorPreview(d.value)}
                  onFocus={() => beginDecorPreview(d.value)}
                  onBlur={endDecorPreview}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    isPreview
                      ? 'border-[color:var(--status-warning)]/70 bg-[color:var(--status-warning-strong)]/10 ring-1 ring-[color:var(--status-warning)]/40'
                      : prefs.decor === d.value
                        ? 'border-[color:var(--ui-pink)]/70 bg-[color:var(--ui-pink-strong)]/10 ring-1 ring-[color:var(--ui-pink)]/40'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                // aria-pressed reflects the COMMITTED state only — a hover
                // preview must never read as a selection to assistive tech.
                  aria-pressed={prefs.decor === d.value}
                  title={d.hint}
                >
                  {/* Swatch comes from the registry — adding a decor value
                      needs no JSX change (same rule as theme presets). */}
                  <div
                    className="h-10 rounded-lg mb-2 border border-white/15"
                    style={{ background: d.swatch }}
                  />
                  <p className="text-sm font-medium tt">{d.label}</p>
                  <p className="text-[11px] tt-label">{d.hint}</p>
                  {isPreview && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--status-warning-hi)]">
                      Previewing — click to keep
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] tt-muted mt-2">
            Hover to try one on instantly — nothing is saved until you click. The layer sits behind everything and combines with any theme and accent; Aurora's drift pauses when motion or performance mode is reduced.
          </p>
        </div>

        {/* Glass intensity */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-[color:var(--ui-violet)]" /> Glass intensity
            </p>
            <SavedTick show={savedRows.glass} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {GLASS_LEVELS.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => changePref('glass', g.value)}
                className={`p-3 rounded-xl border text-center transition-all ${
                  prefs.glass === g.value
                    ? 'border-[color:var(--ui-violet)]/70 bg-[color:var(--ui-violet-strong)]/10 ring-1 ring-[color:var(--ui-violet)]/40'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
                aria-pressed={prefs.glass === g.value}
                title={g.hint}
              >
                <p className="text-sm font-medium tt">{g.label}</p>
                <p className="text-[11px] tt-label">{g.hint}</p>
              </button>
            ))}
          </div>
          <p className="text-[11px] tt-muted mt-2">
            Frosted reduces blur effects — helpful on lower-end GPUs or when the background looks too busy.
          </p>
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
