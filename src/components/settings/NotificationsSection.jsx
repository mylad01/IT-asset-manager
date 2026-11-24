/**
 * Notifications section — PLAN.MD §13 P3 ("the existing toggles move here
 * out of the mixed sections; scope labels become explicit").
 * - Toast Banners: per-user pref via /api/auth/preferences (every role).
 * - WebSocket / Browser popup: system toggles on the admin-gated
 *   /api/settings — rendered only for IT Admin (fail closed).
 */
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Bell, BellRing, Wifi, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../../utils/apiClient';
import GlassCard from '../glass/GlassCard';
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

function ToggleRow({ icon: Icon, color, label, hint, scope, checked, saved, onChange }) {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${color}`} />
        <div>
          <p className="font-medium tt flex items-center gap-2">
            {label}
            <SavedTick show={saved} />
          </p>
          <p className="text-xs tt-label flex items-center gap-2">
            {hint}
            <span
              className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                scope === 'per user'
                  ? 'text-[color:var(--status-warning-hi)] bg-[color:var(--status-warning-strong)]/15 border border-[color:var(--status-warning-strong)]/30'
                  : 'text-[color:var(--ui-indigo-hi)] bg-[color:var(--ui-indigo-strong)]/15 border border-[color:var(--ui-indigo-strong)]/30'
              }`}
            >
              {scope}
            </span>
          </p>
        </div>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
        <div className="w-11 h-6 bg-white/10 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[color:var(--status-warning-strong)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[color:var(--ui-neutral-hi)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[color:var(--status-warning-strong)]"></div>
      </label>
    </div>
  );
}

export default function NotificationsSection({ role }) {
  const isAdmin = role === 'IT Admin';
  const [toastBannersEnabled, setToastBannersEnabled] = useState(() => readStoredPrefs().toastBannersEnabled !== false);
  const [wsEnabled, setWsEnabled] = useState(true);
  const [browserPopupEnabled, setBrowserPopupEnabled] = useState(true);
  const [savedRows, setSavedRows] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    // System toggles ride the admin-only batch endpoint; admins only.
    if (!isAdmin) return;
    let cancelled = false;
    api.get('/api/settings', { showToast: false }).then(({ ok, data }) => {
      if (!ok || !data?.settings || cancelled) return;
      if (typeof data.settings.ws_enabled !== 'undefined') setWsEnabled(data.settings.ws_enabled === '1');
      if (typeof data.settings.browser_popup_enabled !== 'undefined') setBrowserPopupEnabled(data.settings.browser_popup_enabled === '1');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => () => setError(''), []);

  const flashSaved = (key) => {
    setSavedRows((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => setSavedRows((prev) => ({ ...prev, [key]: false })), 2200);
  };

  const toggleToastBanners = async (value) => {
    setError('');
    const committed = readStoredPrefs().toastBannersEnabled !== false;
    applyPreference('toastBannersEnabled', value);
    setToastBannersEnabled(value);
    const { ok, error: err } = await api.put('/api/auth/preferences', { toastBannersEnabled: value });
    if (!ok) {
      // The optimistic write didn't stick on the server — write the committed
      // value back through the ONE apply path (blob + DOM + ping) so storage
      // never keeps the failed value.
      applyPreference('toastBannersEnabled', committed);
      setToastBannersEnabled(committed);
      setError(err || 'Failed to save preference');
    } else {
      // Live-update fan-out already fired inside applyPreference (the ONE
      // dispatch point) — no per-pref event here anymore.
      flashSaved('toastBannersEnabled');
    }
  };

  const toggleSystem = async (key, value, setter, serverKey) => {
    setError('');
    setter(value);
    const { ok, error: err } = await api.put('/api/settings', { [serverKey]: value });
    if (!ok) {
      setter(!value);
      setError(err || 'Failed to save setting');
    } else {
      flashSaved(key);
    }
  };

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="space-y-4">
      <GlassCard className="p-6">
        <h2 className="text-lg font-semibold tt flex items-center gap-2 mb-4">
          <Bell className="w-5 h-5 text-[color:var(--status-warning)]" />
          Notifications
        </h2>

        <div className="space-y-4">
          <ToggleRow
            icon={BellRing}
            color="text-[color:var(--status-warning)]"
            label="Toast Banners"
            hint="Slide-in banner when a new notification arrives"
            scope="per user"
            checked={toastBannersEnabled}
            saved={savedRows.toastBannersEnabled}
            onChange={toggleToastBanners}
          />
          {isAdmin && (
            <>
              <ToggleRow
                icon={Wifi}
                color="text-[color:var(--ui-indigo)]"
                label="WebSocket Live Updates"
                hint="Real-time notifications via WebSocket connection"
                scope="system"
                checked={wsEnabled}
                saved={savedRows.wsEnabled}
                onChange={(v) => toggleSystem('wsEnabled', v, setWsEnabled, 'wsEnabled')}
              />
              <ToggleRow
                icon={Bell}
                color="text-[color:var(--status-warning)]"
                label="Browser Popup Banner"
                hint="Show popup banner for critical notifications"
                scope="system"
                checked={browserPopupEnabled}
                saved={savedRows.browserPopupEnabled}
                onChange={(v) => toggleSystem('browserPopupEnabled', v, setBrowserPopupEnabled, 'browserPopupEnabled')}
              />
            </>
          )}
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
