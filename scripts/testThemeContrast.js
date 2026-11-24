#!/usr/bin/env node
/**
 * scripts/testThemeContrast.js — WCAG contrast contract for theme presets.
 *
 *   node scripts/testThemeContrast.js        (wired into `npm run test:all`)
 *
 * WHY THIS EXISTS (PLAN.MD §13 "theme engine v2" gap):
 * The registry's sync guards prove a new preset is WIRED correctly
 * (registry ⇄ zod mirror ⇄ index.css block ⇄ pre-paint map) but nothing
 * proved a new preset is LEGIBLE — a token delta could silently drop body
 * text to 1.8:1 and every structural check would still pass. This suite is
 * the missing leg: it computes real WCAG 2.1 contrast ratios for the token
 * pairs the UI actually renders, per preset, and fails when any pair drops
 * below its floor.
 *
 * HOW IT MODELS THE APP (same cascade index.css documents):
 *   1. Token layers merge in CSS order: :root base → [data-brightness]
 *      patch (only for light-mode presets) → [data-theme] delta. Same
 *      equal-specificity/later-wins rule the stylesheet relies on.
 *   2. Backdrop: body-gradient stops, composited the way the page actually
 *      paints them. Surfaces are translucent (glass over the gradient), and
 *      .glass applies backdrop-filter: blur() — so the LOCAL AVERAGE of the
 *      gradient is the representative backdrop behind a blurred surface.
 *      We use the mean of the preset's gradient stops and say so.
 *   3. Each pair composites bottom-up: backdrop → surface layer(s) → text
 *      (alpha included, standard painter's model), then applies the WCAG
 *      relative-luminance formula.
 *
 * THRESHOLDS — floors, not aspirations:
 *   Each pair carries a floor derived from the values the app SHIPS TODAY
 *   (measured, then rounded down), capped at the WCAG target for its tier
 *   (4.5 primary text / 3.0 secondary+large). The contract is regression
 *   prevention: a future preset or token edit that makes any pair worse
 *   than the shipped baseline FAILS. Pairs whose shipped value already
 *   sits below their WCAG target print as WARN (visible debt, not a gate).
 *   If a floor is ever raised deliberately, raise it HERE, in full view.
 *
 * TOKENS are required: a renamed/deleted token FAILS instead of being
 * skipped — the token names are part of the contract too.
 *
 * Layering: reads src/index.css + shared/preferencesRegistry.js only;
 * no server, no browser, no DOM. New presets are covered automatically
 * (THEME_PRESETS drives the loop) — that is the point.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_PRESETS } from '../shared/preferencesRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CSS_PATH = path.join(ROOT, 'src', 'index.css');

// ── Parse ──────────────────────────────────────────────────────────────

/** Strip comments + scan `selector { body }` blocks (quote-aware,
 *  nesting-aware: nested @media blocks fold into their top-level wrapper,
 *  which never matches a token selector, so no token block is missed). */
function scanBlocks(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  let depth = 0, pos = 0, sel = null, bodyStart = -1, str = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (str) { if (c === str && src[i - 1] !== '\\') str = null; continue; }
    if (c === '"' || c === "'") { str = c; continue; }
    if (c === '{') {
      if (depth === 0) { sel = src.slice(pos, i).trim(); bodyStart = i + 1; }
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        blocks.push({ selector: sel, body: src.slice(bodyStart, i) });
        sel = null; bodyStart = -1; pos = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      // Top-level statement (@import …;) — it is not part of the next
      // block's selector. Without this the FIRST selector in the file
      // becomes `@import "tailwindcss";` and :root tokens never load.
      pos = i + 1;
    }
  }
  return blocks;
}

/** Selector-list match: block counts if ANY comma-separated part === target. */
function selectorMatches(selectorList, target) {
  return selectorList.split(',').map((s) => s.trim()).includes(target);
}

/** Parse `--name: value;` declarations from a block body. */
function parseDecls(body) {
  const out = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[2].trim();
  return out;
}

// ── Colors ─────────────────────────────────────────────────────────────

const NAMED = { white: [255, 255, 255], black: [0, 0, 0], transparent: [0, 0, 0, 0] };

function parseColor(raw) {
  const v = String(raw).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 }; }
  m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) { const h = m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }; }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  if (NAMED[v]) { const [r, g, b, a = 1] = NAMED[v]; return { r, g, b, a }; }
  return null;
}

/** Painter's model: fg (with alpha) over opaque-or-translucent bg. */
function composite(bg, fg) {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

/** WCAG 2.1 relative luminance + contrast ratio. */
function luminance({ r, g, b }) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ── Layer assembly (mirrors the cascade documented in index.css) ───────

const blocks = scanBlocks(fs.readFileSync(CSS_PATH, 'utf8'));

function tokensFor(selector) {
  return blocks
    .filter((b) => selectorMatches(b.selector, selector))
    .map((b) => parseDecls(b.body))
    .reduce((acc, d) => Object.assign(acc, d), {});
}

function gradientStops(selector) {
  for (const b of blocks) {
    if (!selectorMatches(b.selector, selector)) continue;
    const m = /linear-gradient\(([^)]*(?:\([^)]*\)[^)]*)*)\)/.exec(b.body.replace(/\s+/g, ' '));
    if (!m) continue;
    const stops = [...m[1].matchAll(/#([0-9a-f]{6})/gi)].map((h) => parseColor('#' + h[1]));
    if (stops.length >= 2) return stops;
  }
  return null;
}

const BASE_TOKENS = tokensFor(':root');
const LIGHT_PATCH = tokensFor('[data-brightness="light"]');
const BASE_GRADIENT = gradientStops('body') || [{ r: 20, g: 20, b: 40, a: 1 }];
const LIGHT_GRADIENT = gradientStops('[data-brightness="light"] body');

const failures = [];
const warnings = [];
let passed = 0;

function check(name, ratio, floor, targetAA) {
  const shown = ratio.toFixed(2);
  if (ratio + 1e-9 < floor) {
    failures.push(`${name} = ${shown} (floor ${floor})`);
    console.log(`FAIL - ${name} = ${shown} (needs >= ${floor})`);
  } else {
    passed++;
    if (ratio + 1e-9 < targetAA) {
      warnings.push(`${name} = ${shown} (below WCAG AA ${targetAA}, at shipped floor ${floor})`);
      console.log(`PASS - ${name} = ${shown} (>= floor ${floor}) [WARN: below AA ${targetAA}]`);
    } else {
      console.log(`PASS - ${name} = ${shown} (>= ${floor}, AA ${targetAA})`);
    }
  }
}

// ── Pair contract ──────────────────────────────────────────────────────
// tiers: AA target 4.5 for primary text, 3.0-class for UI chips.
// floors = the WORST value across the presets shipped at introduction
//          (measured 2026-10-07, rounded DOWN), never above the tier AA
//          target. A future preset/token/gradient edit that pushes a pair
//          under its floor FAILS; anything between floor and AA prints
//          WARN — visible debt, not a gate. If you IMPROVE a token, raise
//          its floor here so the gain is locked in.
// surface = token names composited bottom-up ON TOP of the mean backdrop;
// text    = token composited on top of the surface chain.
const PAIRS = [
  // tier            text token                    surface chain (bottom→up)        floor  AA
  ['primary',  '--text-heading',             ['--modal-bg'],                       4.5, 4.5],
  ['primary',  '--text-body',                ['--modal-bg'],                       4.5, 4.5],
  ['primary',  '--text-on-glass',            ['--glass-bg'],                       3.2, 4.5],
  ['primary',  '--text-on-glass-secondary',  ['--glass-bg'],                       2.3, 4.5],
  ['primary',  '--input-text',               ['--glass-bg', '--input-bg'],         2.9, 4.5],
  ['primary',  '--table-cell',               ['--glass-bg'],                       2.9, 4.5],
  ['primary',  '--btn-text',                 ['--glass-bg', '--btn-bg'],           2.7, 4.5],
  ['primary',  '--sidebar-text-active',      ['--sidebar-bg', '--nav-active-bg'],  4.5, 4.5],
  ['primary',  '--sidebar-text',             ['--sidebar-bg'],                     4.5, 4.5],
  ['secondary','--table-header-text',        ['--glass-bg', '--table-header-bg'],  2.1, 4.5],
  ['muted',    '--text-on-glass-muted',      ['--glass-bg'],                       1.8, 4.5],
  ['muted',    '--text-label',               ['--glass-bg'],                       1.9, 4.5],
  ['muted',    '--input-placeholder',        ['--glass-bg', '--input-bg'],         1.6, 4.5],
  // badge chips (10–11px): AA target 4.5, floor = shipped minimum
  ['badge',    '--badge-green-text',  ['--glass-bg', '--badge-green-bg'],   2.3, 4.5],
  ['badge',    '--badge-blue-text',   ['--glass-bg', '--badge-blue-bg'],    1.9, 4.5],
  ['badge',    '--badge-red-text',    ['--glass-bg', '--badge-red-bg'],     2.0, 4.5],
  ['badge',    '--badge-purple-text', ['--glass-bg', '--badge-purple-bg'],  2.0, 4.5],
  ['badge',    '--badge-amber-text',  ['--glass-bg', '--badge-amber-bg'],   2.5, 4.5],
  ['badge',    '--badge-orange-text', ['--glass-bg', '--badge-orange-bg'],  2.0, 4.5],
  ['badge',    '--badge-gray-text',   ['--glass-bg', '--badge-gray-bg'],    2.2, 4.5],
];

const missingTokens = new Set();
const missingBlocks = new Set();

function color(tokens, name) {
  const raw = tokens[name];
  if (raw === undefined) { missingTokens.add(name); return { r: 0, g: 0, b: 0, a: 1 }; }
  const c = parseColor(raw);
  if (!c) { missingTokens.add(`${name} (unparseable: ${raw})`); return { r: 0, g: 0, b: 0, a: 1 }; }
  return c;
}

// ── The sweep: every preset × every pair ───────────────────────────────

console.log(`Theme contrast contract — ${THEME_PRESETS.length} presets × ${PAIRS.length} token pairs`);
console.log(`backdrop = mean of each preset's body-gradient stops (representative of backdrop-filter blur)`);
console.log('');

for (const preset of THEME_PRESETS) {
  // 1. token layers, CSS order
  const tokens = { ...BASE_TOKENS };
  if (preset.mode === 'light') Object.assign(tokens, LIGHT_PATCH);
  if (preset.tokens !== 'base' && preset.tokens !== 'patch') {
    const delta = blocks.some((b) => selectorMatches(b.selector, `[data-theme="${preset.value}"]`));
    if (!delta) missingBlocks.add(`[data-theme="${preset.value}"]`);
    Object.assign(tokens, tokensFor(`[data-theme="${preset.value}"]`));
  }

  // 2. backdrop = mean gradient stop
  let stops = BASE_GRADIENT;
  if (preset.mode === 'light' && LIGHT_GRADIENT) stops = LIGHT_GRADIENT;
  const themeStops = gradientStops(`[data-theme="${preset.value}"] body`);
  if (themeStops) stops = themeStops;
  const backdrop = {
    r: stops.reduce((s, c) => s + c.r, 0) / stops.length,
    g: stops.reduce((s, c) => s + c.g, 0) / stops.length,
    b: stops.reduce((s, c) => s + c.b, 0) / stops.length,
    a: 1,
  };

  // 3. pairs
  for (const [, textTok, surface, floor, aa] of PAIRS) {
    let bg = backdrop;
    for (const s of surface) bg = composite(bg, color(tokens, s));
    const fg = composite(bg, color(tokens, textTok));
    const ratio = contrast(fg, bg);
    check(`${preset.value} · ${textTok} on ${surface[surface.length - 1]}`, ratio, floor, aa);
  }
}

// ── Verdict ────────────────────────────────────────────────────────────

for (const t of [...missingTokens].sort()) {
  failures.push(`required token missing or unparseable: ${t}`);
  console.log(`FAIL - required token missing or unparseable: ${t}`);
}
for (const b of [...missingBlocks].sort()) {
  failures.push(`preset delta block missing in index.css: ${b}`);
  console.log(`FAIL - preset delta block missing in index.css: ${b}`);
}

if (warnings.length) {
  console.log(`\n${warnings.length} pair(s) below their WCAG AA target at the shipped baseline (debt, tracked by floor):`);
  for (const w of warnings) console.log(`  · ${w}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
