// backupChecksums.js — SHA-256 manifest for conversation backup ZIPs.
//
// A backup you cannot verify is a backup you cannot trust: the manifest
// turns "the ZIP contains a conversations.sqlite" into "the ZIP contains
// conversations.sqlite whose bytes hash to <sha256>". Written into every
// backup ZIP as `SHA256SUMS` (sha256sum-compatible: `<hex>  <name>` per
// line, two spaces, LF endings) so it is checkable with the standard
// tool, and verifiable in-process through verifyZipChecksums().
//
// Home: server/utils per the layering rules — the backup SERVICE builds
// the manifest, and QA tooling (scripts/testBackupRestoreDrill.js)
// imports the verifier DOWN from here, exactly like appLock/liveApiGuard.
//
// Trust model (honest one): the manifest lives INSIDE the zip, so it
// proves ACCIDENTAL corruption — a truncated download, a bad disk sector,
// a half-written staging file — for every entry EXCEPT itself. It is not
// a signature: an attacker who can rewrite the zip can rewrite the
// manifest too. Tamper-evidence therefore works OUT-OF-BAND, and this
// module ships the pieces: conversationBackupService writes a byte-exact
// SIDECAR copy of SHA256SUMS next to the ZIP and records the manifest's
// own hash (manifestHashHex) in the backup-history row. Detecting a
// rewrite now needs the attacker to compromise three stores at once —
// the ZIP, the sidecar file, and the history DB — where before one
// rewrite of the ZIP hid everything.
//
// Self-verification contract: every non-hidden entry (paths not starting
// with '_' or '.') must appear exactly once; the manifest file itself is
// skipped. Missing entries, extra entries, or hash mismatches are all
// reported — a partial/failed zip write cannot pass.

import { createHash } from 'node:crypto';
import fsSync from 'node:fs';

export const MANIFEST_NAME = 'SHA256SUMS';

/** Out-of-band copy of the manifest, written NEXT TO the backup ZIP:
 *  `conversations-backup-<ts>.zip.SHA256SUMS` — byte-identical to the
 *  embedded entry, so the two can be diffed even when the database that
 *  logged the hash is unavailable. */
export const SIDECAR_SUFFIX = '.SHA256SUMS';

/** SHA-256 of a manifest (Buffer or utf-8 text) — the value recorded in
 *  the backup-history row for out-of-band tamper-evidence. */
export function manifestHashHex(manifest) {
  return sha256Hex(Buffer.isBuffer(manifest) ? manifest : Buffer.from(manifest, 'utf-8'));
}

/** SHA-256 of a Buffer, hex lowercase — the manifest's only format. */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Build the manifest text for an AdmZip instance: one
 * `<hex>  <entryName>` line per payload entry (LF endings). ZIP entry
 * names are normalized to forward slashes so the manifest matches
 * sha256sum's output and stays stable across OS ZipEntry name handling.
 * Entries starting with '_' or '.' are skipped — they are bookkeeping
 * (staging markers, dotfiles), not payload, and may legitimately change
 * between backup runs.
 */
export function buildChecksumsManifest(zip) {
  const lines = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    if (name.startsWith('_') || name.startsWith('.')) continue;
    lines.push(`${sha256Hex(entry.getData())}  ${name}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Verify a backup ZIP against its embedded manifest.
 * Returns { ok, checked, problems[] } — problems is empty when ok. Each
 * problem is a human-readable string: '<name>: missing from manifest',
 * '<name>: manifest hash mismatch (expected <a>, got <b>)',
 * '<name>: present in manifest but absent from zip', or
 * 'duplicate manifest line for <name>'.
 */
export function verifyZipChecksums(zip, { manifestName = MANIFEST_NAME } = {}) {
  const problems = [];
  const manifestEntry = zip.getEntry(manifestName);
  if (!manifestEntry) {
    return { ok: false, checked: 0, problems: [`no ${manifestName} entry — backup predates the manifest or the manifest was stripped`] };
  }

  // Parse: `<hex>  <name>` per line; collect duplicates.
  const expected = new Map();
  for (const raw of manifestEntry.getData().toString('utf-8').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([0-9a-f]{64})\s{2}(.+)$/.exec(line);
    if (!m) {
      problems.push(`manifest line does not match "<hex>  <name>": ${line.slice(0, 80)}`);
      continue;
    }
    const [, hash, name] = m;
    if (expected.has(name)) problems.push(`duplicate manifest line for ${name}`);
    else expected.set(name, hash);
  }

  // Every payload entry must be listed AND match.
  let checked = 0;
  const seen = new Set();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    if (name === manifestName || name.startsWith('_') || name.startsWith('.')) continue;
    const want = expected.get(name);
    if (want == null) {
      problems.push(`${name}: missing from manifest`);
      continue;
    }
    seen.add(name);
    const got = sha256Hex(entry.getData());
    checked += 1;
    if (got !== want) problems.push(`${name}: manifest hash mismatch (expected ${want}, got ${got})`);
  }

  // Every manifest line must correspond to a real entry.
  for (const name of expected.keys()) {
    if (!seen.has(name)) problems.push(`${name}: present in manifest but absent from zip`);
  }

  return { ok: problems.length === 0, checked, problems };
}

/**
 * Verify one extracted FILE against a manifest (used when a drill has
 * already written entries to disk): hash the file at `absPath` and
 * compare with the manifest line for `name`. Returns
 * { ok, expected, actual } — ok=false with actual=null when the file is
 * unreadable, with expected=null when the manifest does not list it.
 */
export function verifyFileAgainstManifest(manifestText, name, absPath) {
  let expected = null;
  for (const raw of manifestText.split('\n')) {
    const m = /^([0-9a-f]{64})\s{2}(.+)$/.exec(raw.trim());
    if (m && m[2] === name) { expected = m[1]; break; }
  }
  if (expected == null) return { ok: false, expected: null, actual: null };
  let actual = null;
  try {
    actual = sha256Hex(fsSync.readFileSync(absPath));
  } catch {
    return { ok: false, expected, actual: null };
  }
  return { ok: actual === expected, expected, actual };
}
