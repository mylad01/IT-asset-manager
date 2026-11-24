// Doctor check #16 (PLAN.MD §13): storage key literals stay single-source.
//
// Every client-side storage key literal must appear in EXACTLY ONE module —
// either a retired key's sweep constant, or a scoped key's documented owner.
// Two flavors, one mechanism (each key lists its only legal file):
//
//   retired — the studioTheme treatment (2026-09-29): no reader, no writer,
//             no fallback. The single occurrence exists only so
//             applyPreferences() can sweep the stale key off old installs.
//
//   scoped  — deliberate single-source owners with docstring-justified
//             exceptions to the registry-blob rule: auth identity keys
//             (appStorage), per-browser table view settings
//             (useTablePrefs — deliberately NOT users.ui_prefs: view
//             settings are per-browser, not user preferences), and the
//             disk banner's ephemeral tab-scoped dismiss TTL
//             (DiskStatusBanner — sessionStorage, not synced, not data).
//
// Scope = the shipped client surface (src/**, shared/**, index.html):
//   - every .js/.jsx/.mjs file under src/ and shared/
//   - index.html (hand-edited HTML is the easiest place for an old inline
//     snippet to reappear)
// server/ and scripts/ are OUT of scope: scripts/testPreferencesRegistry.js
// legitimately mentions keys in its own assertions (the string-matching
// that HOLDS the contracts), and server code reads the users.ui_prefs blob,
// never client localStorage keys.
//
// Counting rules (the same distinction the sync test draws): pure-comment
// lines are ignored so prose CAN explain the contracts (a rule nobody can
// document is a rule nobody follows); code occurrences are reported with
// file:line so the fix is mechanical.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Storage key literals and the ONLY file allowed to hold each one. */
const RETIRED_KEYS = [
  {
    key: 'studioTheme',
    allow: path.join('src', 'config', 'applyPreferences.js'),
    why: 'RETIRED sweep constant only — no reader, no writer, no fallback',
  },
  {
    key: 'studioUser',
    allow: path.join('src', 'utils', 'appStorage.js'),
    why: 'auth identity — AuthContext is the one writer; accessors for reads',
  },
  {
    key: 'studioToken',
    allow: path.join('src', 'utils', 'appStorage.js'),
    why: 'auth identity — AuthContext is the one writer; accessors for reads',
  },
  {
    key: 'studioUiPrefs',
    allow: path.join('shared', 'prePaintScript.js'),
    why: 'the registry blob single source — everyone else imports PREFS_STORAGE_KEY',
  },
  {
    key: 'studioTablePrefs',
    allow: path.join('src', 'hooks', 'useTablePrefs.js'),
    why: 'deliberately OUT of the registry blob — per-browser view settings, not user prefs (see its docstring)',
  },
  {
    key: 'diskBannerSeenUntil',
    allow: path.join('src', 'components', 'DiskStatusBanner.jsx'),
    why: 'ephemeral tab-scoped dismiss TTL (sessionStorage) — not user data, intentionally never synced (see its docstring)',
  },
];

/** Pure-comment line: prose about the retirement never trips the guard. */
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

export function checkRetiredKeys(report) {
  try {
    const problems = [];

    const scanFile = (rel, src) => {
      const lines = src.split(/\r?\n/);
      for (const { key, allow } of RETIRED_KEYS) {
        if (rel === allow) continue; // the sanctioned sweep constant
        lines.forEach((line, i) => {
          if (COMMENT_LINE.test(line)) return;
          if (line.includes(key)) problems.push(`  ${rel.replace(/\\/g, '/')}:${i + 1} → "${key}"`);
        });
      }
    };

    const scanDir = (relDir) => {
      const abs = path.join(ROOT, relDir);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(relDir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules' && !e.name.startsWith('.')) scanDir(rel);
          continue;
        }
        if (!/\.(jsx|js|mjs)$/.test(e.name)) continue;
        scanFile(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      }
    };

    scanDir('src');
    scanDir('shared');
    const indexHtml = path.join('index.html');
    if (fs.existsSync(path.join(ROOT, indexHtml))) {
      scanFile(indexHtml, fs.readFileSync(path.join(ROOT, indexHtml), 'utf8'));
    }

    if (problems.length > 0) {
      const detail = RETIRED_KEYS.map(({ key, allow, why }) => `"${key}" is legal ONLY in ${allow.replace(/\\/g, '/')} (${why})`).join('; ');
      return report('fail', 'Storage key literals stay single-source',
        `${problems.length} code reference(s) outside the key's single owner:\n`
        + problems.join('\n')
        + `\nFix: route the access through the owner listed below (import the shared constant/accessor — never restate the literal). Registry prefs come from the studioUiPrefs blob via readStoredPrefs/applyPreference. ${detail}.`);
    }
    return report('ok', 'Storage key literals stay single-source',
      `${RETIRED_KEYS.length} storage keys each confined to their one owner (src/, shared/, index.html scanned; comments exempt)`);
  } catch (err) {
    return report('fail', 'Storage key literals stay single-source', `check error: ${err.message}`);
  }
}

// CLI entry — `node scripts/lib/retiredKeysCheck.js`. Wired as the
// `prebuild` npm hook so `npm run build` FAILS before vite emits a bundle
// that references a retired identifier (doctor runs it too, but the build
// gate is the one that cannot be skipped by a fast-moving change).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let status = 'ok';
  let title = 'Storage key literals stay single-source';
  checkRetiredKeys((s, t, detail) => {
    status = s;
    title = t || title;
    if (detail) console.log(detail);
  });
  console.log(`[${status}] ${title}`);
  process.exitCode = status === 'ok' ? 0 : 1;
}
