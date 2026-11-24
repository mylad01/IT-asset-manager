/**
 * Single-source accessors for the auth storage keys (studioUser /
 * studioToken). AuthContext OWNS every write — login/logout/setup flows go
 * through its login()/logout() actions; these helpers exist so non-context
 * code (API client, WebSocket + upload components) reads the SAME keys
 * without hand-rolling JSON.parse or restating the key strings. The key
 * literals appear exactly once in src/ (here) — the prefs sync test holds
 * that line, the same way the retired studioTheme key is held.
 */

export const AUTH_USER_KEY = 'studioUser';
export const AUTH_TOKEN_KEY = 'studioToken';

/** Parsed user object (or the fallback) — never throws on corrupt JSON. */
export function getStoredUser(fallback = null) {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Raw JWT string or null — never throws. */
export function getStoredToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Canonical write — AuthContext (and only AuthContext) calls this. */
export function setStoredUser(user) {
  try { localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user)); } catch { /* private mode / quota */ }
}

/** Canonical write — AuthContext (and only AuthContext) calls this. */
export function setStoredToken(token) {
  try { localStorage.setItem(AUTH_TOKEN_KEY, token); } catch { /* private mode / quota */ }
}

/** Remove BOTH keys together — they are always written as a pair. */
export function clearStoredAuth() {
  try {
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch { /* private mode / quota */ }
}
