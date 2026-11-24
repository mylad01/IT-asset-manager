import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { loginAdmin } from '../lib/auth.js';
import { writeLatency, throttled, serverErrors, sqliteBusy } from '../lib/metrics.js';
import { seedKitsAndConsumables } from '../lib/fixtures.js';

export const options = {
  stages: [
    { duration: '5s', target: 10 },
    { duration: '15s', target: 50 },
    { duration: '10s', target: 100 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.05'],
  },
};

export function setup() {
  const token = loginAdmin();
  const { consumableIds } = seedKitsAndConsumables(token, 1, 5);
  // Use the first seeded consumable's ID for the stock-update hammer.
  const targetId = consumableIds.length > 0 ? consumableIds[0] : 1;
  return { token, targetId };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };
  const stockPayload = JSON.stringify({ amount: 1 });
  const stockRes = http.put(`${BASE_URL}/api/consumables/${data.targetId}/stock`, stockPayload, { headers });
  writeLatency.add(stockRes.timings.duration);
  if (stockRes.status === 429) throttled.add(1);
  if (stockRes.status >= 500) serverErrors.add(1);
  const body = stockRes.body || '';
  if (body.includes('SQLITE_BUSY') || body.includes('database is locked')) sqliteBusy.add(1);
  check(stockRes, {
    'Stock update 200 or 404': (r) => r.status === 200 || r.status === 404,
  });
  sleep(0.05);
}