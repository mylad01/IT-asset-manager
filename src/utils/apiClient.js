/**
 * Centralized API client.
 *
 * Every component should use this instead of raw `fetch()` so that:
 *   - Auth headers are attached automatically
 *   - 401 responses trigger a redirect to /login
 *   - 429 responses are retried with back-off
 *   - Responses have a consistent { ok, status, data, error } shape
 *
 * Usage:
 *   import api from '../utils/apiClient';
 *   const { ok, data } = await api.get('/api/assets');
 *   const { ok } = await api.post('/api/tickets', { title: '...' });
 */

import toast from 'react-hot-toast';
import { clearStoredAuth, getStoredToken } from './appStorage';
import { dispatchDiskStatus } from './diskEvents';
import { getApiBaseUrl } from './apiBase';

// ── Configuration ────────────────────────────────────────────────────
const BASE_URL = getApiBaseUrl();
const MAX_RETRIES = 3;
const MAX_429_BACKOFF_MS = 5000; // cap per-retry sleep (see 429 branch)
const REDIRECT_DELAY_MS = 800;

// ── Token helpers ────────────────────────────────────────────────────
// Single-source accessor (src/utils/appStorage.js) — the key literal lives
// there once. Works outside React components — no hook required.
function getToken() {
  return getStoredToken();
}

// ── Internal fetch wrapper ──────────────────────────────────────────
async function rawFetch(url, options = {}) {
  const {
    method = 'GET',
    body,
    headers: customHeaders = {},
    showToast = true,
    retries = MAX_RETRIES,
    _retryCount = 0,
  } = options;

  const token = getToken();
  const isFormData = body instanceof FormData;

  const headers = {
    ...customHeaders,
    ...(token && { Authorization: `Bearer ${token}` }),
    // Don't set Content-Type for FormData — the browser sets the boundary
    ...(!isFormData && body && { 'Content-Type': 'application/json' }),
  };

  try {
    const response = await fetch(`${BASE_URL}${url}`, {
      method,
      headers,
      body: isFormData ? body : body != null ? JSON.stringify(body) : undefined,
    });

    // ── 401 Unauthorized → redirect to login ────────────────────────
    // Exception: a failed login attempt itself returns 401 — show inline error, no redirect/toast.
    const isLoginRequest = url.includes('/auth/login');
    if (response.status === 401) {
      if (showToast && !isLoginRequest) {
        toast.error('Session expired. Please log in again.', {
          icon: '🔒',
          id: 'auth-error',
        });
      }
      if (!isLoginRequest) {
        // Clear stale auth state (single-source removal — both keys)
        clearStoredAuth();
        setTimeout(() => {
          window.location.href = '/login';
        }, REDIRECT_DELAY_MS);
      }
      return { ok: false, status: 401, data: null, error: 'Unauthorized' };
    }

    // ── 409 Setup Required → redirect to setup wizard ────────────────
    if (response.status === 409) {
      const data = await response.json().catch(() => ({}));
      if (data.error === 'in_setup') {
        // Clear stale auth state (single-source removal — both keys)
        clearStoredAuth();
        setTimeout(() => {
          window.location.href = '/setup';
        }, REDIRECT_DELAY_MS);
        return { ok: false, status: 409, data: null, error: 'Setup required' };
      }
    }

    // ── 429 Too Many Requests → retry with back-off ─────────────────
    // Skip retry for login — retries compound the rate-limit counter
    if (response.status === 429) {
      const isLogin = isLoginRequest;
      if (!isLogin && _retryCount < retries) {
        const retryAfter = parseInt(
          response.headers.get('Retry-After') || '2',
          10,
        );
        // Cap the back-off: the global/auth limiters answer with the time
        // left in their 15-MINUTE window (Retry-After up to 900s). Sleeping
        // the full value froze initAuth behind `loading` (blank screen) and
        // stalled page fetches for minutes during the 2026-10-03 rate-limit
        // storm — a capped retry stays a retry instead of a lock-out.
        const delay = Math.min(retryAfter * 1000 * (_retryCount + 1), MAX_429_BACKOFF_MS);
        await new Promise((r) => setTimeout(r, delay));
        return rawFetch(url, { ...options, _retryCount: _retryCount + 1 });
      }
      if (showToast) {
        const msg = isLogin
          ? 'Too many login attempts. Please wait a moment and try again.'
          : 'Server is busy. Please slow down.';
        toast.error(msg, { id: isLogin ? 'auth-rate-limit' : 'rate-limit' });
      }
      // express-rate-limit v8 + draft-7 sends RateLimit-Reset (epoch seconds)
      const resetHeader = response.headers.get('ratelimit-reset');
      const retryAfter = resetHeader
        ? Math.max(1, parseInt(resetHeader, 10) - Math.floor(Date.now() / 1000))
        : parseInt(response.headers.get('retry-after') || '60', 10);
      return { ok: false, status: 429, data: null, error: 'Rate limited', retryAfter };
    }

    // ── Parse body ──────────────────────────────────────────────────
    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    // ── Non-OK responses ────────────────────────────────────────────
    if (!response.ok) {
      // ── 503 Storage exhaustion → app-wide banner ────────────────────
      // diskSpaceGuard (DISK_CRITICAL) and the errorHandler's
      // SQLITE_FULL/ENOSPC mapping (DISK_FULL) land here. The shared
      // disk-status contract (utils/diskEvents.js) drives the sticky
      // DiskStatusBanner; the caller still gets a normal error result so
      // component-level handling keeps working.
      const diskCode = data?.code;
      if (response.status === 503 && (diskCode === 'DISK_CRITICAL' || diskCode === 'DISK_FULL')) {
        dispatchDiskStatus({
          kind: diskCode === 'DISK_FULL' ? 'full' : 'critical',
          retryAfter: parseInt(response.headers.get('retry-after') || '', 10) || undefined,
        });
        if (showToast) {
          toast.error(data?.error || 'Storage is full — the operation could not be completed.', {
            id: 'disk-status',
            duration: 5000,
          });
        }
        return {
          ok: false,
          status: 503,
          data: null,
          error: data?.error || 'Storage unavailable',
          code: diskCode,
        };
      }

      const errorMsg =
        data?.error || data?.message || `Request failed (${response.status})`;
      if (showToast) {
        if (data?.details && Array.isArray(data.details) && data.details.length > 0) {
          const fieldErrors = data.details.map(d => `• ${d.field}: ${d.message}`).join('\n');
          toast.error(`Validation failed\n${fieldErrors}`, {
            duration: 6000,
            id: 'validation-error',
            style: { whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.5' },
          });
        } else {
          toast.error(errorMsg);
        }
      }
      return { ok: false, status: response.status, data: null, error: errorMsg };
    }

    // ── Success ─────────────────────────────────────────────────────
    return { ok: true, status: response.status, data, error: null };
  } catch (err) {
    // Network / CORS / offline
    if (showToast) {
      toast.error('Network error. Please check your connection.', {
        id: 'network-error',
      });
    }
    return { ok: false, status: 0, data: null, error: err.message };
  }
}

// ── Public API ───────────────────────────────────────────────────────

const api = {
  /** GET request */
  get(url, opts) {
    return rawFetch(url, { ...opts, method: 'GET' });
  },

  /** POST request — body is auto-stringified unless it's FormData */
  post(url, body, opts) {
    return rawFetch(url, { ...opts, method: 'POST', body });
  },

  /** PUT request — body is auto-stringified unless it's FormData */
  put(url, body, opts) {
    return rawFetch(url, { ...opts, method: 'PUT', body });
  },

  /** DELETE request */
  delete(url, opts) {
    return rawFetch(url, { ...opts, method: 'DELETE' });
  },

  /**
   * Low-level escape hatch — passes raw options to fetch().
   * Prefer .get / .post / .put / .delete in most cases.
   */
  request(url, opts) {
    return rawFetch(url, opts);
  },
};

export default api;
