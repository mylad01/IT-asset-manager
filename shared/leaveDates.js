// leaveDates.js — pure date math for the leave UI.
// Lives in shared/ so BOTH src/ (components) and scripts/ (unit tests) can
// import it — scripts may never import src/ (doctor check #12), and this is
// the preferencesRegistry precedent.
// All ISO strings are zero-padded YYYY-MM-DD, so comparisons are string-safe.

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toISO(dt) {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** True for a syntactically ISO date that also exists on the calendar. */
export function isRealISODate(s) {
  if (!ISO_RE.test(String(s || ''))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today in the VIEWER'S local calendar as YYYY-MM-DD. */
export function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** ISO ± n days (n may be negative). */
export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return toISO(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Every day from start..end inclusive; capped at 10 years against bad input. */
export function eachDayISO(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end && out.length < 3660) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

/** Inclusive interval overlap on ISO strings (empty ranges never overlap). */
export function overlapsRange(a, b) {
  if (!a?.start || !a?.end || !b?.start || !b?.end) return false;
  return a.start <= b.end && b.start <= a.end;
}

function cellFor(dt) {
  return { iso: toISO(dt), day: dt.getUTCDate(), inMonth: false };
}

/**
 * Sunday-first month matrix (matches CalendarPage's getFirstDayOfMonth
 * convention): array of weeks, each 7 cells of { iso, day, inMonth }.
 * Leading/trailing cells belong to the neighbouring months.
 */
export function buildMonthMatrix(year, month) {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    cells.push(cellFor(new Date(Date.UTC(year, month - 1, -i)))); // leading (prev month)
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: `${year}-${pad2(month)}-${pad2(day)}`, day, inMonth: true });
  }
  let next = 1;
  while (cells.length % 7 !== 0) {
    cells.push(cellFor(new Date(Date.UTC(year, month, next++)))); // trailing (next month)
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Human day label (UTC-safe — no timezone drift on the calendar).
 * Locale pinned to 'en-US': the app UI is English and `undefined` resolves
 * to the HOST locale (e.g. fa-IR renders the Persian calendar year), which
 * made this nondeterministic across machines (unit test 2026-10-19).
 */
export function formatDayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}
