// Authentication helper functions for k6 tests
import http from 'k6/http';
import { check } from 'k6';
import ENV from '../config/env.js';

/**
 * Login and return authentication token
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {string|null} - JWT token or null if failed
 */
export function login(email, password) {
  const response = http.post(
    `${ENV.BASE_URL}/auth/login`,
    JSON.stringify({ email, password }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const result = check(response, {
    'Login successful': (r) => r.status === 200,
    'Has token': (r) => r.json() && r.json().token,
  });

  if (!result) {
    console.error(`Login failed: ${response.status} - ${response.body}`);
    return null;
  }

  return response.json().token;
}

/**
 * Get admin authentication token
 * @returns {string} - JWT token
 */
export function getAdminToken() {
  return login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
}

/**
 * Get regular user authentication token
 * @returns {string} - JWT token
 */
export function getUserToken() {
  return login(ENV.USER_EMAIL, ENV.USER_PASSWORD);
}

/**
 * Create authorization header
 * @param {string} token - JWT token
 * @returns {Object} - Headers object
 */
export function authHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Refresh token (if needed)
 * @param {string} token - Current JWT token
 * @returns {string|null} - New JWT token or null
 */
export function refreshToken(token) {
  // In a real implementation, this would call a refresh endpoint
  // For now, just return the same token
  return token;
}

// Export for CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    login,
    getAdminToken,
    getUserToken,
    authHeaders,
    refreshToken,
  };
}
