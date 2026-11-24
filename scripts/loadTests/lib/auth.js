import http from 'k6/http';
import { BASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD } from './config.js';

export function loginAdmin() {
  const payload = JSON.stringify({ email: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  const params = { headers: { 'Content-Type': 'application/json' } };
  const res = http.post(`${BASE_URL}/api/auth/login`, payload, params);
  if (res.status === 200) {
    const json = res.json();
    return json.token || '';
  }
  return '';
}

export function bearer(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}