import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { loginAdmin } from '../lib/auth.js';
import { readLatency, throttled, serverErrors } from '../lib/metrics.js';

export const options = {
  stages: [
    { duration: '5s', target: 20 },
    { duration: '15s', target: 100 },
    { duration: '10s', target: 200 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300', 'p(99)<600'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const token = loginAdmin();
  return { token };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` };
  const statsRes = http.get(`${BASE_URL}/api/dashboard/stats`, { headers });
  readLatency.add(statsRes.timings.duration);
  if (statsRes.status === 429) throttled.add(1);
  if (statsRes.status >= 500) serverErrors.add(1);
  check(statsRes, {
    'Dashboard stats 200': (r) => r.status === 200,
    'Dashboard response time < 300ms': (r) => r.timings.duration < 300,
  });
  const notifRes = http.get(`${BASE_URL}/api/notifications`, { headers });
  readLatency.add(notifRes.timings.duration);
  if (notifRes.status === 429) throttled.add(1);
  if (notifRes.status >= 500) serverErrors.add(1);
  check(notifRes, {
    'Notifications 200': (r) => r.status === 200,
  });
  sleep(0.1);
}