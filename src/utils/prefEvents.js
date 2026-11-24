/**
 * Single-source live-update fan-out for registry preferences (PLAN.MD §13).
 * The storage write is applyPreferences' job; this event is ONLY the
 * "prefs changed right now, re-read them" signal for components that hold
 * prefs in refs outside React state (NotificationToasts' bannersEnabledRef).
 *
 * The ping carries NO payload by design: listeners re-read the blob through
 * readStoredPrefs(), so there is no producer/consumer detail shape to drift.
 * The per-pref hand-rolled CustomEvents this replaces were a dual-write
 * path — each producer restated its own payload, and the brand-defaults
 * path skipped the event entirely, so banner state could flip without
 * NotificationToasts noticing.
 */

export const PREFS_CHANGED_EVENT = 'prefs-changed';

/** Fire once per storage write (applyPreference / applyPreferences). */
export function dispatchPrefEvent() {
  try {
    window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT));
  } catch { /* non-browser context — nothing to fan out to */ }
}
