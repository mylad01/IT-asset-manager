import { useState, useCallback, useRef } from 'react';
import api from '../utils/apiClient';
import toast from 'react-hot-toast';
import { getApiBaseUrl } from '../utils/apiBase';

// Some callers still pass full URLs (e.g. 'http://localhost:3000/api/foo').
// apiClient prepends BASE_URL, so we must strip it to avoid double-prefixing.
const BASE = getApiBaseUrl();
const STRIP_PREFIXES = [BASE, 'http://localhost:3000'].filter(Boolean);
function stripBase(url) {
  if (typeof url !== 'string') return url;
  for (const prefix of STRIP_PREFIXES) {
    if (url.startsWith(prefix)) return url.slice(prefix.length);
  }
  return url;
}

/**
 * React hook that wraps the centralized apiClient with loading/error state.
 *
 * Public API (unchanged — existing components keep working):
 *   const { isLoading, fetchData, get, post, put, delete } = useApi();
 *   const result = await fetchData('/api/assets');
 *   // result => { success: boolean, data: any }
 *
 * isLoading is REF-COUNTED per hook instance: pages fire parallel requests
 * through one instance (Promise.all([fetchData(a), fetchData(b)])), and a
 * per-call boolean let the FIRST response flip loading off while its sibling
 * was still in flight — mounting tables with empty data (the 2026-10-12
 * mount-with-empty-data race). Loading now stays true until the LAST
 * in-flight call settles.
 */
export const useApi = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(0);

  const apiCall = useCallback(async (url, options = {}, config = {}) => {
    inFlightRef.current += 1;
    setIsLoading(true);
    setError(null);

    // Map the old useApi options shape to apiClient options.
    // Old callers pass: options = { method, body (already stringified), headers }
    // New apiClient expects: body as raw object (it stringifies), or FormData.
    const { method = 'GET', headers: customHeaders, body: rawBody } = options;

    // If body was already JSON-stringified by the caller (old pattern), parse it
    // back so apiClient can re-stringify it. FormData passes through unchanged.
    let body = rawBody;
    if (typeof body === 'string' && body.length > 0 && !(rawBody instanceof FormData)) {
      try { body = JSON.parse(body); } catch { /* keep as-is — caller may have a reason */ }
    }

    try {
      const result = await api.request(stripBase(url), {
        method,
        body,
        headers: customHeaders,
        showToast: config.showToast !== false, // default true
      });

      if (result.ok) {
        if (config.successMessage) {
          toast.success(config.successMessage);
        }
        return { success: true, data: result.data };
      }

      if (result.status === 401 || result.status === 403) {
        // apiClient already shows toast + clears localStorage.
        // useApi additionally calls the React-level logout and navigates.
        // We import useAuth lazily to avoid circular deps if needed.
        // For now, the apiClient handles the redirect via window.location.
      }

      if (result.status === 429) {
        return { success: false, data: [], rateLimited: true };
      }

      setError(result.error);
      return { success: false, data: result.data || [], error: result.error };
    } finally {
      // Ref-count: only the LAST parallel call may clear the loading flag.
      inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      if (inFlightRef.current === 0) setIsLoading(false);
    }
  }, []);

  return {
    isLoading,
    loading: isLoading,
    error,
    apiCall,
    fetchData: apiCall,
    apiFetch: apiCall,
    fetchTelemetry: apiCall,
    get: useCallback((url, config) => apiCall(url, { method: 'GET' }, config), [apiCall]),
    post: useCallback((url, body, config) => apiCall(url, { method: 'POST', body }, config), [apiCall]),
    put: useCallback((url, body, config) => apiCall(url, { method: 'PUT', body }, config), [apiCall]),
    delete: useCallback((url, config) => apiCall(url, { method: 'DELETE' }, config), [apiCall]),
  };
};
