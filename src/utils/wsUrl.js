/**
 * WebSocket URL derivation — the single source of truth for every WS client.
 *
 * Mirrors the API base logic in `apiClient.js`:
 *   - VITE_API_BASE_URL set to an absolute URL → http→ws / https→wss
 *   - Empty or unset in dev → same origin as the page (Vite proxy forwards /ws)
 *   - Empty in production → same origin as the deployed frontend
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export function getWebSocketUrl(path = '/ws') {
  if (/^https?:/i.test(API_BASE)) {
    const wsBase = API_BASE.replace(/^http/i, 'ws').replace(/\/+$/, '');
    return `${wsBase}${path}`;
  }
  const originBase = window.location.origin.replace(/^http/i, 'ws');
  return `${originBase}${path}`;
}
