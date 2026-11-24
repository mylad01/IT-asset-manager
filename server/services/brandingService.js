// Branding service (PLAN.MD §13 P3 — "Branding & Defaults").
//
// Root-editable brand identity + per-role UI defaults, stored in the
// existing system_settings table:
//   brand_name  — sidebar wordmark + document.title (fallback 'Studio IT Sync')
//   brand_logo  — /uploads/branding/<file> (validated at upload time)
//   ui_defaults — JSON {
//     theme?/accent?/density?/motion?,   — base defaults
//     roles: { 'Staff': {...}, 'Read-Only': {...} }  — per-role overrides
//   } applied at login for keys the user has never explicitly set (the
//   blob's per-user values always win once set). Role entries are VALIDATED
//   with the same whitelist as the base; unknown roles/keys are dropped.
// Values are re-validated on READ so a hand-edited DB row can never leak a
// broken enum into the frontend — the same "sanitize at the boundary"
// policy the user-prefs blob follows. Enums come from the server mirror
// (validators/uiPrefsSchema.js) so there is exactly one server-side copy.
import * as settingsModel from '../models/settingsModel.js';
import { UI_PREFS_ENUMS } from '../validators/uiPrefsSchema.js';

const ALLOWED_DEFAULTS = {
  theme: UI_PREFS_ENUMS.theme,
  accent: UI_PREFS_ENUMS.accent,
  density: UI_PREFS_ENUMS.density,
  motion: UI_PREFS_ENUMS.motion,
};

/** Roles that may carry overrides — the app's non-admin role set. */
export const ALLOWED_ROLES = ['Staff', 'Read-Only', 'Department Manager'];

export const DEFAULT_BRAND_NAME = 'Studio IT Sync';

/** Read + sanitize the stored brand. Never throws on bad rows — degrades. */
export async function readStoredBrand() {
  const [name, logo, defaultsRaw] = await Promise.all([
    settingsModel.get('brand_name'),
    settingsModel.get('brand_logo'),
    settingsModel.get('ui_defaults'),
  ]);

  let defaults = {};
  try {
    const parsed = JSON.parse(defaultsRaw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) defaults = parsed;
  } catch {
    defaults = {}; // corrupt blob — same degradation rule as user prefs
  }

  const clean = {};
  for (const [key, allowed] of Object.entries(ALLOWED_DEFAULTS)) {
    if (allowed.includes(defaults[key])) clean[key] = defaults[key];
  }

  // Per-role overrides: same whitelist per entry, unknown roles dropped.
  // A role entry may also legitimately be an empty object ("no overrides").
  let roles = {};
  if (defaults.roles && typeof defaults.roles === 'object' && !Array.isArray(defaults.roles)) {
    for (const role of ALLOWED_ROLES) {
      const entry = defaults.roles[role];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const cleanEntry = {};
      for (const [key, allowed] of Object.entries(ALLOWED_DEFAULTS)) {
        if (allowed.includes(entry[key])) cleanEntry[key] = entry[key];
      }
      roles[role] = cleanEntry;
    }
  }

  return {
    brandName: (name && String(name).trim()) || DEFAULT_BRAND_NAME,
    brandLogo: logo && String(logo).startsWith('/uploads/branding/') ? String(logo) : null,
    defaults: clean,
    roleDefaults: roles,
  };
}
