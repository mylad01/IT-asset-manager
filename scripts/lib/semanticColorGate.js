// Doctor check #18: semantic color tokens stay the ONLY color vocabulary in
// src/ (2026-10-07 palette sweep — 691 literal class sites converted to
// `-[color:var(--…)]` arbitrary values backed by the --status-*/--ui-* tokens
// in src/index.css :root).
//
// Three contract halves, one report row:
//   1. no literal palette class in src/ — `<variant?>:<util>-<hue>-<shade>`
//      (e.g. `hover:bg-amber-500/15`) is exactly what the sweep removed; a
//      reintroduction hard-codes a hue OUTSIDE the theme layer, so light
//      presets and future re-tints silently disagree with it.
//   2. no template-built palette class — `bg-${color}-500` is invisible to
//      Tailwind's scanner (it never emits a rule, so the style silently
//      renders nothing) AND invisible to a naive literal scan; both are
//      regressions, so the pattern is banned outright. The supported shape
//      is a STATIC arbitrary class + an inline custom property instead
//      (see CalendarPage's TYPE_META/PRIORITY_META complete-class maps, and
//      LayoutAndMotionSection's Toggle for the static-class + inline
//      custom-property variant).
//   3. every `var(--status-…)` / `var(--ui-…)` referenced in src/ has a
//      definition in src/index.css — a typo'd token name compiles and
//      builds green, then renders as "no style"; this closes that hole.
//
// Scope: src/**\/*.{jsx,js,mjs} + src/**/*.css, minus the print/PDF
// allowlist. scripts/ and docs/ may still MENTION palette classes (test
// fixtures, prose); they are outside the shipped client surface.
// Mirror: scripts/testThemeContrast.js pins the token VALUES; this pins the
// USAGE. Both ride `npm run doctor` (this file in the --fast profile too).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Files allowed to keep literal colors: fixed white-paper print/PDF surface. */
const ALLOWLIST = new Set([
  'components/TicketExport.jsx',
]);

const HUES = [
  'red', 'amber', 'blue', 'cyan', 'emerald', 'gray', 'indigo', 'orange',
  'pink', 'purple', 'sky', 'violet', 'green', 'slate', 'zinc', 'neutral',
  'stone', 'yellow', 'lime', 'teal', 'fuchsia', 'rose',
].sort((a, b) => b.length - a.length).join('|');

// Longest-first utility alternation (`ring-offset`, `border-l` before `ring`/`border`).
const UTILS = '(?:ring-offset|border-[trblxy]|divide-[trblxy]|text|bg|border|divide|ring|fill|stroke|from|via|to|accent|outline|caret|decoration|shadow)';
const VARIANTS = '(?:[a-z][a-z0-9-]*(?:-\\[[^\\]]*\\])?:)*';

const LITERAL_CLASS = new RegExp(
  `(?<![A-Za-z0-9-])(${VARIANTS})(${UTILS})-(${HUES})-(\\d{3})(?:\\/(\\d{1,3}))?(?![A-Za-z0-9-])`,
  'g',
);
// Template-built: util-…${…}-<shade> — the dynamic-string trap from above.
const TEMPLATE_CLASS = /(?:text|bg|border|ring|fill|stroke|from|via|to|accent|shadow)-\$\{[^}]*\}-\d{3}(?:\/\d{1,3})?/g;
// Token references that must resolve against index.css.
const TOKEN_REF = /var\(\s*(--(?:status|ui)-[a-z0-9-]+)/g;
const TOKEN_DEF = /(--(?:status|ui)-[a-z0-9-]+)\s*:/g;

const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** Blank every block-comment span while preserving line structure, so prose
 *  that MENTIONS a class ("was .text-amber-400") never trips the gate and
 *  line numbers stay exact. Pure `//` lines are skipped per-line below. */
function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(jsx?|mjs|css)$/.test(e.name)) yield p;
  }
}

/** file:line listings, capped so a mass regression stays readable. */
function list(items, max = 8) {
  const shown = items.slice(0, max).join('\n');
  const rest = items.length > max ? `\n  … and ${items.length - max} more` : '';
  return shown + rest;
}

export function checkSemanticColors(report) {
  try {
    const literal = [];
    const templated = [];
    const refs = new Set();
    let filesScanned = 0;

    for (const file of walk(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const srcRel = path.relative(path.join(ROOT, 'src'), file).split(path.sep).join('/');
      if (ALLOWLIST.has(srcRel)) continue;
      filesScanned++;
      const src = stripBlockComments(fs.readFileSync(file, 'utf8'));
      const lines = src.split(/\r?\n/);
      lines.forEach((line, i) => {
        const pureComment = COMMENT_LINE.test(line);
        if (!pureComment) {
          for (const m of line.matchAll(LITERAL_CLASS)) literal.push(`${rel}:${i + 1}: ${m[0]}`);
          for (const m of line.matchAll(TEMPLATE_CLASS)) templated.push(`${rel}:${i + 1}: ${m[0]}`);
          for (const m of line.matchAll(TOKEN_REF)) refs.add(m[1]);
        }
      });
    }

    // Definitions: the whole index.css (a preset override legitimately redefines a token).
    const defined = new Set();
    const cssPath = path.join(ROOT, 'src', 'index.css');
    if (fs.existsSync(cssPath)) {
      const css = stripBlockComments(fs.readFileSync(cssPath, 'utf8'));
      for (const m of css.matchAll(TOKEN_DEF)) defined.add(m[1]);
    }
    const undefinedRefs = [...refs].filter((t) => !defined.has(t)).sort();

    const title = 'Semantic color tokens (src/ uses --status-*/--ui-*, no palette classes)';

    if (literal.length) {
      return report('fail', title,
        `${literal.length} literal palette class(es) reintroduced — move the color into `
        + `src/index.css :root (--status-*/--ui-*) and use the semantic arbitrary value `
        + `(e.g. bg-[color:var(--status-warning-strong)]):\n  `
        + list(literal));
    }
    if (templated.length) {
      return report('fail', title,
        `${templated.length} template-built palette class(es) — Tailwind never emits these `
        + `(silent no-style) and they evade literal scans. Use a static arbitrary class + an `
        + `inline custom property instead (complete class strings in a meta map — `
        + `see src/pages/CalendarPage.jsx TYPE_META):\n  `
        + list(templated));
    }
    if (undefinedRefs.length) {
      return report('fail', title,
        `token(s) referenced in src/ but never defined in src/index.css :root `
        + `(renders as no style):\n  ${list(undefinedRefs)}`);
    }
    return report('ok', title,
      `${filesScanned} src files clean — ${refs.size} token reference(s) all defined in index.css; `
      + 'print/PDF surface exempt: components/TicketExport.jsx');
  } catch (err) {
    return report('fail', 'Semantic color tokens (src/ uses --status-*/--ui-*, no palette classes)',
      `scanner crashed: ${err && err.message ? err.message : err}`);
  }
}

// CLI entry — `node scripts/lib/semanticColorGate.js` prints violations and
// exits 1 (same shape as retiredKeysCheck, useful while sweeping).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = [];
  checkSemanticColors((s, t, d) => { rows.push({ s, t, d }); });
  for (const r of rows) console.log(`[${r.s}] ${r.t}\n${r.d || ''}`);
  process.exit(rows.some((r) => r.s === 'fail') ? 1 : 0);
}
