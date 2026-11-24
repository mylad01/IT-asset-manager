/**
 * applyPreferences() — PLAN.MD §13 P1.
 *
 * The ONE function that turns a preferences object into DOM state: it writes
 * data-* attributes and CSS variables on <html> and persists the blob to
 * localStorage. Components never read preferences directly — they read CSS
 * (token classes) or the two React contexts (theme, toasts). Adding a
 * registry entry with an `attr` and a case in PREF_APPLIERS is all it takes
 * to introduce a new document-level preference.
 *
 * Structure mirrors the registry: PREF_APPLIERS maps key → applier; the
 * registry contract test (scripts/testPreferencesRegistry.js) asserts every
 * registry `attr` has an applier that mentions it.
 *
 * Importable outside React (plain functions, no hooks) so the index.html
 * pre-paint script's logic stays duplicated there on purpose — inline,
 * because it must run before any module loads to avoid FOUC.
 */
import REGISTRY, { PREF_BY_KEY, DEFAULT_USER_PREFS, PREF_TYPES, getThemeMode } from './preferencesRegistry.js';
// Pre-paint single source (PLAN.MD §13): the storage keys and glass tier
// values the module appliers write come from shared/prePaintScript.js —
// the SAME constants the generated index.html inline script uses. The two
// apply paths are behaviorally identical by construction, and the sync
// test executes the generated script to hold the line.
import {
  PREFS_STORAGE_KEY as SHARED_PREFS_KEY,
  GLASS_VAR_TIERS as SHARED_TIERS,
  BOOL_ATTRS as SHARED_BOOL_ATTRS,
  ATTR_VALUE_ENUMS as SHARED_ENUM_ATTRS,
  FONT_SCALE as SHARED_FONT_SCALE,
  ACCENT_COLORS as SHARED_ACCENT_COLORS,
} from '../../shared/prePaintScript.js';
import { dispatchPrefEvent } from '../utils/prefEvents';

/**
 * Retired pre-blob storage key (a bare theme string the pre-paint script
 * and ThemeContext once read). No code reads it anymore; applyPreferences
 * deletes it once per session so stale installs self-clean.
 */
const RETIRED_THEME_KEY = 'studioTheme';

export const PREFS_STORAGE_KEY = SHARED_PREFS_KEY;

/** Read the raw stored blob (localStorage-first; server sync is upstream). */
export function readStoredPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_USER_PREFS };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...DEFAULT_USER_PREFS, ...parsed }
      : { ...DEFAULT_USER_PREFS };
  } catch {
    return { ...DEFAULT_USER_PREFS };
  }
}

/** Persist the blob (called by applyPreferences — callers rarely need this). */
export function storePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / quota — prefs stay session-local, never fatal.
  }
}

// ── Per-key appliers: each mutates document state only ────────────────

// Glass tiers are DATA in shared/prePaintScript.js (derived from
// GLASS_LEVELS); the applier turns each entry into set/remove calls.
// balanced maps to null there → every var is REMOVED so CSS defaults stand.
function applyGlassTier(value) {
  const tierVars = SHARED_TIERS[value] || SHARED_TIERS.balanced;
  const names = ['--glass-blur', '--glass-blur-heavy', '--glass-bg'];
  for (const name of names) {
    if (tierVars && tierVars[name]) document.documentElement.style.setProperty(name, tierVars[name]);
    else document.documentElement.style.removeProperty(name);
  }
}

const GLASS_VAR_TIERS = {
  crystal: () => applyGlassTier('crystal'),
  balanced: () => applyGlassTier('balanced'),
  frosted: () => applyGlassTier('frosted'),
};

const PREF_APPLIERS = {
  theme: (value, effective) => {
    document.documentElement.setAttribute('data-theme', value);
    // Brightness class drives the shared light/dark patch layer — every
    // light preset (Daylight, Paper, …) inherits it; no per-theme overrides.
    const brightness = getThemeMode(value);
    document.documentElement.setAttribute('data-brightness', brightness);
    // The --accent inline var is brightness-dependent: re-derive it from the
    // effective accent pref (kept in sync with the shared pre-paint specs).
    const accentKey = effective?.accent;
    const entry = SHARED_ACCENT_COLORS[accentKey] || SHARED_ACCENT_COLORS.default;
    document.documentElement.style.setProperty('--accent', entry[brightness] || entry.dark);
  },
  glass: (value) => {
    document.documentElement.setAttribute('data-glass', value);
    (GLASS_VAR_TIERS[value] || GLASS_VAR_TIERS.balanced)();
  },
  decor: (value) => {
    // Pure attribute hook — the whole effect layer lives in index.css
    // ([data-decor="…"] body::before), so the applier only flips the key.
    document.documentElement.setAttribute(SHARED_ENUM_ATTRS.decor.attr, value);
  },
  toastBannersEnabled: () => {
    // Consumed via the payload-free prefs-changed ping by NotificationToasts
    // (it re-reads the blob); no document attribute. The event is dispatched
    // by applyPreferences itself after every write — nothing to do here.
  },
  // ── P2 — Layout & Density / Motion & Effects (PLAN.MD §13) ──────────
  // Enum/bool attr appliers derive from the SAME shared constants the
  // generated pre-paint script uses — identical semantics by construction.
  density: (value) => {
    document.documentElement.setAttribute(SHARED_ENUM_ATTRS.density.attr, value);
  },
  fontScale: (value) => {
    // Inline style (not a class): an arbitrary percentage. Tailwind's rem
    // utilities cascade from html font-size, so 85–125% rescales the app.
    const { min, max, fallback } = SHARED_FONT_SCALE;
    const pct = Math.min(max, Math.max(min, Number(value) || fallback));
    document.documentElement.style.fontSize = `${pct}%`;
  },
  motion: (value) => {
    document.documentElement.setAttribute(SHARED_ENUM_ATTRS.motion.attr, value);
  },
  performanceMode: (value) => {
    const spec = SHARED_BOOL_ATTRS.performanceMode;
    document.documentElement.setAttribute(spec.attr, value ? spec.on : spec.off);
  },
  accent: (value) => {
    // data-accent for CSS hooks; --accent inline var per ACTIVE brightness
    // (same derivation the generated pre-paint script performs).
    const spec = SHARED_ENUM_ATTRS.accent;
    document.documentElement.setAttribute(spec.attr, value);
    const entry = SHARED_ACCENT_COLORS[value] || SHARED_ACCENT_COLORS.default;
    document.documentElement.style.setProperty('--accent', entry[document.documentElement.getAttribute('data-brightness')] || entry.dark);
  },
  // ── P3 — Accessibility (PLAN.MD §13) ────────────────────────────────
  reducedTransparency: (value) => {
    const spec = SHARED_BOOL_ATTRS.reducedTransparency;
    document.documentElement.setAttribute(spec.attr, value ? spec.on : spec.off);
  },
  alwaysFocusRings: (value) => {
    const spec = SHARED_BOOL_ATTRS.alwaysFocusRings;
    document.documentElement.setAttribute(spec.attr, value ? spec.on : spec.off);
  },
  largerTouchTargets: (value) => {
    const spec = SHARED_BOOL_ATTRS.largerTouchTargets;
    document.documentElement.setAttribute(spec.attr, value ? spec.on : spec.off);
  },
  // ── P2 — Tables & Data ──────────────────────────────────────────
  pageSize: () => {
    // Consumed by the DataTable adapter (useTablePrefs) via readStoredPrefs;
    // no document attribute.
  },
  dateFormat: () => {
    // Consumed by formatters in src/utils/formatPref.js; no attribute.
  },
  timeFormat: () => {
    // Consumed by formatters in src/utils/formatPref.js; no attribute.
  },
  hideColumnTotals: () => {
    // Consumed by DataTable directly; no attribute.
  },
};

/**
 * Apply a preferences object to the document. Unknown keys are ignored
 * (defense in depth — the server already sanitizes). Called with NO argument
 * it applies the STORED blob (never the bare defaults — storing defaults
 * here would wipe the user's saved prefs at every boot; the main.jsx boot
 * call relies on this). Returns the effective object applied.
 */
export function applyPreferences(prefs) {
  const effective = prefs === undefined
    ? readStoredPrefs()
    : { ...DEFAULT_USER_PREFS, ...(prefs || {}) };
  for (const pref of REGISTRY) {
    if (pref.scope !== 'user') continue;
    const applier = PREF_APPLIERS[pref.key];
    if (applier) applier(effective[pref.key], effective);
  }
  storePrefs(effective);
  // Ping live listeners (NotificationToasts' banner ref, …) — payload-free;
  // they re-read the blob so no event shape can drift.
  dispatchPrefEvent();
  // One-time sweep of the retired legacy key (bare studioTheme string from
  // pre-blob installs): nothing reads it anymore, so drop it from storage.
  // Runs on every applyPreferences() — i.e. every boot via main.jsx — but
  // localStorage only holds the key on installs that predate the blob.
  try { localStorage.removeItem(RETIRED_THEME_KEY); } catch { /* private mode */ }
  return effective;
}

/** Apply just one key (used by the toggle handlers for snappy single-key updates). */
export function applyPreference(key, value) {
  const pref = PREF_BY_KEY[key];
  if (!pref) return false;
  if (pref.type === PREF_TYPES.ENUM && pref.values && !pref.values.includes(value)) return false;
  if (pref.type === PREF_TYPES.BOOL && typeof value !== 'boolean') return false;
  const applier = PREF_APPLIERS[key];
  if (applier) applier(value);
  storePrefs({ ...readStoredPrefs(), [key]: value, _touched: markTouched(readStoredPrefs(), key) });
  // Single fan-out point: every storage write pings live listeners.
  dispatchPrefEvent();
  return true;
}

/**
 * Preview one key WITHOUT persisting anything (PLAN.MD §13 "try this
 * theme" / hover-preview): the applier runs so the DOM reflects the
 * candidate instantly, but the stored blob, the _touched list, and the
 * server are untouched. End the preview with revertPreference() — callers
 * pass the COMMITTED value they captured when the preview started, so a
 * save that landed mid-preview is restored to its actual state.
 */
export function previewPreference(key, value) {
  const pref = PREF_BY_KEY[key];
  if (!pref) return false;
  if (pref.type === PREF_TYPES.ENUM && pref.values && !pref.values.includes(value)) return false;
  if (pref.type === PREF_TYPES.BOOL && typeof value !== 'boolean') return false;
  const applier = PREF_APPLIERS[key];
  if (applier) applier(value);
  return true;
}

/**
 * Restore a key to its committed value after a preview. Same as
 * previewPreference but expressed as a revert for readability; pass the
 * value returned by readStoredPrefs()[key] captured BEFORE previewing.
 */
export function revertPreference(key, committedValue) {
  return previewPreference(key, committedValue);
}

// ── P3 — Brand defaults (PLAN.MD §13): root-defined per-role defaults for
// keys the user has NEVER explicitly set. "Touched" = any key changed via
// applyPreference/applyPreferences at least once (tracked in the blob's
// _touched array; settings pages touch their keys, so a user who ever
// picked a theme is never overridden by branding).
const TOUCHED_KEY = '_touched';

function markTouched(prefs, key) {
  const list = Array.isArray(prefs?.[TOUCHED_KEY]) ? prefs[TOUCHED_KEY] : [];
  return list.includes(key) ? list : [...list, key];
}

/**
 * Apply root-defined brand defaults (from GET /api/branding) for keys the
 * user has never touched. `brandDefaults` is the blob's `defaults` object;
 * `roleDefaults` (optional) carries per-role overrides — the user's role
 * entry wins over the base for any key it defines. Returns the merged
 * effective prefs, or null when nothing was applicable (so callers can
 * skip re-render work).
 */
export function applyBrandDefaults(brandDefaults, roleDefaults) {
  if (!brandDefaults || typeof brandDefaults !== 'object') return null;
  const stored = readStoredPrefs();
  const touched = Array.isArray(stored[TOUCHED_KEY]) ? stored[TOUCHED_KEY] : [];
  // Role overrides win over base per key (only for keys the role defines).
  const effectiveDefaults = (roleDefaults && typeof roleDefaults === 'object' && !Array.isArray(roleDefaults))
    ? { ...brandDefaults, ...roleDefaults }
    : brandDefaults;
  const applicable = Object.entries(effectiveDefaults).filter(([key, value]) =>
    PREF_BY_KEY[key] !== undefined && value !== undefined && value !== null && !touched.includes(key));
  if (applicable.length === 0) return null;
  const merged = { ...stored };
  for (const [key, value] of applicable) {
    const pref = PREF_BY_KEY[key];
    // Coerce through the registry's own rules (enum membership etc.).
    if (pref.type === PREF_TYPES.ENUM && pref.values && !pref.values.includes(value)) continue;
    if (pref.type === PREF_TYPES.INT) {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n)) continue;
      merged[key] = Math.min(pref.max ?? n, Math.max(pref.min ?? n, n));
    } else {
      merged[key] = value;
    }
  }
  applyPreferences(merged);
  return merged;
}
