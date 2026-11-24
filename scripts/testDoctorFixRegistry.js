#!/usr/bin/env node
/**
 * scripts/testDoctorFixRegistry.js — regression suite for the doctor's
 * consent-fix registry (FIX_REGISTRY in scripts/doctor.js).
 *
 * Ensures every auto-fix's PRECONDITIONS behave exactly as documented:
 *   A. Registry invariants — unique ids, required fields, safe-shape contract
 *   B. env-from-template  — applies only when .env is ABSENT + template exists;
 *                           real execution creates it with seeded limits;
 *                           never overwrites an existing file
 *   C. dev-db-reset       — applies only on the "not found yet" warning;
 *                           BLOCKED (with a printed reason) while :3000 is
 *                           live; real execution skipped live (resetDb has
 *                           its own live-API guard and production refusal;
 *                           the accept-path was certified end-to-end by the
 *                           doctor gate runs recorded in PLAN.MD)
 *   D. collectApplicableFixes — wiring: precondition ∧ ¬blocked ⇒ offered
 *
 * Read-only for the real repo: executions run in scripts/.runtime/doctfix
 * with a copied doctor (ctx.ROOT points at the sandbox, mirroring how
 * doctor.js resolves paths). Run: node scripts/testDoctorFixRegistry.js
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RUNTIME = path.resolve('scripts/.runtime/doctfix');
const SANDBOX = path.join(RUNTIME, 'root');             // fake repo root for ctx

let passed = 0, failed = 0;
function assert(cond, msg, detail = '') {
  if (cond) { console.log(`PASS - ${msg}`); passed++; }
  else { console.log(`FAIL - ${msg}${detail ? ` — ${detail}` : ''}`); failed++; }
}
function resetSandbox() {
  fs.rmSync(RUNTIME, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  fs.copyFileSync(path.resolve('scripts/doctor.js'), path.join(SANDBOX, 'doctor.js'));
  fs.mkdirSync(path.join(SANDBOX, 'scripts'), { recursive: true });
  fs.copyFileSync(path.resolve('server/utils/appLock.js'), path.join(SANDBOX, 'scripts', 'appLock.js'));
}

/** Run a doctor.js snippet in the sandbox with this repo as the module base.
 *  Returns { code, stdout } — snippet receives { doctor, fs, path, SANDBOX }. */
function runSnippet(snippet, extraEnv = {}) {
  return new Promise((resolve) => {
    const code = `
import fs from 'node:fs';
import path from 'node:path';
const payload = JSON.parse(process.env.SUITE_PAYLOAD);
const doctor = await import(payload.doctor);
const ctx = { ROOT: payload.SANDBOX, pid3000: null, env: {} };
${snippet}
`;
    const p = new URL('./doctor.js', pathToFileURL(path.resolve('scripts/')).href);
    void p;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        ...extraEnv,
        SUITE_PAYLOAD: JSON.stringify({
          doctor: pathToFileURL(path.resolve('scripts/doctor.js')).href,  // real module…
          SANDBOX,                                                        // …sandbox ctx
        }),
      },
      encoding: 'utf-8',
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code2) => resolve({ code: code2, stdout: out }));
  });
}

async function main() {
  console.log('════════════════════════════════════════════════════');
  console.log('  DOCTOR FIX REGISTRY SUITE (consent-fix preconditions)');
  console.log('════════════════════════════════════════════════════');

  // ── A. Registry invariants ─────────────────────────────────────────
  {
    const { code, stdout } = await runSnippet(`
      const ids = doctor.FIX_REGISTRY.map(f => f.id);
      const entries = doctor.FIX_REGISTRY.map(f => ({
        id: f.id,
        hasTitle: typeof f.title === 'string' && f.title.length > 0,
        hasPrompt: typeof f.prompt === 'string' && f.prompt.includes('[y/N]'),
        appliesFn: typeof f.applies === 'function',
        blockedByFn: typeof f.blockedBy === 'function' || f.blockedBy == null,
        applyFn: typeof f.apply === 'function',
      }));
      console.log(JSON.stringify({ ids, entries }));
    `);
    assert(code === 0, 'registry loads and exports cleanly', stdout.slice(0, 200));
    let parsed = null;
    try { parsed = JSON.parse(stdout.trim().split('\n').pop()); } catch { /* handled below */ }
    assert(parsed != null, 'registry introspection parses');
    if (parsed) {
      assert(new Set(parsed.ids).size === parsed.ids.length, 'fix ids are unique', parsed.ids.join(','));
      assert(parsed.ids.includes('env-from-template') && parsed.ids.includes('dev-db-reset'), 'both known fixes present', parsed.ids.join(','));
      for (const e of parsed.entries) {
        assert(e.hasTitle && e.hasPrompt && e.appliesFn && e.blockedByFn && e.applyFn,
          `entry "${e.id}" satisfies the contract`, JSON.stringify(e));
      }
    }
  }

  // ── B. env-from-template preconditions + real execution ────────────
  {
    // B1. .env absent + template present ⇒ applies, real run creates it.
    resetSandbox();
    fs.writeFileSync(path.join(SANDBOX, '.env.example'), '[TEMPLATE]\n# Environment Variables\nAUTH_RATE_LIMIT_MAX=5\n');
    const r1 = await runSnippet(`
      const rows = [{ title: '.env file', status: 'warn' }];
      const fixes = doctor.collectApplicableFixes(rows, ctx);
      console.log('OFFERED:' + fixes.length);
      if (fixes.length) console.log('NOTE:' + await fixes[0].apply(ctx));
      console.log('ENV_NOW:' + fs.existsSync(path.join(ctx.ROOT, '.env')));
      const body = fs.readFileSync(path.join(ctx.ROOT, '.env'), 'utf8');
      console.log('SEEDED:' + /AUTH_RATE_LIMIT_MAX=30/.test(body));
      console.log('MARKERS_GONE:' + !body.includes('[TEMPLATE]'));
      // Idempotence: a second apply must be a no-op (never overwrite).
      console.log('SECOND_APPLY_NULL:' + (await doctor.FIX_REGISTRY[0].apply(ctx) === null));
    `);
    const get = (k) => r1.stdout.split('\n').find((l) => l.startsWith(k + ':'))?.slice(k.length + 1);
    assert(r1.code === 0 && get('OFFERED') === '1', 'B1: .env absent + template ⇒ fix offered', r1.stdout.slice(0, 150));
    assert(get('NOTE')?.includes('QA-friendly'), 'B1: apply returns the seeded-limits note', get('NOTE') || '');
    assert(get('ENV_NOW') === 'true' && get('SEEDED') === 'true' && get('MARKERS_GONE') === 'true',
      'B1: real execution creates .env with seeded limits, markers stripped');
    assert(get('SECOND_APPLY_NULL') === 'true', 'B1: second apply is a no-op (never overwrites)');

    // B2. .env already exists ⇒ NOT offered.
    const r2 = await runSnippet(`
      const rows = [{ title: '.env file', status: 'warn' }];
      console.log('OFFERED:' + doctor.collectApplicableFixes(rows, ctx).length);
    `);
    assert(r2.code === 0 && r2.stdout.includes('OFFERED:0'), 'B2: .env exists ⇒ fix NOT offered (never overwrites)');

    // B3. .env absent but check row is ok/absent ⇒ NOT offered (precondition binds to the row).
    resetSandbox();
    fs.writeFileSync(path.join(SANDBOX, '.env.example'), 'X=1\n');
    const r3 = await runSnippet(`
      console.log('OFFERED:' + doctor.collectApplicableFixes([], ctx).length);
    `);
    assert(r3.code === 0 && r3.stdout.includes('OFFERED:0'), 'B3: no matching check row ⇒ fix NOT offered');
  }

  // ── C. dev-db-reset preconditions + blocking ───────────────────────
  {
    // C1. "not found yet" warning + :3000 live ⇒ applies=true but BLOCKED with a reason.
    resetSandbox();
    const r1 = await runSnippet(`
      const rows = [{ title: 'Dev database', status: 'warn', detail: 'database.sqlite not found yet — it is created on first start' }];
      const ctxLive = { ...ctx, pid3000: 4321 };
      const offered = doctor.collectApplicableFixes(rows, ctxLive);
      console.log('OFFERED_LIVE:' + offered.length);
      const unblocked = doctor.collectApplicableFixes(rows, ctx);
      console.log('OFFERED_FREE:' + unblocked.length);
    `);
    assert(r1.code === 0 && r1.stdout.includes('OFFERED_LIVE:0') && r1.stdout.includes('OFFERED_FREE:1'),
      'C1: db fix blocked while :3000 live (reason printed), offered when free', r1.stdout.slice(0, 250));
    assert(r1.stdout.includes('NOT offering reset:db'), 'C1: blocking reason explains itself');

    // C2. Corrupt-DB fail row ⇒ NOT offered (that stays manual by design).
    const r2 = await runSnippet(`
      const rows = [{ title: 'Dev database', status: 'fail', detail: 'could not open … file is not a database' }];
      console.log('OFFERED:' + doctor.collectApplicableFixes(rows, ctx).length);
    `);
    assert(r2.code === 0 && r2.stdout.includes('OFFERED:0'), 'C2: corrupt DB (fail) ⇒ never auto-fixed — manual by design');

    // C3. Healthy DB ok row ⇒ NOT offered.
    const r3 = await runSnippet(`
      const rows = [{ title: 'Dev database', status: 'ok' }];
      console.log('OFFERED:' + doctor.collectApplicableFixes(rows, ctx).length);
    `);
    assert(r3.code === 0 && r3.stdout.includes('OFFERED:0'), 'C3: healthy DB row ⇒ fix NOT offered');
    // C4 note: the real reset:db accept-path (sandboxed :3000-free run) is
    // covered by the doctor-gate verification recorded in PLAN.MD; running
    // it here would mutate the real dev DB, which this suite must not do.
    console.log('SKIP - C4: real reset:db execution (covered by doctor-gate certification; would touch the real dev DB)');
  }

  // ── Cleanup ────────────────────────────────────────────────────────
  fs.rmSync(RUNTIME, { recursive: true, force: true });

  console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('suite crashed:', err.message);
  fs.rmSync(RUNTIME, { recursive: true, force: true });
  process.exit(1);
});
