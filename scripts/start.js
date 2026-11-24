#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCK_FILE = resolve(__dirname, '..', 'logs', '.app.lock');

function run(file, args) {
  try {
    execFileSync(file, args, { stdio: 'inherit' });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

async function main() {
  if (existsSync(LOCK_FILE)) {
    const killCode = run(process.execPath, [resolve(__dirname, 'kill-server.js')]);
    if (killCode !== 0) {
      process.exit(1);
    }
  }

  const serverCode = run(process.execPath, [resolve(__dirname, '..', 'server', 'index.js')]);
  process.exit(serverCode);
}

main();
