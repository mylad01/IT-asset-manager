import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { throttled } from '../lib/metrics.js';

// Bug #5 (PLAN.MD): `npm run test:server` boots with LOAD_TEST_MODE=1, which
// disables rate limiters by design — a bare 429 assertion can never pass there
// and reported 50% failed checks. Set RATE_LIMITS_ON=1 only when running this
// scenario against a server with rate limiters enabled; the default one-command
// run (`npm run load:auth`) just asserts 401/429 acceptance.
const RATE_LIMITS_ON = __ENV.RATE_LIMITS_ON === '1';

export const options = {
  vus: 20,
  duration: '10s',
  thresholds: {
    http_req_failed: ['rate>0.5'],
  },
};

export default function () {
  const payload = JSON.stringify({ email: 'fake_user@studio.com', password: 'wrong_password_123' });
  const params = { headers: { 'Content-Type': 'application/json' } };
  const res = http.post(`${BASE_URL}/api/auth/login`, payload, params);
  if (res.status === 429) throttled.add(1);
  const checks = {
    'Status is 401 or 429': (r) => r.status === 401 || r.status === 429,
  };
  if (RATE_LIMITS_ON) checks['Rate limit active (429)'] = (r) => r.status === 429;
  check(res, checks);
  sleep(0.05);
}
