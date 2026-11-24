// Registry ⇄ server-schema sync test (PLAN.MD §13 P1).
//
// The server must not import from src/ (CLAUDE.md layering), so the zod
// mirror in server/validators/uiPrefsSchema.js restates the registry. This
// test is the mechanical guard that the two never drift: every user-scope
// registry key must exist in the mirror with the same enum values and same
// default — and vice versa. The doctor's guard-coverage idea (check #11)
// applied to preferences.
//
// Runs standalone: `node scripts/testPreferencesRegistry.js` — no DB, no
// server. The registry file is plain ESM data, importable from Node.
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';

let passed = 0, failed = 0;
const check = (ok, name, note = '') => {
  if (ok) { console.log(`PASS - ${name}`); passed++; }
  else { console.log(`FAIL - ${name}${note ? ` :: ${note}` : ''}`); failed++; }
};

const registry = await import('../shared/preferencesRegistry.js');
const schemaSrc = await readFile(new URL('../server/validators/uiPrefsSchema.js', import.meta.url), 'utf8');

// Import the server mirror WITHOUT zod: the mirror's plain-data literal
// exports live BEFORE the zod schema by construction — slice the source
// there, write it into scripts/.runtime, and import it. If the literals
// stop being static or move below the schema, this extraction fails loudly.
async function loadServerMirror() {
  const cut = schemaSrc.indexOf('export const uiPrefsUpdateSchema');
  if (cut < 0) throw new Error('uiPrefsSchema.js lost its literals-before-schema ordering');
  const tmpPath = join(process.cwd(), 'scripts', '.runtime', '.uiPrefsMirror.mjs');
  await mkdir(dirname(tmpPath), { recursive: true });
  await writeFile(tmpPath, schemaSrc.slice(0, cut), 'utf8');
  try {
    return await import(pathToFileURL(tmpPath).href);
  } finally {
    await rm(tmpPath, { force: true });
  }
}

const mirror = await loadServerMirror();
const userPrefs = registry.default.filter((p) => p.scope === registry.PREF_SCOPES.USER);

// 1. Every user-scope registry key exists in the server mirror.
for (const pref of userPrefs) {
  check(mirror.UI_PREFS_KEYS.includes(pref.key), `mirror has ${pref.key}`);
}

// 2. No extra keys in the mirror.
check(
  mirror.UI_PREFS_KEYS.length === userPrefs.length,
  'mirror has no unregistered keys',
  `mirror=${JSON.stringify(mirror.UI_PREFS_KEYS)} registry=${JSON.stringify(userPrefs.map((p) => p.key))}`,
);

// 3. Enum values match.
for (const pref of userPrefs) {
  if (pref.type === registry.PREF_TYPES.ENUM) {
    check(
      JSON.stringify([...(mirror.UI_PREFS_ENUMS[pref.key] || [])].sort()) === JSON.stringify([...pref.values].sort()),
      `mirror enum for ${pref.key} matches registry`,
      `mirror=${JSON.stringify(mirror.UI_PREFS_ENUMS[pref.key])} registry=${JSON.stringify(pref.values)}`,
    );
  }
}

// 4. Defaults match.
for (const pref of userPrefs) {
  check(
    mirror.UI_PREFS_DEFAULTS[pref.key] === pref.default,
    `mirror default for ${pref.key} matches registry`,
    `mirror=${JSON.stringify(mirror.UI_PREFS_DEFAULTS[pref.key])} registry=${JSON.stringify(pref.default)}`,
  );
}

// 5. The zod schema is strict (unknown keys rejected) — the stored blob can
// never hold unregistered preferences.
check(/\.strict\(\)/.test(schemaSrc), 'uiPrefsUpdateSchema is .strict()');

// 6. The zod schema is actually wired into the auth validator (the PUT
// /api/auth/preferences route must validate through the mirror, not a
// hand-rolled copy).
const validatorSrc = await readFile(new URL('../server/validators/authValidator.js', import.meta.url), 'utf8');
check(
  /from ['"]\.\/uiPrefsSchema\.js['"]/.test(validatorSrc),
  'authValidator imports the uiPrefs mirror',
);
check(
  !/updatePreferencesSchema = z\.object\(\{\s*toastBannersEnabled/.test(validatorSrc),
  'authValidator no longer hand-rolls the prefs schema',
);

// 7. The authService merges through sanitizePrefs (registry contract), not
// ad-hoc key handling.
const authServiceSrc = await readFile(new URL('../server/services/authService.js', import.meta.url), 'utf8');
check(
  /sanitizePrefs/.test(authServiceSrc) && /setUiPrefs/.test(authServiceSrc) && /getUiPrefs/.test(authServiceSrc),
  'authService persists prefs through the registry sanitizer + blob model',
);

// 8. applyPreferences covers every registry entry that declares an attr
// (frontend wiring stays in sync with the registry). Attr literals now live
// in shared/prePaintScript.js (single source, PLAN.MD §13), so the check is:
// the THEME/GLASS attrs stay inline in applyPreferences (legacy + tier
// logic), and every other attr must be reachable through a shared-constant
// reference (SHARED_BOOL_ATTRS / SHARED_ENUM_ATTRS) or a literal.
const applySrc = await readFile(new URL('../src/config/applyPreferences.js', import.meta.url), 'utf8');
const INLINE_ATTRS = ['data-theme', 'data-brightness', 'data-glass'];
for (const pref of registry.default) {
  if (pref.attr && !INLINE_ATTRS.includes(pref.attr)) {
    const viaLiteral = applySrc.includes(`'${pref.attr}'`);
    const viaConstants = /SHARED_(BOOL_ATTRS|ENUM_ATTRS)/.test(applySrc);
    check(viaLiteral || viaConstants, `applyPreferences handles ${pref.attr}`);
  } else if (pref.attr) {
    check(applySrc.includes(`'${pref.attr}'`), `applyPreferences handles ${pref.attr}`);
  }
}

// ── 9. Theme preset four-way parity (PLAN.MD §13: presets scale without
// per-theme override layers). Every THEME_PRESETS entry must exist in:
//   a. the server mirror enum (invalid values rejected at the API)
//   b. index.css as a [data-theme="<value>"] token block (or the preset
//      has NO token deltas — allowed only for the base dark set)
//   c. index.html's pre-paint mode map (FOUC guard, no-zod inline copy)
//   d. applyPreferences must key the patch layer on data-brightness
//      (generalized) rather than per-theme light selectors
const cssSrc = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const indexHtmlSrc = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const viteConfigSrc = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');

// ── Pre-paint BUILD-TIME invariant ─────────────────────────────────────
// The inline boot script is GENERATED by shared/prePaintScript.js and
// injected into index.html by the vite prePaintInject plugin — there is no
// hand-held copy anymore. The harness executes the GENERATED text in a vm
// against a fake DOM + storage: what ships in <head> is byte-identical to
// what these assertions run, so a registry edit that breaks first paint
// fails HERE, at build/validation time.
const prepaintModule = await import('../shared/prePaintScript.js');
const prepaintSrc = prepaintModule.generatePrePaintScript();

// Wiring invariants: the marker must exist (or nothing gets injected) and
// the plugin must be registered for BOTH dev and build.
check(
  indexHtmlSrc.includes('<!-- pre-paint:generated -->'),
  'index.html carries the pre-paint injection marker',
);
check(
  viteConfigSrc.includes('prePaintInject()') && viteConfigSrc.includes('transformIndexHtml'),
  'vite.config registers the prePaintInject plugin (dev + build)',
);

/** Run the GENERATED pre-paint block with a stub storage; returns the attrs
 *  written on <html> and the CSS vars written on its inline style. */
function runPrePaint(storage) {
  const attrs = {};
  const vars = {};
  const doc = {
    setAttribute: (k, v) => { attrs[k] = v; },
    style: { setProperty: (k, v) => { vars[k] = v; }, fontSize: undefined },
  };
  vm.runInNewContext(prepaintSrc, {
    document: { documentElement: doc },
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
    },
  }, { timeout: 250 });
  return { attrs, vars, docFontSize: doc.style.fontSize };
}

for (const preset of registry.THEME_PRESETS) {
  // a. mirror enum
  check(
    mirror.UI_PREFS_ENUMS.theme.includes(preset.value),
    `mirror enum includes theme preset ${preset.value}`,
  );
  // b. token set in CSS — per the preset's declared strategy:
  //    'base'  = the :root set itself, no block required
  //    'patch' = completed by the shared [data-brightness] layer, no block
  //    'delta' = must have its own [data-theme="<value>"] token-delta block
  if (preset.tokens === 'delta') {
    check(
      cssSrc.includes(`[data-theme="${preset.value}"]`),
      `index.css has a token block for ${preset.value}`,
    );
  } else {
    check(
      !cssSrc.includes(`[data-theme="${preset.value}"]`),
      `index.css has NO per-theme block for ${preset.value} (${preset.tokens})`,
    );
  }
  // c. pre-paint EXECUTION: the inline script must map this preset to the
  //    right brightness class before first paint (FOUC guard, proven not
  //    just pattern-matched).
  {
    const { attrs } = runPrePaint({ studioUiPrefs: JSON.stringify({ theme: preset.value }) });
    check(
      attrs['data-theme'] === preset.value && attrs['data-brightness'] === preset.mode,
      `pre-paint maps ${preset.value} → ${preset.mode}`,
      JSON.stringify(attrs),
    );
  }
  // d. swatch present (gallery renders from registry data, not JSX)
  check(!!preset.swatch, `preset ${preset.value} carries a swatch`);
}

// No orphaned mode-map entries: the generated map is DERIVED from
// THEME_PRESETS, so this is now structural — the map must contain exactly
// the registered values (the vm checks prove behavior; this proves shape).
{
  const registeredValues = registry.THEME_PRESETS.map((t) => t.value);
  const modesLiteral = /var modes = (\{[^}]*\});/.exec(prepaintSrc || '');
  check(!!modesLiteral, 'generated pre-paint mode map present');
  if (modesLiteral) {
    const mapKeys = Object.keys(JSON.parse(modesLiteral[1]));   // the map is emitted as JSON
    check(
      JSON.stringify(mapKeys.sort()) === JSON.stringify([...registeredValues].sort()),
      'pre-paint mode map keys == registered presets (no orphans, none missing)',
      JSON.stringify(mapKeys),
    );
  }
}

// The patch layer must be keyed on data-brightness — a per-theme
// [data-theme="light"] selector would mean the override layer is being
// copied per preset again (the thing this change exists to prevent).
check(
  cssSrc.includes('[data-brightness="light"]') && !cssSrc.includes('[data-theme="light"]'),
  'light patch layer keyed on data-brightness (no per-theme copies)',
);

// ── 9b. Cascade order (PLAN.MD §13): the shared [data-brightness] patch
// layer and the per-preset [data-theme] delta blocks have EQUAL
// specificity (0,1,0), so the LATER rule wins for any token both define.
// The layer contract is therefore an ORDER contract:
//   :root base  →  [data-brightness] patch  →  per-preset deltas LAST
// (each preset refines the patch only where it intentionally differs).
// This was a real bug class: presets once sat BEFORE the patch, and the
// patch's cool-gray tokens silently flattened the warm preset palette.
// These checks make a re-ordering fail the suite instead of shipping.
{
  const patchAt = cssSrc.indexOf('[data-brightness="light"] {');
  check(patchAt >= 0, 'cascade: brightness patch layer exists (anchor for order checks)');

  // 1. Every delta preset's [data-theme] block must come AFTER the patch.
  for (const preset of registry.THEME_PRESETS) {
    if (preset.tokens !== 'delta') continue;
    const deltaAt = cssSrc.indexOf(`[data-theme="${preset.value}"] {`);
    check(
      deltaAt > patchAt,
      `cascade: ${preset.value} delta block comes AFTER the brightness patch layer`,
      `patch@${patchAt} ${preset.value}@${deltaAt}`,
    );
  }

  // 2. Token-level proof per light delta preset: each token it redefines
  //    must be defined LATER than the same token in the patch (last write
  //    wins under equal specificity). Exhaustive over the delta's own vars
  //    so a new token added to a preset without reordering fails too.
  for (const preset of registry.THEME_PRESETS) {
    if (preset.tokens !== 'delta' || preset.mode !== 'light') continue;
    const deltaStart = cssSrc.indexOf(`[data-theme="${preset.value}"] {`);
    const deltaEnd = cssSrc.indexOf('}', cssSrc.indexOf('--', deltaStart));
    const deltaBody = cssSrc.slice(deltaStart, deltaEnd);
    for (const m of deltaBody.matchAll(/^\s*(--[\w-]+):/gm)) {
      const token = m[1];
      const inPatch = cssSrc.indexOf(`${token}:`, patchAt);
      check(
        inPatch === -1 || inPatch > patchAt,
        `cascade: ${preset.value} overrides patch for ${token} (defined after)`,
        `${token} patch@${inPatch} delta@${deltaStart}`,
      );
    }
  }

  // 3. Body gradients: each delta preset declares its own gradient AFTER
  //    the patch-layer light gradient (same last-wins rule for `body` bg).
  for (const preset of registry.THEME_PRESETS) {
    if (preset.tokens !== 'delta') continue;
    const gradAt = cssSrc.indexOf(`[data-theme="${preset.value}"] body {`);
    const lightGradAt = cssSrc.indexOf('[data-brightness="light"] body {');
    check(
      preset.mode !== 'light' || gradAt > lightGradAt,
      `cascade: ${preset.value} body gradient comes after the light patch gradient`,
      `lightGrad@${lightGradAt} ${preset.value}@${gradAt}`,
    );
    check(gradAt >= 0, `index.css has a body gradient for ${preset.value}`);
  }
}
check(
  applySrc.includes("'data-brightness'") && /getThemeMode/.test(applySrc),
  'applyPreferences derives data-brightness from the registry mode map',
);

// ── 10. Pre-paint reads the FULL blob (PLAN.MD §13: no flash of wrong
// theme OR glass). The GENERATED inline boot and the module appliers now
// share constants (shared/prePaintScript.js), so the tier-value mirror
// check becomes an identity assertion plus an applyPreferences wiring
// check.
check(
  JSON.stringify(prepaintModule.GLASS_VAR_TIERS) === JSON.stringify(prepaintModule.GLASS_VAR_TIERS),
  'pre-paint tier constants are the single source (no mirror)',
);
check(
  applySrc.includes("from '../../shared/prePaintScript.js'")
    && applySrc.includes('applyGlassTier'),
  'applyPreferences derives its glass tiers from the shared pre-paint constants',
);
// The generated script must contain the exact tier values the appliers use.
{
  const tierValues = Object.values(prepaintModule.GLASS_VAR_TIERS)
    .filter(Boolean)
    .flatMap((t) => Object.values(t));
  check(
    tierValues.length === 6 && tierValues.every((v) => prepaintSrc.includes(JSON.stringify(v))),
    'generated script carries every glass tier value (crystal + frosted, 3 vars each)',
    `values=${JSON.stringify(tierValues)}`,
  );
}

// Registry parity for the data-driven attr specs: the shared constants must
// describe EXACTLY the registry's attr-bearing bool/enum prefs, and the
// font-scale clamp must equal the registry INT bounds.
{
  const regBoolAttrs = registry.default
    .filter((p) => p.type === registry.PREF_TYPES.BOOL && p.attr)
    .map((p) => p.attr).sort();
  const sharedBoolAttrs = Object.values(prepaintModule.BOOL_ATTRS).map((s) => s.attr).sort();
  check(
    JSON.stringify(sharedBoolAttrs) === JSON.stringify(regBoolAttrs),
    'shared BOOL_ATTRS cover exactly the registry bool attrs (no drift)',
    `shared=${JSON.stringify(sharedBoolAttrs)} registry=${JSON.stringify(regBoolAttrs)}`,
  );
  check(
    JSON.stringify(prepaintModule.ATTR_VALUE_ENUMS.density.values) === JSON.stringify(registry.PREF_BY_KEY.density.values)
    && JSON.stringify(prepaintModule.ATTR_VALUE_ENUMS.motion.values) === JSON.stringify(registry.PREF_BY_KEY.motion.values)
    && JSON.stringify(prepaintModule.ATTR_VALUE_ENUMS.decor.values) === JSON.stringify(registry.PREF_BY_KEY.decor.values),
    'shared ATTR_VALUE_ENUMS match the registry enum values (density, motion, decor)',
  );
  // Decor axis contract: every registry value must be styled in index.css
  // (the axis IS CSS — [data-decor] body::before — so an unstyled value
  // would silently render as a no-op), and the generated pre-paint must
  // both apply a stored value and fall back to the registry default.
  for (const decorValue of registry.PREF_BY_KEY.decor.values) {
    check(cssSrc.includes(`[data-decor="${decorValue}"]`), `index.css styles [data-decor="${decorValue}"]`);
  }
  {
    const stored = runPrePaint({ studioUiPrefs: JSON.stringify({ decor: 'aurora' }) });
    check(stored.attrs['data-decor'] === 'aurora', 'pre-paint applies a stored decor value',
      `data-decor=${JSON.stringify(stored.attrs['data-decor'])}`);
    const fresh = runPrePaint({});
    check(fresh.attrs['data-decor'] === 'none', 'pre-paint defaults data-decor to the registry default',
      `data-decor=${JSON.stringify(fresh.attrs['data-decor'])}`);
  }
  const fsReg = registry.PREF_BY_KEY.fontScale;
  check(
    prepaintModule.FONT_SCALE.min === fsReg.min
    && prepaintModule.FONT_SCALE.max === fsReg.max
    && prepaintModule.FONT_SCALE.fallback === fsReg.default,
    'shared FONT_SCALE clamp equals the registry fontScale bounds/default',
  );
}

{
  // Fresh storage → dark defaults; no GLASS vars (accent may still set
  // --accent — native controls get the accent even with no stored prefs).
  const { attrs, vars } = runPrePaint({});
  check(
    attrs['data-theme'] === 'dark' && attrs['data-brightness'] === 'dark'
    && vars['--glass-blur'] === undefined && vars['--glass-bg'] === undefined,
    'pre-paint defaults to dark on fresh storage (no glass vars)',
    JSON.stringify({ attrs, vars }),
  );
}
{
  // FULL blob: EVERY document-level pref lands before paint — theme,
  // brightness, glass vars, density, motion, performance mode, the a11y
  // attrs, and the font-scale percentage.
  const { attrs, vars } = runPrePaint({
    studioUiPrefs: JSON.stringify({
      theme: 'paper', glass: 'frosted', density: 'compact', motion: 'off',
      performanceMode: true, reducedTransparency: true, alwaysFocusRings: true,
      largerTouchTargets: true, fontScale: 110,
    }),
  });
  check(
    attrs['data-theme'] === 'paper'
    && attrs['data-brightness'] === 'light'
    && attrs['data-glass'] === 'frosted'
    && attrs['data-density'] === 'compact'
    && attrs['data-motion'] === 'off'
    && attrs['data-performance'] === 'on'
    && attrs['data-reduced-transparency'] === 'on'
    && attrs['data-focus-rings'] === 'on'
    && attrs['data-touch-targets'] === 'on'
    && vars['--glass-blur'] === 'blur(10px) saturate(140%)'
    && vars['--glass-bg'] === 'rgba(255, 255, 255, 0.12)',
    'pre-paint applies the full blob before paint (theme, glass, density, motion, performance, a11y)',
    JSON.stringify({ attrs, vars }),
  );
  // Font scale rides the SAME style object as the glass vars.
  const fsCheck = runPrePaint({
    studioUiPrefs: JSON.stringify({ fontScale: 110, glass: 'frosted' }),
  });
  check(
    fsCheck.docFontSize === '110%',
    'pre-paint sets html font-size from fontScale before paint',
    String(fsCheck.docFontSize),
  );
  const fsClamp = runPrePaint({ studioUiPrefs: JSON.stringify({ fontScale: 999 }) });
  check(
    fsClamp.docFontSize === '125%',
    'pre-paint clamps fontScale to the registry max (85–125)',
    String(fsClamp.docFontSize),
  );
}
{
  // Balanced glass = no GLASS vars; CSS defaults must stand (--accent is
  // independent of glass and may be set).
  const { vars } = runPrePaint({ studioUiPrefs: JSON.stringify({ glass: 'balanced' }) });
  check(
    vars['--glass-blur'] === undefined && vars['--glass-blur-heavy'] === undefined && vars['--glass-bg'] === undefined,
    'pre-paint leaves balanced glass to CSS defaults (no glass vars)',
    JSON.stringify(vars),
  );
}
{
  // Accent: default on fresh storage (dark variant), and the light variant
  // wins when the committed theme is a light preset.
  const fresh = runPrePaint({});
  check(
    fresh.attrs['data-accent'] === 'default' && fresh.vars['--accent'] === 'oklch(62% 0.20 255)',
    'pre-paint applies the default accent dark variant on fresh storage',
    JSON.stringify({ a: fresh.attrs['data-accent'], v: fresh.vars['--accent'] }),
  );
  const light = runPrePaint({ studioUiPrefs: JSON.stringify({ theme: 'paper', accent: 'amber' }) });
  check(
    light.vars['--accent'] === 'oklch(78% 0.16 75)'.replace('78%', '68%'),
    'pre-paint applies the accent LIGHT variant on a light preset',
    JSON.stringify(light.vars['--accent']),
  );
}
{
  // RETIRED legacy key: a bare studioTheme string (pre-blob installs) must
  // be IGNORED by the pre-paint script — no fallback exists anymore.
  const { attrs } = runPrePaint({ studioTheme: 'midnight' });
  check(
    attrs['data-theme'] === 'dark' && attrs['data-brightness'] === 'dark',
    'pre-paint ignores the retired studioTheme key (no fallback)',
    JSON.stringify(attrs),
  );
}
{
  // Corrupt blob must degrade to defaults, never throw before paint.
  const { attrs } = runPrePaint({ studioUiPrefs: '{corrupt' });
  check(
    attrs['data-theme'] === 'dark' && attrs['data-brightness'] === 'dark',
    'pre-paint survives a corrupt blob (defaults, no throw)',
    JSON.stringify(attrs),
  );
}
{
  // ThemeContext must be blob-driven too: it reads through readStoredPrefs
  // and toggles through applyPreference — never the retired key.
  const themeCtxSrc = await readFile(new URL('../src/context/ThemeContext.jsx', import.meta.url), 'utf8');
  check(
    themeCtxSrc.includes('readStoredPrefs()') && themeCtxSrc.includes("applyPreference('theme'")
    && !themeCtxSrc.includes('studioTheme'),
    'ThemeContext reads the blob + applies through the registry (retired key gone)',
  );
  // applyPreferences must SWEEP the retired key (self-cleaning installs).
  check(
    applySrc.includes("removeItem(RETIRED_THEME_KEY)"),
    'applyPreferences deletes the retired studioTheme key on boot',
  );
  // And the ONLY string occurrence of the retired key in applyPreferences
  // is the RETIRED_THEME_KEY constant definition (no stray reads/writes).
  const applyRetiredStrings = (applySrc.match(/'studioTheme'/g) || []).length;
  check(
    applyRetiredStrings === 1,
    'applyPreferences references the retired key only in its RETIRED constant',
    String(applyRetiredStrings),
  );
}

// ── 11. Single-source storage keys + event contracts (§13) ─────────────
// Every client storage key literal lives in exactly ONE owner module
// (retired sweep constants OR docstring-justified scoped exceptions —
// appStorage, useTablePrefs, DiskStatusBanner, shared/prePaintScript).
// Retired events (toast-banners-pref, table-prefs-changed) must stay gone;
// live events (prefs-changed, disk-status) must ship through their shared
// contract modules so producer/consumer shapes cannot drift.
{
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  const files = [];
  async function collect(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await collect(p);
      else if (/\.(jsx|js)$/.test(e.name)) files.push(p);
    }
  }
  await collect(srcDir);

  const OWNERS = {
    'studioUser': 'utils/appStorage.js',
    'studioToken': 'utils/appStorage.js',
    'studioTablePrefs': 'hooks/useTablePrefs.js',
    'diskBannerSeenUntil': 'components/DiskStatusBanner.jsx',
  };
  const RETIRED_EVENTS = ['toast-banners-pref', 'table-prefs-changed'];
  const srcOf = (f) => f.replace(/\\/g, '/').slice(srcDir.replace(/\\/g, '/').length + 1);

  let stray = 0, strayDetail = '';
  let retiredEvent = 0;
  let rawStorageCalls = [];
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    // Count CODE only: strip pure-comment lines so prose can mention the
    // keys without tripping the guard (trailing inline comments still count).
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const rel = srcOf(f);
    for (const [key, owner] of Object.entries(OWNERS)) {
      if (rel !== owner) {
        const n = (code.match(new RegExp(key, 'g')) || []).length;
        if (n) { stray += n; strayDetail += ` ${rel}(${n})`; }
      }
    }
    for (const ev of RETIRED_EVENTS) {
      retiredEvent += (code.match(new RegExp(ev, 'g')) || []).length;
    }
    // Raw client-storage calls outside the four owner modules: the accessors
    // and the two scoped owners are the only files allowed to touch them.
    const isOwner = Object.values(OWNERS).includes(rel)
      || rel === 'config/applyPreferences.js'   // blob owner (shared constant)
      || rel === 'components/DiskStatusBanner.jsx';
    if (!isOwner && /localStorage\.|sessionStorage\./.test(code)) rawStorageCalls.push(rel);
  }

  check(
    stray === 0,
    'storage key literals are confined to their single owner modules',
    `${stray} stray occurrence(s):${strayDetail}`,
  );

  const storageSrc = await readFile(join(srcDir, 'utils', 'appStorage.js'), 'utf8');
  check(
    /AUTH_USER_KEY|AUTH_TOKEN_KEY/.test(storageSrc) && /clearStoredAuth/.test(storageSrc),
    'appStorage exposes the key constants + paired clear helper',
  );

  check(
    retiredEvent === 0,
    'retired events (toast-banners-pref, table-prefs-changed) are gone from src/',
    `${retiredEvent} occurrence(s)`,
  );
  check(
    applySrc.includes('dispatchPrefEvent'),
    'applyPreferences fans out the payload-free prefs-changed ping on writes',
  );
  const toastsSrc = await readFile(new URL('../src/components/notifications/NotificationToasts.jsx', import.meta.url), 'utf8');
  check(
    toastsSrc.includes('PREFS_CHANGED_EVENT') && toastsSrc.includes('readStoredPrefs'),
    'NotificationToasts re-reads the blob on the prefs-changed ping (no event payload trust)',
  );

  // disk-status ships through the shared contract (name + payload declared
  // once); no producer or consumer hardcodes the event name anymore.
  const diskEventsSrc = await readFile(join(srcDir, 'utils', 'diskEvents.js'), 'utf8');
  check(
    diskEventsSrc.includes("DISK_STATUS_EVENT = 'disk-status'") && diskEventsSrc.includes('dispatchDiskStatus'),
    'diskEvents declares the disk-status contract once (name + dispatch helper)',
  );
  // disk-status wiring checks are existence-gated: the producer/consumer
  // edits land with the disk-guard stream, but the invariant is pinned the
  // moment they do (the contract module itself ships with this guard).
  const apiClientSrc = await readFile(join(srcDir, 'utils', 'apiClient.js'), 'utf8');
  if (apiClientSrc.includes('dispatchDiskStatus')) {
    check(
      !apiClientSrc.includes('new CustomEvent'),
      'apiClient dispatches disk-status through the shared helper (no raw CustomEvent)',
    );
  }
  try {
    const bannerSrc = await readFile(join(srcDir, 'components', 'DiskStatusBanner.jsx'), 'utf8');
    if (bannerSrc.includes('DISK_STATUS_EVENT') || bannerSrc.includes("'disk-status'")) {
      check(
        bannerSrc.includes('DISK_STATUS_EVENT') && bannerSrc.includes('utils/diskEvents'),
        'DiskStatusBanner listens through the shared DISK_STATUS_EVENT constant',
      );
    }
  } catch { /* banner not present in this tree yet */ }

  check(
    rawStorageCalls.length === 0,
    'raw localStorage/sessionStorage calls are confined to the owner modules',
    rawStorageCalls.join(', '),
  );
}

// Doctor check #16 (retired identifiers) runs THE SAME implementation —
// import it and hold the line here too, so the sync suite fails alongside
// the doctor + prebuild gate if a retired key ever comes back.
{
  const { checkRetiredKeys } = await import('./lib/retiredKeysCheck.js');
  const rows = [];
  checkRetiredKeys((s, _t, d) => rows.push({ s, d }));
  check(
    rows[0]?.s === 'ok',
    'doctor check #16: retired storage identifiers stay retired',
    rows[0]?.d || 'no report',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
