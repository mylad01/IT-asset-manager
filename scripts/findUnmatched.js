import fs from 'node:fs';
const s = fs.readFileSync('scripts/testLeaveRequests.js', 'utf8');

// Track open braces, ignoring strings/templates/regex/comments
let depth = 0;
let opens = []; // {pos, line}
let inStr = false, inTemplate = false, inRegex = false, inBlockComment = false;
let escape = false;
let lineNum = 1;

for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  const next = s[i + 1] || '';

  if (escape) { escape = false; continue; }

  if (inBlockComment) {
    if (ch === '*' && next === '/') { inBlockComment = false; i++; }
    if (ch === '\n') lineNum++;
    continue;
  }

  if (ch === '\n') { lineNum++; continue; }

  if (inStr) { if (ch === '"') inStr = false; continue; }
  if (inTemplate) { if (ch === '`') inTemplate = false; continue; }
  if (inRegex) {
    if (ch === '/' && !escape) inRegex = false;
    if (ch === '\n') { inRegex = false; lineNum++; }
    continue;
  }

  // Comments
  if (ch === '/' && next === '/') { while (s[i] !== '\n' && i < s.length) i++; lineNum++; continue; }
  if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }

  // String/regex start
  if (ch === '"' && !inTemplate && !inRegex) { inStr = true; continue; }
  if (ch === '`' && !inStr && !inRegex) { inTemplate = true; continue; }
  if (ch === '/' && !inStr && !inTemplate && (next === '/' || next === '*')) { inRegex = true; continue; }

  if (ch === '{') {
    depth++;
    opens.push({ pos: i, line: lineNum, ctx: s.slice(Math.max(0, i - 30), i + 60).replace(/\n/g, ' ') });
  }
  if (ch === '}') {
    if (opens.length > 0) opens.pop();
    depth--;
  }
}

console.log('Final depth:', depth);
if (opens.length > 0) {
  console.log('Unclosed braces (' + opens.length + '):');
  for (const o of opens.slice(-5)) {
    console.log('  line ' + o.line + ': ' + o.ctx);
  }
} else {
  console.log('All braces matched!');
}
