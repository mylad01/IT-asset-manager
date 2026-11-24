#!/usr/bin/env node
/**
 * scripts/lib/sqlite3DriverCheck.js — make the sqlite3 native driver
 * self-heal under the repo's ignore-scripts install policy.
 *
 * Why this exists (rc3 install-reproducibility fix): the project .npmrc
 * sets `ignore-scripts=true` (a plain `npm install` must succeed on
 * machines with no C++ toolchain). better-sqlite3 and bcrypt ship bundled
 * prebuilds and load without install scripts; `sqlite3` — the primary DB
 * driver, via server/db/connection.js + archiveDb.js — downloads its
 * prebuilt binary in an install script, which the policy skips. npm
 * rebuild/override tricks silently no-op under ignore-scripts, so this
 * runs as a postinstall and:
 *
 *   1. requires the driver — success → exit 0 quietly (no-op);
 *   2. on failure, fetches the prebuilt binary via `prebuild-install
 *      -r napi` in the package dir (the same tool+target sqlite3's own
 *      install script uses — no compile, no toolchain);
 *   3. verifies the require again; a remaining failure is a HARD error
 *      with remediation (the one case where a missing toolchain matters,
 *      and it means the GitHub prebuilt download was unreachable —
 *      `npx prebuild-install -r napi` in node_modules/sqlite3 after
 *      restoring network access is the fix).
 *
 * Runs via the repo's own "postinstall" npm script — NOT via a package
 * lifecycle hook — so ignore-scripts never skips it.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function driverLoads() {
  for (const m of ['../server/db/connection.js', '../server/db/archiveDb.js']) {
    try {
      require.resolve(path.join(ROOT, m));
    } catch { /* resolution via require of ESM files is not the point */ }
  }
  // The real check: CJS-require the driver's own entry (sqlite3 is CJS).
  try {
    require(require.resolve('sqlite3', { paths: [ROOT] }));
    return true;
  } catch {
    return false;
  }
}

try {
  if (driverLoads()) {
    console.log('[sqlite3-driver] present — nothing to do.');
    process.exit(0);
  }

  console.log('[sqlite3-driver] binary missing (expected under ignore-scripts) — fetching prebuild…');
  const pkgDir = path.dirname(require.resolve('sqlite3/package.json', { paths: [ROOT] }));
  execSync('npx --yes prebuild-install -r napi', { cwd: pkgDir, stdio: 'inherit' });

  if (driverLoads()) {
    console.log('[sqlite3-driver] prebuilt binary fetched — driver OK.');
  } else {
    console.error('[sqlite3-driver] FATAL: driver still not loadable after prebuild-install.');
    console.error('  The GitHub prebuilt download likely failed. With network access:');
    console.error('    cd node_modules/sqlite3 && npx prebuild-install -r napi');
    process.exit(1);
  }
} catch (err) {
  console.error(`[sqlite3-driver] FATAL: ${err.message}`);
  console.error('  Fix: cd node_modules/sqlite3 && npx prebuild-install -r napi   (needs network, not a toolchain)');
  process.exit(1);
}
