import fs from 'node:fs';
const s = fs.readFileSync('scripts/testLeaveRequests.js', 'utf8');
let d = 0;
let stack = [];
for (let i = 0; i < s.length; i++) {
  const c = s[i];
  if (c === '{') { d++; if (d > 4) stack.push(i); }
  if (c === '}') d--;
}
console.log('final:', d, 'peaks:', stack.map(p => s.slice(p - 30, p + 60).replace(/\n/g, ' ')));
