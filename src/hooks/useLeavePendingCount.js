import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/apiClient';

/**
 * Pending leave-request count for the actor's approval inbox.
 *
 * Polls GET /api/leave-requests/pending-count every 15s (same cadence as
 * useNotifications) and surfaces the number for the sidebar badge. The
 * backend already returns 0 for non-approvers (fail-closed), so this hook
 * is safe to mount for every role — it simply reports what the API says.
 */
export default function useLeavePendingCount() {
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const pollRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchCount = useCallback(async () => {
    const { ok, data } = await api.get('/api/leave-requests/pending-count', { showToast: false });
    if (ok && data && typeof data.count === 'number') {
      setCount(data.count);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Initial load ONLY: the poll below must not flip the badge back into its
    // spinner state every 15s (the old code never cleared isLoading at all, so
    // the pill spun forever). Guarded so a StrictMode-remounted first load
    // cannot leave a stale spinner behind.
    const load = async () => {
      setIsLoading(true);
      try {
        await fetchCount();
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    };
    load();

    pollRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      fetchCount();
    }, 15000);

    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchCount]);

  return { count, isLoading };
}
