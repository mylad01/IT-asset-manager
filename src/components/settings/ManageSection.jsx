/**
 * Manage section — PLAN.MD §13 P3 ("export/import prefs as JSON,
 * per-section reset").
 * Export downloads the sanitized blob; import validates through the same
 * server schema the panel writes with (invalid files are rejected whole —
 * never half-applied); reset clears every stored key back to registry
 * defaults through the normal apply path.
 */
import React, { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, Upload as UploadIcon, RotateCcw, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../../utils/apiClient';
import GlassCard from '../glass/GlassCard';
import GlassBadge from '../glass/GlassBadge';
import GlassConfirmModal from '../glass/GlassConfirmModal';
import { DEFAULT_USER_PREFS, PREF_SECTIONS_META } from '../../config/preferencesRegistry';
import { applyPreferences, readStoredPrefs } from '../../config/applyPreferences';

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

export default function ManageSection() {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => () => setError(''), []);

  const exportPrefs = () => {
    const blob = new Blob(
      [JSON.stringify({ app: 'it-asset-manager', kind: 'ui-preferences', version: 1, prefs: readStoredPrefs() }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ui-preferences.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importPrefs = async (file) => {
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const prefs = parsed && parsed.kind === 'ui-preferences' ? parsed.prefs : parsed;
      // Server validates with the same schema the panel writes with — the
      // import is atomic (whole blob), never half-applied.
      const { ok, data, error: err } = await api.put('/api/auth/preferences', prefs);
      if (!ok) {
        setError(err || 'Import rejected — invalid preferences file');
        return;
      }
      applyPreferences(data || { ...DEFAULT_USER_PREFS, ...prefs });
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch {
      setError('Import failed — not a valid JSON preferences file');
    }
  };

  const resetAll = async () => {
    setConfirmReset(false);
    setError('');
    // Whole-blob reset: write every key back to its registry default via
    // the normal server path, then re-apply locally from the response.
    const { ok, data, error: err } = await api.put('/api/auth/preferences', { ...DEFAULT_USER_PREFS });
    if (!ok) {
      setError(err || 'Reset failed');
      return;
    }
    applyPreferences(data || DEFAULT_USER_PREFS);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="space-y-4">
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tt flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-[color:var(--ui-violet)]" />
            Manage Preferences
          </h2>
          <GlassBadge variant="info">Per user</GlassBadge>
        </div>

        <p className="tt-sec mb-4">
          Take your look with you — export applies cleanly on another workstation; import replaces every preference at once.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={exportPrefs}
            className="px-4 py-2 rounded-lg bg-[color:var(--ui-violet-strong)]/20 border border-[color:var(--ui-violet)]/40 text-sm font-medium tt hover:bg-[color:var(--ui-violet-strong)]/30 transition-colors flex items-center gap-2"
          >
            <Download size={14} /> Export JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => importPrefs(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-lg bg-white/10 border border-white/15 text-sm font-medium tt hover:bg-white/15 transition-colors flex items-center gap-2"
          >
            <UploadIcon size={14} /> Import JSON
          </button>
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="px-4 py-2 rounded-lg bg-[color:var(--status-danger-strong)]/15 border border-[color:var(--status-danger)]/40 text-sm font-medium tt hover:bg-[color:var(--status-danger-strong)]/25 transition-colors flex items-center gap-2"
          >
            <RotateCcw size={14} /> Reset to defaults
          </button>
          <SavedTick show={saved} />
        </div>

        <p className="text-[11px] tt-muted mt-3">
          {PREF_SECTIONS_META.length} sections · {Object.keys(DEFAULT_USER_PREFS).length} preferences — export/import covers all of them.
        </p>

        {error && (
          <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold flex items-center gap-2 mt-4">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <GlassConfirmModal
          isOpen={confirmReset}
          onClose={() => setConfirmReset(false)}
          onConfirm={resetAll}
          title="Reset all preferences?"
          message="Every personal preference (theme, glass, density, accessibility, tables) returns to its default. This cannot be undone."
          confirmText="Reset everything"
          cancelText="Cancel"
          variant="danger"
        />
      </GlassCard>
    </motion.section>
  );
}
