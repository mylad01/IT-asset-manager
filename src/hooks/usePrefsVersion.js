/**
 * usePrefsVersion() — full live reactivity for pref-reading components.
 *
 * The prefs-changed ping (utils/prefEvents.js, fired by applyPreferences
 * after EVERY storage write) is the ONE fan-out; this hook turns it into a
 * React re-render. Consumers re-read the blob through readStoredPrefs() —
 * the ONE source — so no state is duplicated and no payload is trusted.
 *
 * Returns a monotonically increasing version number that bumps on every
 * prefs write. Use it as a render dependency:
 *
 *   const prefsVersion = usePrefsVersion();
 *   const style = useMemo(() => derive(prefsVersion), [prefsVersion]);
 *   // or gate a useEffect re-read on it
 *
 * Also subscribes to cross-tab `storage` events, so a prefs change made in
 * a second tab re-renders consumers here too (same re-read-the-blob rule).
 */
import { useEffect, useState, useCallback } from 'react';
import { PREFS_CHANGED_EVENT } from '../utils/prefEvents';
import { PREFS_STORAGE_KEY } from '../../shared/prePaintScript.js';

export default function usePrefsVersion() {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    // e.key === null → a clear() wiped everything; the named key is the
    // shared blob constant (single source — never restate the literal).
    const onStorage = (e) => {
      if (e.key === null || e.key === PREFS_STORAGE_KEY) bump();
    };
    window.addEventListener(PREFS_CHANGED_EVENT, bump);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PREFS_CHANGED_EVENT, bump);
      window.removeEventListener('storage', onStorage);
    };
  }, [bump]);

  return version;
}
