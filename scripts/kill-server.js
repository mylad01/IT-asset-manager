#!/usr/bin/env node

import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';
import { isLockLive, getProcessImage } from '../server/utils/appLock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCK_FILE = resolve(__dirname, '..', 'logs', '.app.lock');

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
};

const box = {
  tl: '\u250C', tr: '\u2510', bl: '\u2514', br: '\u2518',
  h: '\u2500', v: '\u2502', ml: '\u251C', mr: '\u2524',
};

function line(len, char = box.h) {
  return char.repeat(len);
}

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

function boxRow(text, width) {
  const stripped = text.replace(ANSI_RE, '');
  const padding = width - stripped.length - 4;
  return `  ${box.v} ${text}${' '.repeat(Math.max(0, padding))} ${box.v}`;
}

function printBanner() {
  const w = 52;
  console.log();
  console.log(`  ${c.cyan}${box.tl}${line(w, box.h)}${box.tr}${c.reset}`);
  console.log(`  ${c.cyan}${box.v}${c.reset}${' '.repeat(14)}${c.bold}${c.white}SERVER LOCK KILLER${c.reset}${' '.repeat(14)}${c.cyan}${box.v}${c.reset}`);
  console.log(`  ${c.cyan}${box.ml}${line(w, box.h)}${box.mr}${c.reset}`);
  console.log(boxRow(`${c.dim}Detect and terminate stale server processes${c.reset}`, w));
  console.log(boxRow(`${c.dim}that prevent ${c.cyan}npm start${c.reset}${c.dim} from launching${c.reset}`, w));
  console.log(`  ${c.cyan}${box.bl}${line(w, box.h)}${box.br}${c.reset}`);
  console.log();
}

function getProcessInfo(pid) {
  try {
    if (process.platform === 'win32') {
      const raw = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf-8', timeout: 5000 }).trim();
      const parts = raw.split(',');
      if (parts.length >= 5) {
        const name = parts[0].replace(/"/g, '');
        const mem = parts[4].replace(/"/g, '');
        return { name, memory: mem, alive: true };
      }
      return { alive: false };
    } else {
      const raw = execSync(`ps -p ${pid} -o comm=,rss=,etime=`, { encoding: 'utf-8', timeout: 5000 }).trim();
      const [name, rss, elapsed] = raw.split(/\s+/);
      const memMB = rss ? (parseInt(rss, 10) / 1024).toFixed(1) + ' MB' : 'unknown';
      return { name: name || 'unknown', memory: memMB, elapsed: elapsed || 'unknown', alive: true };
    }
  } catch {
    return { alive: false };
  }
}

function killProcess(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf-8', timeout: 10000 });
    } else {
      process.kill(pid, 'SIGTERM');
      setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }, 3000);
    }
    return true;
  } catch {
    return false;
  }
}

function removeLockFile() {
  try {
    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function askQuestion(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans.trim().toLowerCase()); }));
}

async function main() {
  printBanner();

  if (!existsSync(LOCK_FILE)) {
    console.log(`  ${c.green}${box.tl}${line(44, box.h)}${box.tr}${c.reset}`);
    console.log(`  ${c.green}${box.v}${c.reset}  ${c.bold}${c.green}  NO LOCK FILE FOUND${c.reset}                             ${c.green}${box.v}${c.reset}`);
    console.log(`  ${c.green}${box.v}${c.reset}  ${c.dim}  Server is not running. Safe to start.${c.reset}        ${c.green}${box.v}${c.reset}`);
    console.log(`  ${c.green}${box.bl}${line(44, box.h)}${box.br}${c.reset}`);
    console.log();
    process.exit(0);
  }

  let pid;
  try {
    pid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
  } catch {
    console.log(`  ${c.red}  Failed to read lock file.${c.reset}`);
    process.exit(1);
  }

  if (isNaN(pid)) {
    console.log(`  ${c.red}  Lock file contains invalid PID: ${readFileSync(LOCK_FILE, 'utf-8').trim()}${c.reset}`);
    console.log(`  ${c.yellow}  Removing stale lock file...${c.reset}`);
    removeLockFile();
    console.log(`  ${c.green}  Done. Safe to start.${c.reset}`);
    process.exit(0);
  }

  const info = getProcessInfo(pid);
  // Image validation: a PID lock can outlive its owner and Windows recycles
  // PIDs — "ALIVE" alone proves nothing (observed live: a stale lock whose
  // PID resolved to svchost.exe). Classify before offering the kill.
  let verdict = { live: false, stale: true, image: null };
  try { verdict = await isLockLive(LOCK_FILE); } catch { /* fall back to info.alive below */ }
  const isNodeImage = /^node(\.exe)?$/i.test(info.name || '');
  const lockIsLiveNode = verdict.live && isNodeImage;
  const lockIsRecycled = info.alive && !isNodeImage;

  console.log(`  ${c.yellow}${box.tl}${line(44, box.h)}${box.tr}${c.reset}`);
  console.log(`  ${c.yellow}${box.v}${c.reset}  ${c.bold}${c.yellow}  LOCK DETECTED${c.reset}                                ${c.yellow}${box.v}${c.reset}`);
  console.log(`  ${c.yellow}${box.v}${c.reset}                                                    ${c.yellow}${box.v}${c.reset}`);
  console.log(`  ${c.yellow}${box.v}${c.reset}  ${c.white}PID:${c.reset}       ${c.bold}${c.cyan}${pid}${c.reset}                                  ${c.yellow}${box.v}${c.reset}`);
  // Status line now distinguishes a validated live server from a recycled
  // PID masquerading as one — the entire point of the image check.
  const statusLabel = lockIsLiveNode
    ? `${c.bold}${c.red}ALIVE — our node server (validated)${c.reset}`
    : lockIsRecycled
      ? `${c.bold}${c.yellow}STALE — PID recycled by ${info.name}${c.reset}`
      : !info.alive
        ? `${c.bold}${c.dim}DEAD (stale)${c.reset}`
        : `${c.bold}${c.yellow}ALIVE — non-node image${c.reset}`;
  console.log(`  ${c.yellow}${box.v}${c.reset}  ${c.white}Status:${c.reset}    ${statusLabel}`);
  if (info.alive && !lockIsLiveNode) {
    console.log(`  ${c.yellow}${box.v}${c.reset}  ${c.white}Warning:${c.reset}  ${c.dim}lock PID is NOT a node process${c.reset}`);
    console.log(`  ${c.yellow}${box.v}${c.reset}  ${c.dim}          — removing the lock is safe; killing it is NOT offered${c.reset}`);
  }
  if (info.name) {
    console.log(`  ${c.yellow}${box.v}${c.reset}  ${c.white}Process:${c.reset}  ${c.dim}${info.name}${c.reset}                               ${c.yellow}${box.v}${c.reset}`);
  }
  if (info.memory) {
    console.log(`  ${c.yellow}${box.v}${c.reset}  ${c.white}Memory:${c.reset}   ${c.dim}${info.memory}${c.reset}                                ${c.yellow}${box.v}${c.reset}`);
  }
  if (info.elapsed) {
    console.log(`  ${c.yellow}${box.v}${c.reset}  ${c.white}Uptime:${c.reset}   ${c.dim}${info.elapsed}${c.reset}                                ${c.yellow}${box.v}${c.reset}`);
  }
  console.log(`  ${c.yellow}${box.v}${c.reset}  ${c.white}Lock file:${c.reset} ${c.dim}logs/.app.lock${c.reset}                          ${c.yellow}${box.v}${c.reset}`);
  console.log(`  ${c.yellow}${box.bl}${line(44, box.h)}${box.br}${c.reset}`);
  console.log();

  const prompt = lockIsLiveNode
    ? `  ${c.bold}${c.white}  Kill server ${c.red}${pid}${c.reset}${c.bold}${c.white} and remove lock? [y/N]: ${c.reset}`
    : `  ${c.bold}${c.white}  Remove stale lock (PID ${pid} is not our server)? [y/N]: ${c.reset}`;
  const answer = await askQuestion(prompt);

  if (answer === 'y' || answer === 'yes') {
    console.log();

    if (lockIsRecycled || (!info.alive && !lockIsLiveNode)) {
      // Stale or recycled: never signal the PID — just clear the lock.
      if (lockIsRecycled) {
        console.log(`  ${c.dim}  PID ${pid} belongs to ${info.name} — NOT killing it. Removing stale lock only...${c.reset}`);
      } else {
        console.log(`  ${c.dim}  Process ${pid} is already dead. Removing stale lock...${c.reset}`);
      }
    } else if (lockIsLiveNode) {
      // Re-verify the image immediately before signaling (TOCTOU guard),
      // then kill — this is the only path that signals a PID.
      const re = await getProcessImage(pid);
      if (!/^node(\.exe)?$/i.test(re.image || '')) {
        console.log(`  ${c.red}  PID ${pid} is no longer a node process (${re.image || 'gone'}) — killing refused.${c.reset}`);
        console.log(`  ${c.yellow}  Removing the stale lock file anyway...${c.reset}`);
      } else {
        process.stdout.write(`  ${c.yellow}  Terminating server process ${pid}...${c.reset}`);
        const killed = killProcess(pid);
        if (killed) {
          console.log(`\r  ${c.green}  Server process ${pid} terminated successfully${c.reset}      `);
        } else {
          console.log(`\r  ${c.red}  Failed to terminate process ${pid}${c.reset}          `);
          console.log(`  ${c.yellow}  Attempting to remove lock file anyway...${c.reset}`);
        }
      }
    } else {
      // Live node image but the image-validated lock check said not-live:
      // metadata mismatch (e.g. a hand-written lock). Refuse to signal.
      console.log(`  ${c.red}  PID ${pid} is alive but not validated as this app's node server — killing refused.${c.reset}`);
      console.log(`  ${c.yellow}  Only the lock file will be removed.${c.reset}`);
    }

    const removed = removeLockFile();
    if (removed) {
      console.log(`  ${c.green}  Lock file removed${c.reset}`);
    } else {
      console.log(`  ${c.yellow}  Lock file was already gone${c.reset}`);
    }

    console.log();
    console.log(`  ${c.bgGreen}${c.bold}${c.white} Ready to start server: ${c.reset}${c.bold} npm start ${c.reset}`);
    console.log();
  } else {
    console.log();
    console.log(`  ${c.dim}  Aborted. Lock file preserved.${c.reset}`);
    console.log();
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`\n  ${c.red}Error: ${err.message}${c.reset}\n`);
  process.exit(1);
});
