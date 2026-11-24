import { z } from 'zod';

// ── Vocabulary contract (spec §3) ──
// These lists MUST equal the leave_requests.status CHECK literals exactly:
// every decision value the API accepts has to pass the CHECK when written
// as `status`. scripts/testLeaveContract.js asserts both directions.
export const LEAVE_STATUSES = ['Pending', 'Approved', 'Denied'];
export const LEAVE_DECISIONS = ['Approved', 'Denied'];

/** True for a syntactically ISO date that also exists on the calendar. */
export function isRealCalendarDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const dateStr = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.')
  .refine(isRealCalendarDate, 'Date must be a real calendar date.');

const descriptionStr = z.string()
  .transform(v => (v ?? '').trim())
  .refine(v => v.length >= 10, 'Description must be at least 10 characters.')
  .refine(v => v.length <= 2000, 'Description must be at most 2000 characters.');

const idNum = () => z.union([z.string(), z.number()])
  .transform(v => Number(v))
  .refine(v => Number.isInteger(v) && v > 0, 'Must reference an existing record id.');

const dateOrderIssue = {
  message: 'end_date must be on or after start_date.',
  path: ['end_date'],
};

export const createLeaveSchema = z.object({
  start_date: dateStr,
  end_date: dateStr,
  description: descriptionStr,
}).refine(v => v.end_date >= v.start_date, dateOrderIssue);

export const onBehalfSchema = z.object({
  start_date: dateStr,
  end_date: dateStr,
  description: descriptionStr,
  user_id: idNum(),
}).refine(v => v.end_date >= v.start_date, dateOrderIssue);

export const decideSchema = z.object({
  decision: z.enum(LEAVE_DECISIONS, { errorMap: () => ({ message: "decision must be 'Approved' or 'Denied'." }) }),
  decision_note: z.string().max(500, 'Decision note must be at most 500 characters.').optional(),
});

export const coverageQuerySchema = z.object({
  from: dateStr,
  to: dateStr,
}).refine(v => v.from <= v.to, { message: 'from must be on or before to.', path: ['to'] });

export const pendingQuerySchema = z.object({
  view: z.enum(['pending', 'decided']).optional().default('pending'),
});
