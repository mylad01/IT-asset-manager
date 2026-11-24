/**
 * Preferences registry — PLAN.MD §13 P1.
 *
 * The single source of truth for every UI preference: sections on the
 * Settings panel, the server-side zod schema for PUT /api/auth/preferences,
 * localStorage keys, defaults, and the data attributes / CSS variables that
 * applyPreferences() writes on <html>. Everything is DATA here — the renderers
 * and validators derive from it (the doctor's FIX_REGISTRY pattern applied to
 * the UI). A preference that is not in this registry does not exist as far as
 * either the client or the server is concerned.
 *
 * Server import note (CLAUDE.md layering): the server does NOT import this
 * file — server/validators/uiPrefsSchema.js mirrors it in zod, and
 * scripts/testPreferencesRegistry.js asserts the two stay in sync
 * (registry ⇄ schema, the doctor check-#11 guard-coverage idea applied to
 * prefs). A key added here without its mirror fails that test.
 */

export const PREF_SCOPES = { USER: 'user', SYSTEM: 'system' };

export const PREF_TYPES = {
  ENUM: 'enum',
  BOOL: 'bool',
  INT: 'int',
};

/**
 * Theme presets — token sets on <html data-theme> (PLAN.MD §13: presets,
 * not an axis). `mode` ('dark' | 'light') is the BRIGHTNESS class each
 * preset belongs to: index.css's compatibility patch layer is keyed on
 * [data-brightness] (applied by applyPreferences from this map), so every
 * light preset inherits the text/contrast overrides with ZERO per-theme
 * CSS — that is the proof the preset model scales. A new preset needs
 * exactly: an entry here + one token-delta block + one body gradient in
 * index.css. `tokens` says where the preset's token set lives: 'base' =
 * the :root set itself (dark, no delta block), 'patch' = completed by the
 * shared [data-brightness] patch layer (light presets — ZERO per-theme CSS),
 * 'delta' (default) = one [data-theme] token-delta block. That enumeration
 * is the proof the model scales: a new preset needs an entry here + its
 * tokens block + one body gradient, nothing else. `swatch` feeds the
 * Appearance gallery's preview chip.
 */
export const THEME_PRESETS = [
  { value: 'dark', label: 'Studio Dark', hint: 'Vibrant gradient, deep glass', mode: 'dark', tokens: 'base', swatch: 'linear-gradient(135deg, #3b28cc, #a855f7, #f43f5e)' },
  { value: 'midnight', label: 'Midnight', hint: 'Deep navy, focus-friendly', mode: 'dark', tokens: 'delta', swatch: 'linear-gradient(135deg, #0f172a, #1e293b, #334155)' },
  { value: 'ember', label: 'Ember', hint: 'Warm charcoal, amber glow', mode: 'dark', tokens: 'delta', swatch: 'linear-gradient(135deg, #1c1410, #3b2a1a, #b45309)' },
  { value: 'noir', label: 'Noir', hint: 'Pure black, silver accents', mode: 'dark', tokens: 'delta', swatch: 'linear-gradient(135deg, #000000, #18181b, #52525b)' },
  { value: 'aurora', label: 'Aurora', hint: 'Teal-green northern glow', mode: 'dark', tokens: 'delta', swatch: 'linear-gradient(135deg, #042f2e, #0d9488, #4c1d95)' },
  { value: 'slate', label: 'Slate', hint: 'Cool graphite, steel blue', mode: 'dark', tokens: 'delta', swatch: 'linear-gradient(135deg, #1e293b, #64748b, #cbd5e1)' },
  { value: 'light', label: 'Daylight', hint: 'Soft light glass', mode: 'light', tokens: 'patch', swatch: 'linear-gradient(135deg, #c4b5fd, #f9a8d4, #93c5fd)' },
  { value: 'paper', label: 'Paper', hint: 'Warm minimal daylight', mode: 'light', tokens: 'delta', swatch: 'linear-gradient(135deg, #e7e0d8, #f3ede4, #dcd3c6)' },
  { value: 'matcha', label: 'Matcha', hint: 'Soft green tea daylight', mode: 'light', tokens: 'delta', swatch: 'linear-gradient(135deg, #d4e2c6, #a3b98a, #eef3e6)' },
];

/** Brightness class for a theme value ('dark' | 'light'); unknown → dark. */
export function getThemeMode(value) {
  return THEME_PRESETS.find((t) => t.value === value)?.mode || 'dark';
}

/**
 * Accent palette (PLAN.MD §13 "theme engine v2"). Each entry carries its
 * own native-form colors — dark entries keep the default blue; light
 * entries flip to deeper companions for contrast on pale glass. All values
 * are oklch() (wide-gamut, perceptually even); the native accent-color
 * property and checkbox rules consume them directly, and the pre-paint
 * script derives the dark/light pair automatically from each entry's
 * colors + the active brightness class.
 */
export const ACCENT_PALETTE = [
  { value: 'default', label: 'Default Blue', hint: 'The original look', dark: 'oklch(62% 0.20 255)', light: 'oklch(55% 0.20 255)' },
  { value: 'indigo', label: 'Indigo', hint: 'Deeper, calmer blue', dark: 'oklch(60% 0.21 280)', light: 'oklch(52% 0.21 280)' },
  { value: 'violet', label: 'Violet', hint: 'Creative purple', dark: 'oklch(62% 0.22 300)', light: 'oklch(54% 0.22 300)' },
  { value: 'emerald', label: 'Emerald', hint: 'Fresh green', dark: 'oklch(70% 0.17 165)', light: 'oklch(60% 0.17 165)' },
  { value: 'amber', label: 'Amber', hint: 'Warm golden glow', dark: 'oklch(78% 0.16 75)', light: 'oklch(68% 0.16 75)' },
  { value: 'rose', label: 'Rose', hint: 'Confident red-pink', dark: 'oklch(66% 0.20 15)', light: 'oklch(58% 0.20 15)' },
];

/** Accent value → oklch for the ACTIVE brightness class. Unknown → default. */
export function getAccentColor(value, mode = 'dark') {
  const entry = ACCENT_PALETTE.find((a) => a.value === value) || ACCENT_PALETTE[0];
  return mode === 'light' ? entry.light : entry.dark;
}

/**
 * P4 — Surface decor axis (the trend layer). Orthogonal to hue: each value
 * is ONE body::before texture layer painted behind all content, keyed by
 * <html data-decor>. Because it never touches the color tokens, any decor
 * combines with any preset + accent — the style matrix grows by these four
 * entries, not by (presets × accents × decor). Animation is gated in CSS on
 * [data-motion] / [data-performance]: drift runs only when motion is full
 * and performance mode is off (and the OS doesn't request reduced motion);
 * the layer itself stays as a static texture otherwise. `swatch` feeds the
 * Appearance gallery chip.
 */
export const DECOR_LEVELS = [
  { value: 'none', label: 'None', hint: 'The plain gradient', swatch: 'linear-gradient(135deg, #3b28cc, #a855f7, #f43f5e)' },
  { value: 'grain', label: 'Film Grain', hint: 'Subtle noise over the glass', swatch: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'80\' height=\'80\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'80\' height=\'80\' filter=\'url(%23n)\' opacity=\'0.4\'/%3E%3C/svg%3E"), linear-gradient(135deg, #1e293b, #334155)' },
  { value: 'aurora', label: 'Aurora', hint: 'Slow drifting mesh glow', swatch: 'linear-gradient(135deg, #38bdf8, #a855f7, #ec4899)' },
  { value: 'glow', label: 'Chromatic Glow', hint: 'Accent-tinted bloom', swatch: 'radial-gradient(circle at 50% 25%, #5b6cf5, #0b1020 72%)' },
];

/**
 * Glass intensity tiers map onto the existing --glass-blur / --glass-bg
 * tokens (evidence #8: the knobs already exist in index.css).
 */
export const GLASS_LEVELS = [
  { value: 'crystal', label: 'Crystal', hint: 'Max blur, heavy saturation' },
  { value: 'balanced', label: 'Balanced', hint: 'The current default' },
  { value: 'frosted', label: 'Frosted', hint: 'Light blur — easier on GPUs' },
];

/** P2 — Layout & Density (PLAN.MD §13). */
export const DENSITY_LEVELS = [
  { value: 'compact', label: 'Compact', hint: 'Tighter spacing, more on screen' },
  { value: 'comfortable', label: 'Comfortable', hint: 'The current default' },
  { value: 'spacious', label: 'Spacious', hint: 'Extra breathing room' },
];

/** P2 — Motion & Effects (PLAN.MD §13). "off" generalizes the existing
 *  prefers-reduced-motion CSS block; "full" is today's behavior. */
export const MOTION_LEVELS = [
  { value: 'full', label: 'Full', hint: 'All transitions and effects' },
  { value: 'reduced', label: 'Reduced', hint: 'Fades only, no movement' },
  { value: 'off', label: 'Off', hint: 'Instant — best for battery' },
];

/** P2 — Tables & Data. */
export const PAGE_SIZES = [10, 25, 50, 100];
export const DATE_FORMATS = [
  { value: 'mdy', label: 'MM/DD/YYYY', hint: 'US' },
  { value: 'dmy', label: 'DD/MM/YYYY', hint: 'EU / AU' },
  { value: 'ymd', label: 'YYYY-MM-DD', hint: 'ISO 8601' },
];

const REGISTRY = [
  {
    key: 'theme',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.ENUM,
    default: 'dark',
    values: THEME_PRESETS.map((t) => t.value),
    attr: 'data-theme',
    section: 'appearance',
    description: 'Theme preset (token set) applied to <html data-theme>.',
  },
  {
    key: 'accent',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.ENUM,
    default: 'default',
    values: ACCENT_PALETTE.map((a) => a.value),
    attr: 'data-accent',
    section: 'appearance',
    description: 'Accent color for native controls and --accent (oklch pair per brightness).',
  },
  {
    key: 'glass',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.ENUM,
    default: 'balanced',
    values: GLASS_LEVELS.map((g) => g.value),
    attr: 'data-glass',
    section: 'appearance',
    description: 'Glass intensity tier — drives --glass-blur/--glass-bg tiers in index.css.',
  },
  {
    key: 'decor',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.ENUM,
    default: 'none',
    values: DECOR_LEVELS.map((d) => d.value),
    attr: 'data-decor',
    section: 'appearance',
    description: 'Surface decor layer (body::before behind content) — none/grain/aurora/glow; drift animation gated on motion + performance.',
  },
  {
    key: 'toastBannersEnabled',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.BOOL,
    default: true,
    section: 'notifications',
    // No attr: consumed directly by NotificationToasts (pre-existing
    // per-user pref; moved into the registry so its persistence rides the
    // same ui_prefs blob and schema from now on).
    description: 'Slide-in banner when a new notification arrives (per user).',
  },
  // ── P2 — Layout & Density ────────────────────────────────────────────
  {
    key: 'density',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.ENUM,
    default: 'comfortable',
    values: DENSITY_LEVELS.map((d) => d.value),
    attr: 'data-density',
    section: 'layout',
    description: 'Root spacing scale — drives data-density CSS rules in index.css.',
  },
  {
    key: 'fontScale',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.INT,
    default: 100,
    min: 85,
    max: 125,
    step: 5,
    section: 'layout',
    description: 'Base font size as a percentage applied via --font-scale (rem cascade).',
  },
  // ── P2 — Motion & Effects ────────────────────────────────────────────
  {
    key: 'motion',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.ENUM,
    default: 'full',
    values: MOTION_LEVELS.map((m) => m.value),
    attr: 'data-motion',
    section: 'motion',
    description: 'Animation level — data-motion CSS + MotionConfig reducedMotion.',
  },
  {
    key: 'performanceMode',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.BOOL,
    default: false,
    attr: 'data-performance',
    section: 'motion',
    description: 'Drop backdrop-filter + heavy shadows (weak-GPU hosts, battery).',
  },
  // ── P3 — Notifications relocation ───────────────────────────────────
  // toastBannersEnabled keeps its per-user route; the section now exists
  // as registry metadata (below) so the panel groups it explicitly.
  // ── P3 — Accessibility ──────────────────────────────────────────────
  {
    key: 'reducedTransparency',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.BOOL,
    default: false,
    attr: 'data-reduced-transparency',
    section: 'accessibility',
    description: 'Drop translucent fills and heavy blur — maps onto the glass tokens (reduced transparency).',
  },
  {
    key: 'alwaysFocusRings',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.BOOL,
    default: false,
    attr: 'data-focus-rings',
    section: 'accessibility',
    description: 'Always-visible focus rings on every focusable element (keyboard navigation).',
  },
  {
    key: 'largerTouchTargets',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.BOOL,
    default: false,
    attr: 'data-touch-targets',
    section: 'accessibility',
    description: 'Larger minimum hit areas for buttons, checkboxes and icon actions.',
  },
  // ── P2 — Tables & Data ──────────────────────────────────���─────────────
  {
    key: 'pageSize',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.INT,
    default: 50,
    min: 10,
    max: 100,
    section: 'tables',
    description: 'Default rows per page for paginated tables (Activity Log).',
  },
  {
    key: 'dateFormat',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.ENUM,
    default: 'mdy',
    values: DATE_FORMATS.map((d) => d.value),
    section: 'tables',
    description: 'Preferred date rendering for formatters using formatDatePref.',
  },
  {
    key: 'timeFormat',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.ENUM,
    default: '12h',
    values: ['12h', '24h'],
    section: 'tables',
    description: '12/24-hour clock for formatters using formatTimePref.',
  },
  {
    key: 'hideColumnTotals',
    scope: PREF_SCOPES.USER,
    type: PREF_TYPES.BOOL,
    default: false,
    section: 'tables',
    description: 'Hide the search-result count line on DataTable toolbars.',
  },
];

export default REGISTRY;

// ── Derived helpers (all registry consumers go through these) ──────────

export const USER_PREF_KEYS = REGISTRY.filter((p) => p.scope === PREF_SCOPES.USER).map((p) => p.key);

export const PREF_BY_KEY = Object.fromEntries(REGISTRY.map((p) => [p.key, p]));

export const DEFAULT_USER_PREFS = Object.fromEntries(
  REGISTRY.filter((p) => p.scope === PREF_SCOPES.USER).map((p) => [p.key, p.default]),
);

export const PREF_SECTIONS = [...new Set(REGISTRY.map((p) => p.section))];

/**
 * Section metadata (P3 — PLAN.MD §13 "The panel — sections"). The renderer
 * is dumb: labels, order and ROLE GATING all come from here. `roles` lists
 * the roles that may SEE the section; user-scope sections default to every
 * role. GATING FAILS CLOSED: a section without an entry (or with an empty
 * roles list) renders for nobody. Root-only sections (branding) carry
 * roles: ['IT Admin'] — that role is the admin/root role in this app (see
 * App.jsx role model) — AND are additionally gated on user.isRoot at the
 * render site, matching the server's requireRoot on /api/settings/branding.
 */
export const PREF_SECTIONS_META = [
  { id: 'appearance', label: 'Appearance', roles: ['IT Admin', 'Read-Only', 'Staff', 'Department Manager'] },
  { id: 'layout', label: 'Layout & Density', roles: ['IT Admin', 'Read-Only', 'Staff', 'Department Manager'] },
  { id: 'motion', label: 'Motion & Effects', roles: ['IT Admin', 'Read-Only', 'Staff', 'Department Manager'] },
  { id: 'tables', label: 'Tables & Data', roles: ['IT Admin', 'Read-Only', 'Staff', 'Department Manager'] },
  { id: 'notifications', label: 'Notifications', roles: ['IT Admin', 'Read-Only', 'Staff', 'Department Manager'] },
  { id: 'accessibility', label: 'Accessibility', roles: ['IT Admin', 'Read-Only', 'Staff', 'Department Manager'] },
  { id: 'branding', label: 'Branding & Defaults', roles: ['IT Admin'] },
];

/** Which section ids may this role see? Fails closed: unknown role ⇒ []. */
export function sectionsVisibleToRole(role) {
  return PREF_SECTIONS_META.filter((s) => s.roles.includes(role)).map((s) => s.id);
}

/** May this role see a given section? (Fail-closed wrapper.) */
export function canSeeSection(role, sectionId) {
  const meta = PREF_SECTIONS_META.find((s) => s.id === sectionId);
  return !!meta && meta.roles.includes(role);
}

/** Coerce + validate one value against its registry entry. Returns { ok, value, error }. */
export function coercePref(key, value) {
  const pref = PREF_BY_KEY[key];
  if (!pref) return { ok: false, error: `Unknown preference: ${key}` };
  if (pref.type === PREF_TYPES.BOOL) {
    if (typeof value !== 'boolean') return { ok: false, error: `${key} must be a boolean` };
    return { ok: true, value };
  }
  if (pref.type === PREF_TYPES.INT) {
    const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return { ok: false, error: `${key} must be an integer` };
    if (pref.min !== undefined && n < pref.min) return { ok: false, error: `${key} must be ≥ ${pref.min}` };
    if (pref.max !== undefined && n > pref.max) return { ok: false, error: `${key} must be ≤ ${pref.max}` };
    return { ok: true, value: n };
  }
  // ENUM
  if (!pref.values.includes(value)) {
    return { ok: false, error: `${key} must be one of: ${pref.values.join(', ')}` };
  }
  return { ok: true, value };
}

/** Validate a whole prefs object; returns { ok, value, errors } with defaults filled in. */
export function sanitizePrefs(raw) {
  const errors = [];
  const value = { ...DEFAULT_USER_PREFS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, val] of Object.entries(raw)) {
      const res = coercePref(key, val);
      if (res.ok) value[key] = res.value;
      else errors.push(res.error);
    }
  } else if (raw !== undefined && raw !== null) {
    errors.push('ui_prefs must be an object');
  }
  return { ok: errors.length === 0, value, errors };
}
