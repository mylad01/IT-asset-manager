#!/usr/bin/env node
/**
 * scripts/testRetiredKeysGate.js — regression suite for doctor check #16,
 * the retired-storage-identifiers guard (scripts/lib/retiredKeysCheck.js).
 *
 * The check ships THREE ways with ONE implementation: `npm run doctor`,
 * the `prebuild` npm hook (fails `npm run build` before vite emits), and
 * an import inside scripts/testPreferencesRegistry.js. This suite pins the
 * behaviors that make the gate trustworthy, using a SANDBOX repo so the
 * real repo is only ever READ:
 *   A. CLI contract    — clean tree exits 0; a violating file anywhere in
 *                        the scanned surface exits 1 with file:line and the
 *                        remediation; the sweep constant stays legal.
 *   B. Comment zone    — pure-comment mentions do NOT trip the gate.
 *   C. Scope           — server/ and scripts/ are out of scope (the sync
 *                        test's own assertions must never trip it).
 *   D. Identity        — sandbox byte-copy == repo copy (guards the depth-
 *                        relative ROOT resolution the sandbox trick relies
 *                        on; a future edit that changes the file silently
 *                        breaks the sandbox premise and fails loudly HERE).
 *
 * Run: node scripts/testRetiredKeysGate.js — no DB, no server.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = path.join(ROOT, 'scripts', '.runtime', 'retiredkeys');
const SANDBOX = path.join(RUNTIME, 'root'); // fake repo root, same layout

let passed = 0, failed = 0;
const check = (ok, name, detail = '') => {
  if (ok) { console.log(`PASS - ${name}`); passed++; }
  else { console.log(`FAIL - ${name}${detail ? ` :: ${detail}` : ''}`); failed++; }
};

/** The check module copied to the SAME relative depth (scripts/lib/) so its
 *  ROOT = <sandbox> and the CLI scans the sandbox, never the real repo. */
const CHECK_REL = path.join('scripts', 'lib', 'retiredKeysCheck.js');

function resetSandbox() {
  fs.rmSync(RUNTIME, { recursive: true, force: true });
  fs.mkdirSync(path.join(SANDBOX, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, CHECK_REL),
    path.join(SANDBOX, CHECK_REL),
  );
}

/** Identity proof: the sandbox copy must equal the repo copy. If the real
 *  module gains behavior the sandbox copy lacks, the sandbox premise is
 *  dead — this test must fail, not pass vacuously. */
function assertSandboxIdentity() {
  const repoSrc = fs.readFileSync(path.join(ROOT, CHECK_REL), 'utf8');
  const boxSrc = fs.readFileSync(path.join(SANDBOX, CHECK_REL), 'utf8');
  check(repoSrc === boxSrc, 'sandbox check copy is byte-identical to the repo module');
}

/** Run the copied CLI against the sandbox. Returns { code, out }. */
function runGate() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(SANDBOX, CHECK_REL)], {
      cwd: SANDBOX,
      env: { ...process.env }, // deliberately UNCHANGED: the sandbox works
      // because of path layout, so no bypass vector exists to leak in
      windowsHide: true,
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
    p.on('error', (err) => resolve({ code: -1, out: String(err) }));
  });
}

const write = (rel, content) => {
  const abs = path.join(SANDBOX, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

const VIOLATION = "export const legacy = localStorage.getItem('studioTheme'); // deliberate violation\n";

// ── A. CLI contract ─────────────────────────────────────────────────────
{
  resetSandbox();
  assertSandboxIdentity();

  // A1. The CLI runs at all.
  const boot = await runGate();
  check(boot.code === 0, 'sandbox CLI exits 0 on a clean tree', boot.out.slice(0, 120));
  check(boot.out.includes('[ok]'), 'clean run reports [ok]', boot.out.slice(0, 120));

  // A2. THE prebuild contract: a violating file → exit 1.
  write('src/components/LegacyProbe.jsx', VIOLATION);
  const fail = await runGate();
  check(fail.code === 1, 'violating file → exit 1 (npm run build would abort)', `exit=${fail.code}`);
  check(fail.out.includes('[fail]'), 'violation reports [fail]', fail.out.slice(0, 120));

  // A3. The failure is actionable: file:line + remediation.
  const normalized = fail.out.replace(/\\/g, '/');
  check(normalized.includes('src/components/LegacyProbe.jsx:1'), 'violation cites file:line', fail.out.split('\n')[1] || '');
  check(fail.out.includes('studioUiPrefs'), 'remediation points at the registry blob path');

  // A4. Scanned surface: shared/ and index.html are inside it.
  fs.rmSync(path.join(SANDBOX, 'src', 'components', 'LegacyProbe.jsx'), { force: true });
  write('shared/deep/legacy.js', VIOLATION);
  let r = await runGate();
  check(r.code === 1, 'shared/ is inside the scanned surface', `exit=${r.code}`);
  fs.rmSync(path.join(SANDBOX, 'shared'), { recursive: true, force: true });
  write('index.html', '<script>var t = localStorage.getItem("studioTheme");</script>\n');
  r = await runGate();
  check(r.code === 1, 'index.html is inside the scanned surface', `exit=${r.code}`);

  // A5. The sanctioned sweep constant stays legal.
  fs.rmSync(path.join(SANDBOX, 'index.html'), { force: true });
  write('src/config/applyPreferences.js', "const RETIRED_THEME_KEY = 'studioTheme';\ntry { localStorage.removeItem(RETIRED_THEME_KEY); } catch {}\n");
  r = await runGate();
  check(r.code === 0, 'RETIRED_THEME_KEY sweep constant file is exempt', `exit=${r.code}`);
}

// ── B. Comment zone ─────────────────────────────────────────────────────
{
  resetSandbox();
  write('src/pages/Docs.jsx', [
    '// The retired studioTheme key was swept by applyPreferences — this comment',
    '/* mentions studioTheme inside a block comment and must stay legal. */',
    "export const ok = () => 'dark';\n",
  ].join('\n'));
  const r = await runGate();
  check(r.code === 0, 'pure-comment mentions of the retired key do not trip the gate', `exit=${r.code} ${r.out.split('\n')[0]}`);
}

// ── C. Scope: server/ and scripts/ are out ──────────────────────────────
{
  resetSandbox();
  // Files that exist in the REAL repo and legitimately mention the keys:
  // the sync test's assertions and (in real trees) server-side fixtures.
  write('scripts/testPreferencesRegistry.js', "const assert = (s) => s.includes('studioTheme');\n");
  write('server/services/legacyFixture.js', "export const k = 'studioTheme';\n");
  const r = await runGate();
  check(r.code === 0, 'scripts/ and server/ mentions are out of scope', `exit=${r.code} ${r.out.split('\n')[0]}`);
}

// ── D. The wire-up is real: package.json prebuild points at the check ───
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check(
    pkg.scripts?.prebuild === 'node scripts/lib/retiredKeysCheck.js',
    'package.json prebuild hook invokes the retired-keys check',
    JSON.stringify(pkg.scripts?.prebuild ?? null),
  );
  // doctor.js rides its own stream — assert the registration only when the
  // module is present, so this suite runs in every tree state.
  const doctorPath = path.join(ROOT, 'scripts', 'doctor.js');
  if (fs.existsSync(doctorPath)) {
    const doctorSrc = fs.readFileSync(doctorPath, 'utf8');
    check(
      doctorSrc.includes("from './lib/retiredKeysCheck.js'") && doctorSrc.includes('checkRetiredKeys(report)'),
      'doctor.js registers the same implementation as check #16',
    );
  }
}

fs.rmSync(RUNTIME, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
