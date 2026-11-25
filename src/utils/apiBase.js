/**
 * Single source of truth for resolving the API origin across:
 * - Local Vite dev (`:5174` proxies `/api`, `/uploads`, `/ws` to `:3000`)
 * - Single-port production / Codespaces (Express serves `dist/` alongside `/api`)
 * - Explicit cross-origin deployments (`VITE_API_BASE_URL` set at build time)
 */
const rawEnv = import.meta.env.VITE_API_BASE_URL;

export function getApiBaseUrl() {
  if (rawEnv !== undefined && rawEnv !== '') {
    return rawEnv.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    if (port === '4173' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
      return 'http://localhost:3000';
    }
  }
  return '';
}
