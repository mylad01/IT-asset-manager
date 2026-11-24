#!/usr/bin/env node
/**
 * scripts/releaseNotes.js — regenerate RELEASE-NOTES.md from the commit
 * streams at tag time.
 *
 * Git has no pre-tag hook, so "tag time" is the runbook this script prints
 * on every run:
 *   1. npm run release:notes           # rewrite the generated parts
 *   2. hand-edit the preserved tail    # Known follow-ups etc. (never clobbered)
 *   3. commit RELEASE-NOTES.md, then   # `git tag -a rcN` (exact command printed)
 *
 * What it does:
 *   - Range: newest `rc*` tag (or --from) → HEAD (or --to), so each RC's
 *     notes cover exactly the commits since the previous one.
 *   - Classifies every commit subject into the project's streams. Patterns
 *     are FIRST-MATCH-WINS and the QA/toolchain list runs FIRST: suite,
 *     sweep, PLAN.MD and release commits stay in Dev toolchain & QA even
 *     when their subjects mention a feature word (the 2026-09-29 journey +
 *     evidence-log commits are about the lifecycle feature but belong in
 *     QA). Feature streams follow the split's vocabulary (prefs/§13,
 *     conversations, branding, disk/WAL, asset lifecycle).
 *   - Header picks the next rc number from existing `rc*` tags (rc1 → rc2;
 *     --tag overrides) and stamps the --to commit hash + subject.
 *   - Preserves hand-edited content verbatim: everything from the
 *     hand-edited marker (or, in files written before the marker existed,
 *     from the `## Known follow-ups` heading) to EOF survives regeneration.
 *
 * Modes:
 *   node scripts/releaseNotes.js              # regenerate in place
 *   node scripts/releaseNotes.js --stdout     # preview, write nothing
 *   node scripts/releaseNotes.js --check      # exit 1 if the file is stale
 *                                             # vs git history (pre-tag gate)
 *   Flags: --from <ref> --to <ref> --tag <name> --out <path> --help
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const OUT_DEFAULT = 'RELEASE-NOTES.md';
const HAND_EDIT_MARKER = '<!-- hand-edited: everything below survives regeneration -->';

// First match wins; QA/toolchain deliberately first (see header comment).
const STREAMS = [
  { name: 'Dev toolchain & QA', patterns: [/\bqa\b/i, /\bsuites?\b/, /\btests?\b/, /\bsweep\b/, /\bdoctor\b/, /toolchain/, /dev-infra/, /plan\.md|evidence/i, /release/i] },
  { name: 'Preferences & storage integrity (§13)', patterns: [/\bprefs?\b|\bpreferences?\b/i, /pre-paint/i, /storage/i, /retired/i, /single-source/i, /§13/] },
  { name: 'Conversations v2', patterns: [/conversation/i, /\bchat\b/i, /oversight/i] },
  { name: 'Branding', patterns: [/branding/i] },
  { name: 'Disk-full hardening', patterns: [/disk/i, /\bwal\b/i, /watchdog/i] },
  { name: 'Asset lifecycle timeline', patterns: [/asset/i, /lifecycle/i, /created-row/i, /activity-log/i] },
];
const OTHER = 'Other changes';

const USAGE = `Usage: node scripts/releaseNotes.js [--stdout|--check] [--from <ref>] [--to <ref>] [--tag <name>] [--out <path>]

  --stdout   print the generated file instead of writing it
  --check    exit 1 (no write) if ${OUT_DEFAULT} differs from the generated content
  --from     range start (default: newest rc* tag, else the root commit)
  --to       range end (default: HEAD)
  --tag      tag name for the header (default: next rc number)
  --out      output path (default: ${OUT_DEFAULT})`;

const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
  } catch (e) {
    console.error(`releaseNotes: git command failed —\n  git ${cmd}\n${e.message.split('\n').slice(1).join('\n')}`);
    process.exit(1);
  }
};

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

if (hasFlag('help')) {
  console.log(USAGE);
  process.exit(0);
}

/** Non-throwing variant: null when the command fails (git() exits the process,
 *  which made the documented tagless fallback below unreachable dead code —
 *  observed live in a clone with no rc* tags). */
const gitQuiet = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

/** Range start: explicit flag > newest rc* tag > the root commit. */
function resolveFrom() {
  const explicit = flagValue('from');
  if (explicit) return explicit;
  return gitQuiet('describe --tags --match "rc*" --abbrev=0')
    || git('rev-list --max-parents=0 HEAD');
}

/** Next rc number from existing rc* tags (rc1 → rc2). */
function nextRcTag() {
  const numbers = git('tag -l "rc*"').split('\n').filter(Boolean)
    .map((t) => (/^rc(\d+)$/.exec(t)?.[1])).filter(Boolean).map(Number);
  return `rc${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

/** Everything from the preserved region to EOF, verbatim (or null). */
function preservedTail(current) {
  if (!current) return null;
  const markerAt = current.indexOf(HAND_EDIT_MARKER);
  if (markerAt >= 0) {
    return current.slice(current.indexOf('\n', markerAt) + 1).replace(/^\s*\n/, '');
  }
  const heading = '\n## Known follow-ups';
  const at = current.indexOf(heading);
  if (at >= 0) return current.slice(at + 1);
  return null;
}

function classify(subject) {
  for (const stream of STREAMS) {
    if (stream.patterns.some((re) => re.test(subject))) return stream.name;
  }
  return OTHER;
}

const TO = flagValue('to') || 'HEAD';
const FROM = resolveFrom();
const TAG = flagValue('tag') || nextRcTag();
const OUT = flagValue('out') || OUT_DEFAULT;
const STDOUT = hasFlag('stdout');
const CHECK = hasFlag('check');

const logLines = git(`log ${JSON.stringify(FROM)}..${JSON.stringify(TO)} --format=%h%x09%s`).split('\n').filter(Boolean);
// Release-notes commits are excluded from the described range: the file
// stamps "→ commit <HEAD-at-generation>", and the notes commit itself
// moves HEAD — without this filter, --check could never pass at push time
// (observed live on the first rc-tag push through the pre-push gate).
const isNotesCommit = (subject) => /^regenerate release notes/i.test(subject);
const commits = logLines.map((line) => {
  const tab = line.indexOf('\t');
  return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
}).filter((c) => !isNotesCommit(c.subject));

if (commits.length === 0) {
  console.log(`releaseNotes: no commits in ${FROM}..${TO} — nothing to generate.`);
  process.exit(0);
}

// Header stamp: the newest NON-notes commit in range. When TO is the notes
// commit itself (post-commit, pre-tag — the state --check runs in), stamping
// HEAD would flip the header between generation and check and make --check
// unpassable; stamping the newest content commit keeps it stable.
const headerCommit = commits[0];

const grouped = new Map(STREAMS.map((s) => [s.name, []]));
const other = [];
for (const c of commits) {
  const stream = classify(c.subject);
  if (stream === OTHER) other.push(c);
  else grouped.get(stream).push(c);
}

const toShort = headerCommit.hash;
const toDate = git(`log -1 --format=%as ${JSON.stringify(toShort)}`);
const fromDate = git(`log -1 --format=%as ${JSON.stringify(FROM)}`);
const headSubject = headerCommit.subject.replace(/"/g, '\\"');

const lines = [];
lines.push(`# Release Candidate ${TAG.replace(/^rc/, '')} — ${toDate}`);
lines.push('');
lines.push(`Tag: \`${TAG}\` → commit \`${toShort}\` ("${headSubject}")`);
lines.push('');
lines.push(`${commits.length} commits since ${FROM} (${fromDate}), grouped into the streams`);
lines.push('below. Generated by `scripts/releaseNotes.js` — re-run `npm run release:notes`');
lines.push('after new commits; hand-edit only the section at the bottom.');
lines.push('');
lines.push('## Streams');
lines.push('');
for (const stream of STREAMS) {
  const items = grouped.get(stream.name);
  if (!items || items.length === 0) continue;
  lines.push(`### ${stream.name}`);
  lines.push('');
  for (const c of items) lines.push(`- \`${c.hash}\` — ${c.subject}`);
  lines.push('');
}
if (other.length > 0) {
  lines.push(`### ${OTHER}`);
  lines.push('');
  for (const c of other) lines.push(`- \`${c.hash}\` — ${c.subject}`);
  lines.push('');
}

const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
const tail = preservedTail(current);
const generated = lines.join('\n').replace(/\n+$/, '\n') + (tail ? `\n${tail.replace(/\s*$/, '\n')}` : '');

if (CHECK) {
  if (current !== null && current === generated) {
    console.log(`releaseNotes: ${OUT} is current for ${FROM}..${TO} (${commits.length} commits).`);
    process.exit(0);
  }
  console.log(`releaseNotes: ${OUT} is STALE vs ${FROM}..${TO} (${commits.length} commits) — run \`npm run release:notes\` before tagging.`);
  process.exit(1);
}

if (STDOUT) {
  process.stdout.write(generated);
  process.exit(0);
}

fs.writeFileSync(OUT, generated);
console.log(`releaseNotes: wrote ${OUT} — ${commits.length} commits since ${FROM} in ${grouped.size + (other.length ? 1 : 0)} streams; tail ${tail ? 'preserved' : 'empty (none to preserve)'}.`);
console.log('Next:');
console.log(`  git add ${OUT}`);
console.log(`  git commit -m "Regenerate release notes for ${TAG}"`);
console.log(`  git tag -a ${TAG} -m "Release candidate ${TAG.replace(/^rc/, '')}"`);
