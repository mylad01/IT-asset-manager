// Environment configuration for k6 tests
const ENV = {
  // Base URL for the API
  BASE_URL: 'http://localhost:3000/api',

  // Default admin credentials for testing
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'adminpassword',

  // Default user credentials for testing
  USER_EMAIL: 'user@example.com',
  USER_PASSWORD: 'userpassword',

  // Test environment
  ENVIRONMENT: 'testing',

  // Rate limiting thresholds
  RATE_LIMITS: {
    AUTH: { max: 5, window: '15m' },
    PASSWORD: { max: 3, window: '15m' },
    WRITE: { max: 30, window: '15m' },
    GLOBAL: { max: 100, window: '15m' },
  },

  // Performance thresholds
  THRESHOLDS: {
    P95_RESPONSE_TIME: 500, // ms
    P99_RESPONSE_TIME: 800, // ms
    MAX_ERROR_RATE: 0.01,   // 1%
    MIN_CHECK_RATE: 0.99,   // 99%
  },
};

// Export configuration
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ENV;
}

export default ENV;
