/**
 * Brand defaults hook (PLAN.MD §13 P3): applies root-defined defaults for
 * preferences the user has never explicitly set — with PER-ROLE overrides
 * (ui_defaults.roles[role] wins over the base for any key it defines).
 * Called from AuthContext; the brand payload is PUBLIC, so it works on the
 * login screen too (per §13: "applied at login only for keys the user has
 * never explicitly set").
 */
import { useEffect } from 'react';
import { applyBrandDefaults } from '../config/applyPreferences';

export function useBrandDefaults(role) {
  useEffect(() => {
    let cancelled = false;
    fetch('/api/branding')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const roleEntry = role && data.roleDefaults ? data.roleDefaults[role] : null;
        if (data.defaults || roleEntry) applyBrandDefaults(data.defaults, roleEntry);
      })
      .catch(() => {}); // branding is decorative — never block the app
    return () => { cancelled = true; };
  }, [role]);
}
