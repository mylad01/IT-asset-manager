/**
 * Branding & Defaults section — PLAN.MD §13 P3 (root-only).
 * App name (sidebar wordmark + document.title), logo upload, and per-role
 * UI defaults stored in system_settings via /api/settings/branding.
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Building2, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../../utils/apiClient';
import GlassCard from '../glass/GlassCard';
import GlassBadge from '../glass/GlassBadge';
import { THEME_PRESETS, DENSITY_LEVELS, MOTION_LEVELS, ACCENT_PALETTE, sectionsVisibleToRole } from '../../config/preferencesRegistry';

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

export default function BrandingSection() {
  const [brandName, setBrandName] = useState('');
  const [brandLogo, setBrandLogo] = useState(null);
  const [defaults, setDefaults] = useState({});
  const [roleDefaults, setRoleDefaults] = useState({});
  const [savedName, setSavedName] = useState(false);
  const [savedDefaults, setSavedDefaults] = useState(false);
  const [savedRoles, setSavedRoles] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/settings/branding', { showToast: false }).then(({ ok, data }) => {
      if (cancelled || !ok || !data) return;
      setBrandName(data.brandName || '');
      setBrandLogo(data.brandLogo || null);
      setDefaults(data.defaults || {});
      setRoleDefaults(data.roleDefaults || {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const saveBrand = async () => {
    setError('');
    const { ok, error: err } = await api.put('/api/settings/branding', { brandName });
    if (!ok) setError(err || 'Failed to save branding');
    else {
      setSavedName(true);
      setTimeout(() => setSavedName(false), 2200);
    }
  };

  const saveDefaults = async (next) => {
    setError('');
    setDefaults(next);
    const { ok, error: err } = await api.put('/api/settings/branding', {
      defaultTheme: next.theme,
      defaultAccent: next.accent,
      defaultDensity: next.density,
      defaultMotion: next.motion,
    });
    if (!ok) setError(err || 'Failed to save defaults');
    else {
      setSavedDefaults(true);
      setTimeout(() => setSavedDefaults(false), 2200);
    }
  };

  const saveRoleDefaults = async (role, entry) => {
    setError('');
    const next = { ...roleDefaults, [role]: entry };
    setRoleDefaults(next);
    const { ok, error: err } = await api.put('/api/settings/branding', { roleDefaults: { [role]: entry } });
    if (!ok) setError(err || 'Failed to save role defaults');
    else {
      setSavedRoles(true);
      setTimeout(() => setSavedRoles(false), 2200);
    }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setError('');
    const form = new FormData();
    form.append('logo', file);
    const { ok, data, error: err } = await api.post('/api/settings/branding/logo', form);
    if (!ok) setError(err || 'Logo upload failed');
    else setBrandLogo(data?.brandLogo || null);
  };

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="space-y-4">
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tt flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[color:var(--ui-sky)]" />
            Branding & Defaults
          </h2>
          <GlassBadge variant="info">Root only</GlassBadge>
        </div>

        <p className="tt-sec mb-4">
          The workspace identity and the defaults applied to NEW users — per-user choices always win once set.
        </p>

        {/* Brand name */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt">App name</p>
            <SavedTick show={savedName} />
          </div>
          <div className="flex gap-2">
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              maxLength={40}
              placeholder="Studio IT Sync"
              className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/15 tt text-sm focus:outline-none focus:border-[color:var(--ui-sky)]/50"
            />
            <button
              type="button"
              onClick={saveBrand}
              className="px-4 py-2 rounded-lg bg-[color:var(--ui-sky-strong)]/20 border border-[color:var(--ui-sky)]/40 text-sm font-medium tt hover:bg-[color:var(--ui-sky-strong)]/30 transition-colors"
            >
              Save name
            </button>
          </div>
          <p className="text-[11px] tt-muted mt-1">Shown in the sidebar and as the browser tab title.</p>
        </div>

        {/* Logo */}
        <div className="mb-6">
          <p className="text-sm font-medium tt mb-2">Logo</p>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl border border-white/15 bg-white/5 flex items-center justify-center overflow-hidden">
              {brandLogo
                ? <img src={brandLogo} alt="Brand logo" className="w-full h-full object-contain" />
                : <span className="text-[10px] tt-label uppercase">none</span>}
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                className="hidden"
                onChange={(e) => uploadLogo(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-white/10 border border-white/15 text-sm font-medium tt hover:bg-white/15 transition-colors flex items-center gap-2"
              >
                <Upload size={14} /> Upload logo
              </button>
              <p className="text-[11px] tt-muted mt-1">PNG, JPG, SVG, WebP or GIF — up to 2 MB.</p>
            </div>
          </div>
        </div>

        {/* Defaults for new users */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt">Defaults for new users</p>
            <SavedTick show={savedDefaults} />
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs tt-label w-24 shrink-0">Accent</span>
              <select
                value={defaults.accent || ''}
                onChange={(e) => saveDefaults({ ...defaults, accent: e.target.value })}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm focus:outline-none focus:border-[color:var(--ui-sky)]/50"
              >
                <option value="">Registry default (Default Blue)</option>
                {ACCENT_PALETTE.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs tt-label w-24 shrink-0">Theme</span>
              <select
                value={defaults.theme || ''}
                onChange={(e) => saveDefaults({ ...defaults, theme: e.target.value })}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm focus:outline-none focus:border-[color:var(--ui-sky)]/50"
              >
                <option value="">Registry default (Studio Dark)</option>
                {THEME_PRESETS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs tt-label w-24 shrink-0">Density</span>
              <select
                value={defaults.density || ''}
                onChange={(e) => saveDefaults({ ...defaults, density: e.target.value })}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm focus:outline-none focus:border-[color:var(--ui-sky)]/50"
              >
                <option value="">Registry default (Comfortable)</option>
                {DENSITY_LEVELS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs tt-label w-24 shrink-0">Motion</span>
              <select
                value={defaults.motion || ''}
                onChange={(e) => saveDefaults({ ...defaults, motion: e.target.value })}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm focus:outline-none focus:border-[color:var(--ui-sky)]/50"
              >
                <option value="">Registry default (Full)</option>
                {MOTION_LEVELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] tt-muted mt-2">
            Staff sections available for defaults: {sectionsVisibleToRole('Staff').length} of 7. Empty choice = registry default.
          </p>
        </div>

        {/* Per-role overrides (PLAN.MD §13: Staff vs Read-Only) */}
        <div className="mt-6 pt-6 border-t border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium tt">Role overrides</p>
            <SavedTick show={savedRoles} />
          </div>
          <p className="text-[11px] tt-muted mb-3">
            Overrides apply to users of that role who have never changed a preference themselves — per-user choices always win.
          </p>
          <div className="space-y-4">
            {['Staff', 'Read-Only'].map((role) => (
              <div key={role} className="p-4 rounded-lg bg-white/5">
                <p className="text-sm font-medium tt mb-2">{role}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs tt-label w-16 shrink-0">Theme</span>
                    <select
                      value={roleDefaults[role]?.theme || ''}
                      onChange={(e) => saveRoleDefaults(role, { ...roleDefaults[role], theme: e.target.value })}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm focus:outline-none focus:border-[color:var(--ui-sky)]/50"
                    >
                      <option value="">Base default</option>
                      {THEME_PRESETS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tt-label w-16 shrink-0">Density</span>
                    <select
                      value={roleDefaults[role]?.density || ''}
                      onChange={(e) => saveRoleDefaults(role, { ...roleDefaults[role], density: e.target.value })}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm focus:outline-none focus:border-[color:var(--ui-sky)]/50"
                    >
                      <option value="">Base default</option>
                      {DENSITY_LEVELS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tt-label w-16 shrink-0">Accent</span>
                    <select
                      value={roleDefaults[role]?.accent || ''}
                      onChange={(e) => saveRoleDefaults(role, { ...roleDefaults[role], accent: e.target.value })}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm focus:outline-none focus:border-[color:var(--ui-sky)]/50"
                    >
                      <option value="">Base default</option>
                      {ACCENT_PALETTE.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tt-label w-16 shrink-0">Motion</span>
                    <select
                      value={roleDefaults[role]?.motion || ''}
                      onChange={(e) => saveRoleDefaults(role, { ...roleDefaults[role], motion: e.target.value })}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm focus:outline-none focus:border-[color:var(--ui-sky)]/50"
                    >
                      <option value="">Base default</option>
                      {MOTION_LEVELS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
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
