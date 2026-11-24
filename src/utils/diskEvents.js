/**
 * Single-source contract for the disk-status event (PLAN.MD §13 audit).
 *
 * Producer: utils/apiClient — on a 503 with code DISK_CRITICAL/DISK_FULL.
 * Consumer: components/DiskStatusBanner.
 *
 * The event NEEDS a payload (unlike the payload-free prefs-changed ping):
 * kind/retryAfter are per-incident inputs the consumer cannot re-read from
 * storage — there is no "disk status blob" to re-read. So instead of a
 * payload-free ping, the CONTRACT is declared here exactly once: event
 * name, dispatch helper, payload shape. The banner owns the display
 * policy (escalation: 'full' beats 'critical', never de-escalates;
 * event notices override a dismissal, the health poll honors it).
 *
 * Payload (all fields optional except kind):
 *   kind      'critical' | 'full'
 *   retryAfter  seconds (from the 503's Retry-After header)
 *   freeBytes   server-reported free disk bytes, when known
 */

export const DISK_STATUS_EVENT = 'disk-status';

export function dispatchDiskStatus(detail) {
  try {
    window.dispatchEvent(new CustomEvent(DISK_STATUS_EVENT, { detail }));
  } catch { /* non-browser context — nothing to fan out to */ }
}
