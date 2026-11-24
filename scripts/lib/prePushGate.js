#!/usr/bin/env node
/**
 * scripts/lib/prePushGate.js — local pre-push hygiene gate.
 *
 * What runs before every push (wired via `npm run hooks:install`, which
 * writes .git/hooks/pre-push; see the install() block at the bottom):
 *
 *   1. test:retired-keys   — the retired-storage-keys sandbox gate (~1s).
 *                           Hard-fails the push on any violation: a retired
 *                           key in src/ must never leave the machine, even
 *                           by accident.
 *   2. doctor --fast       — the fast code-shape profile of the doctor
 *                           (layering, import cycles, import resolution,
 *                           guard coverage, prefs sync, semantic color
 *                           tokens): the deterministic
 *                           checks a bad COMMIT can break. Warns pass;
 *                           only [fail] blocks the push. Environment
 *                           probes are deliberately excluded.
 *   3. release:notes --check — RELEASE-NOTES.md staleness check vs git
 *                           history, with RC-AWARE teeth:
 *                             • pushing an rc* tag → hard fail on stale
 *                               notes (the runbook demands fresh notes at
 *                               tag time — this is the enforcement);
 *                             • pushing a plain branch → warn only, never
 *                               block (notes legitimately lag HEAD between
 *                               RCs; a hard gate here would train everyone
 *                               onto --no-verify).
 *
 * CLI: node scripts/lib/prePushGate.js [--install] [--check <remote>]
 *   --install        (re)write .git/hooks/pre-push with the shim
 *   --check <remote> run the gate body directly (pre-push reads stdin;
 *                    without stdin args default to a plain-branch check)
 *
 * The hook reads the refs git feeds it on stdin ("local-ref remote-ref")
 * so it can see WHEN A TAG IS BEING PUSHED — plain `git push` of a tag
 * never triggers most CI; this gate is the only local checkpoint.
 * Bypass: git push --no-verify (deliberate escapes allowed, the gate
 * prints itself so the bypass is at least a conscious act).
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const HOOK_PATH = path.join(ROOT, '.git', 'hooks', 'pre-push');

const SHIM = [
  '#!/usr/bin/env bash',
  `# Installed by "npm run hooks:install" (scripts/lib/prePushGate.js).`,
  `# Pre-push hygiene: retired-keys gate + RC-aware release-notes check.`,
  'cd "$(git rev-parse --show-toplevel)" || exit 1',
  'exec node scripts/lib/prePushGate.js --check "$@"',
  '',
].join('\n');

/** Refs git wants pushed, from pre-push stdin ("local-ref remote-ref"). */
function readStdinRefs() {
  try {
    return fs.readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

/** Tag-ref match is token-bounded, NOT line-end anchored: pre-push stdin
 *  lines are `<local-ref> <local-oid> <remote-ref> <remote-oid>` — the ref
 *  is followed by OIDs, and anchoring to $ would miss every real push. */
const includesRcTag = (refs) => refs.some((l) => /refs\/tags\/rc\d+(?:\s|$)/.test(l.trim()));

function runSuite(name, npmScript, { required }) {
  const res = spawnSync('npm', ['run', npmScript, '--silent'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  const ok = res.status === 0;
  if (ok) {
    console.log(`[pre-push] ${name}: PASS`);
    return true;
  }
  const tail = (res.stdout || res.stderr || '').split(/\r?\n/).filter(Boolean).slice(-4).join('\n           ');
  console.error(`[pre-push] ${name}: FAIL${required ? '' : ' (warning only)'}`);
  if (tail) console.error(`           ${tail}`);
  return !required;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--install')) {
    fs.mkdirSync(path.dirname(HOOK_PATH), { recursive: true });
    fs.writeFileSync(HOOK_PATH, SHIM.replace(/\n/g, '\n'));
    try { fs.chmodSync(HOOK_PATH, 0o755); } catch { /* Windows: exec bit not enforced */ }
    console.log(`[pre-push] hook installed at ${path.relative(ROOT, HOOK_PATH)}`);
    console.log('[pre-push] runs on every push: test:retired-keys (hard) + release-notes staleness (hard for rc* tags, warn for branches).');
    return;
  }

  if (!args.includes('--check')) {
    console.log('Usage: node scripts/lib/prePushGate.js --install | --check');
    process.exit(args.length ? 1 : 0);
  }

  const stdinRefs = readStdinRefs();
  const pushingRc = includesRcTag(stdinRefs);
  console.log(`[pre-push] ${pushingRc ? 'RC TAG push detected — full gate (stale notes hard-fail)' : 'branch push — gate (stale notes warn-only)'}`);

  let ok = true;
  ok = runSuite('test:retired-keys', 'test:retired-keys', { required: true }) && ok;
  ok = runSuite('doctor --fast', 'doctor -- --fast', { required: true }) && ok;
  ok = runSuite('release:notes --check', 'release:notes -- --check', { required: pushingRc }) && ok;

  if (ok) {
    console.log('[pre-push] gate passed — push proceeds.');
    process.exit(0);
  }
  console.error('[pre-push] gate BLOCKED the push. Fix the items above, or bypass consciously with `git push --no-verify`.');
  process.exit(1);
}

main();
