// Doctor check #15 (PLAN.MD §13 P4): registry ⇄ server-schema sync for UI
// preferences. The server must not import from src/ (CLAUDE.md layering), so
// server/validators/uiPrefsSchema.js restates the registry; this check is the
// standing mechanical guard that the two never drift — keys, types, enums,
// int bounds and defaults, plus theme-preset four-way parity (registry ⇄
// mirror ⇄ index.css token strategy ⇄ index.html pre-paint map). Mirrors
// scripts/testPreferencesRegistry.js (which also runs the full check set in
// its own suite); the doctor check is the fast, always-on subset so a drift
// is caught at `npm run doctor` even if nobody runs the sync suite.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function checkPrefsSync(report) {
  try {
    // Import the registry without touching the DOM (plain ESM data + fns).
    // file:// import avoids the CWD sensitivity of a relative specifier.
    const registryPath = path.join(ROOT, 'shared', 'preferencesRegistry.js');
    const registryUrl = `file:///${registryPath.replace(/\\/g, '/')}`;

    // Extract the mirror's plain-data literals WITHOUT executing zod: the
    // mirror keeps them before the schema by construction.
    const schemaSrc = fs.readFileSync(path.join(ROOT, 'server', 'validators', 'uiPrefsSchema.js'), 'utf8');
    const cut = schemaSrc.indexOf('export const uiPrefsUpdateSchema');
    if (cut < 0) {
      return report('fail', 'UI prefs registry ⇄ schema sync',
        'uiPrefsSchema.js lost its literals-before-schema ordering — the sync harness cannot extract the plain-data mirror.');
    }

    // Evaluate the literals slice in isolation (no zod import): strip the
    // zod import line and rewrite `export const` → `const`, then run it in
    // a bare vm context and collect the exports.
    const slice = schemaSrc.slice(0, cut)
      .replace(/^import .*$/m, '')
      .replace(/^export const /gm, 'const ');
    const sandbox = {};
    vm.runInNewContext(`${slice}\n;this.__m = { UI_PREFS_KEYS, UI_PREFS_ENUMS, UI_PREFS_INTS, UI_PREFS_DEFAULTS };`, sandbox, { timeout: 250 });
    const mirror = sandbox.__m;

    // The registry itself CAN be imported for real.
    return import(registryUrl).then((registry) => {
      const userPrefs = registry.default.filter((p) => p.scope === registry.PREF_SCOPES.USER);

      // 1. Key-set parity, both directions.
      const regKeys = userPrefs.map((p) => p.key).sort();
      const mirrorKeys = [...mirror.UI_PREFS_KEYS].sort();
      if (JSON.stringify(regKeys) !== JSON.stringify(mirrorKeys)) {
        const onlyReg = regKeys.filter((k) => !mirrorKeys.includes(k));
        const onlyMirror = mirrorKeys.filter((k) => !regKeys.includes(k));
        return report('fail', 'UI prefs registry ⇄ schema sync',
          `key drift — registry only: ${JSON.stringify(onlyReg)}; mirror only: ${JSON.stringify(onlyMirror)}. `
          + 'Add the key to BOTH src/config/preferencesRegistry.js and server/validators/uiPrefsSchema.js (values, defaults, bounds).');
      }

      // 2. Types/enums/bounds/defaults per key.
      for (const pref of userPrefs) {
        if (pref.type === registry.PREF_TYPES.ENUM) {
          const m = mirror.UI_PREFS_ENUMS[pref.key];
          if (!m || JSON.stringify([...m].sort()) !== JSON.stringify([...pref.values].sort())) {
            return report('fail', 'UI prefs registry ⇄ schema sync',
              `enum drift for ${pref.key}: registry=${JSON.stringify(pref.values)} mirror=${JSON.stringify(m || null)}`);
          }
        }
        if (pref.type === registry.PREF_TYPES.INT) {
          const b = mirror.UI_PREFS_INTS[pref.key];
          if (!b || b.min !== pref.min || b.max !== pref.max) {
            return report('fail', 'UI prefs registry ⇄ schema sync',
              `int bounds drift for ${pref.key}: registry=${pref.min}–${pref.max} mirror=${b ? `${b.min}–${b.max}` : 'absent'}`);
          }
        }
        if (mirror.UI_PREFS_DEFAULTS[pref.key] !== pref.default) {
          return report('fail', 'UI prefs registry ⇄ schema sync',
            `default drift for ${pref.key}: registry=${JSON.stringify(pref.default)} mirror=${JSON.stringify(mirror.UI_PREFS_DEFAULTS[pref.key])}`);
        }
      }

      // 3. Theme four-way parity subset: mirror enum ⇄ THEME_PRESETS values.
      const presetValues = registry.THEME_PRESETS.map((t) => t.value).sort();
      const mirrorTheme = [...(mirror.UI_PREFS_ENUMS.theme || [])].sort();
      if (JSON.stringify(presetValues) !== JSON.stringify(mirrorTheme)) {
        return report('fail', 'UI prefs registry ⇄ schema sync',
          `THEME_PRESETS ⇄ mirror enum drift: presets=${JSON.stringify(presetValues)} mirror=${JSON.stringify(mirrorTheme)}`);
      }

      return report('ok', 'UI prefs registry ⇄ schema sync',
        `${userPrefs.length} user prefs, ${registry.THEME_PRESETS.length} theme presets — keys/enums/bounds/defaults agree with the server mirror`);
    }).catch((err) => report('fail', 'UI prefs registry ⇄ schema sync',
      `registry import failed: ${err.message}`));
  } catch (err) {
    return report('fail', 'UI prefs registry ⇄ schema sync', `check error: ${err.message}`);
  }
}
