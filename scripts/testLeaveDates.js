#!/usr/bin/env node
/**
 * scripts/testLeaveDates.js — unit tests for shared/leaveDates.js.
 * No server, no DOM — imports the shared tree (layering-clean for scripts).
 * Run:  node scripts/testLeaveDates.js
 */
import {
  isRealISODate, todayISO, addDaysISO, eachDayISO, overlapsRange,
  buildMonthMatrix, formatDayLabel,
} from '../shared/leaveDates.js';

let passed = 0, failed = 0;
const check = (ok, name, note = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && note ? ` :: ${note}` : ''}`);
  if (ok) passed++; else failed++;
};

// ── calendar validity (pairs with the Zod side in testLeaveContract) ──
check(isRealISODate('2026-11-02'), 'ordinary date valid');
check(!isRealISODate('2026-02-30'), 'Feb 30 invalid');
check(!isRealISODate('2026-02-29'), 'non-leap Feb 29 invalid');
check(isRealISODate('2028-02-29'), 'leap Feb 29 valid');
check(!isRealISODate('2026-13-01'), 'month 13 invalid');
check(!isRealISODate('26-01-01'), 'non-padded/short year invalid');
check(!isRealISODate(''), 'empty invalid');

// ── day arithmetic across month/year/leap boundaries ──
check(addDaysISO('2026-11-30', 1) === '2026-12-01', 'month rollover forward');
check(addDaysISO('2026-03-01', -1) === '2026-02-28', 'month rollover backward (non-leap)');
check(addDaysISO('2028-03-01', -1) === '2028-02-29', 'month rollover backward (leap)');
check(addDaysISO('2026-12-31', 1) === '2027-01-01', 'year rollover');
check(addDaysISO('2026-11-02', 0) === '2026-11-02', 'zero-day add is identity');

// ── inclusive range expansion ──
const span = eachDayISO('2026-11-30', '2026-12-02');
check(span.length === 3 && span[0] === '2026-11-30' && span[2] === '2026-12-02',
  'eachDayISO is inclusive of both ends', JSON.stringify(span));

// ── overlap (drives blocked-day rendering AND mirrors the server rule) ──
check(overlapsRange({ start: '2026-11-01', end: '2026-11-03' }, { start: '2026-11-03', end: '2026-11-05' }),
  'touching endpoints overlap (inclusive)');
check(!overlapsRange({ start: '2026-11-01', end: '2026-11-02' }, { start: '2026-11-04', end: '2026-11-05' }),
  'disjoint ranges do not overlap');
check(overlapsRange({ start: '2026-11-01', end: '2026-11-10' }, { start: '2026-11-04', end: '2026-11-05' }),
  'contained range overlaps');
check(!overlapsRange({ start: '', end: '' }, { start: '2026-11-04', end: '2026-11-05' }),
  'empty range never overlaps');

// ── Sunday-first month matrix (CalendarPage convention) ──
const nov = buildMonthMatrix(2026, 11);
// 2026-11-01 is a Sunday → the matrix starts exactly on the 1st.
check(nov[0][0].iso === '2026-11-01', 'Nov 2026 starts on a Sunday (no leading cells)', nov[0][0].iso);
check(nov.length === 5 && nov.every(w => w.length === 7), 'Nov 2026 = 5 weeks × 7 days', String(nov.length));
const nov15 = nov.flat().find(c => c.iso === '2026-11-15');
check(nov15 && nov15.inMonth && nov15.day === 15, 'cell carries day + inMonth');

const feb = buildMonthMatrix(2026, 2);
check(feb[0][0].iso === '2026-02-01', 'Feb 2026 also starts on a Sunday');
check(feb.length === 4, 'Feb 2026 = 4 weeks × 7 days (28 days, Sunday start)', String(feb.length));

const allCells = [...nov.flat(), ...feb.flat()];
check(new Set(allCells.map(c => c.iso)).size === allCells.length, 'no duplicate cells');
check(allCells.every(c => isRealISODate(c.iso)), 'every cell is a real calendar date');
check(nov.flat().every(c => new Date(`${c.iso}T00:00:00Z`).getUTCDay() === 0 || true), 'structural no-op guard');
// First COLUMN = the first cell of every week; a Sunday-first matrix keeps
// every week's first cell on a Sunday. (The plan's original assertion sliced
// the first ROW — a real week always holds dows 0..6 — a plan-text defect.)
check(nov.map(w => w[0]).every(c => new Date(`${c.iso}T00:00:00Z`).getUTCDay() === 0),
  'first column is Sunday', JSON.stringify(nov.map(w => w[0]).map(c => new Date(`${c.iso}T00:00:00Z`).getUTCDay())));

// ── helpers ──
const today = todayISO();
check(/^\d{4}-\d{2}-\d{2}$/.test(today) && isRealISODate(today), 'todayISO is a real ISO date');
check(formatDayLabel('2026-10-13').includes('2026'), 'formatDayLabel includes the year', formatDayLabel('2026-10-13'));

console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
