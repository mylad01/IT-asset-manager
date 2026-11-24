// Custom k6 metrics. Defined once here so every scenario tags them
// consistently and we can graph them together.

import { Trend, Rate, Counter } from 'k6/metrics';

// Latency for read endpoints (separate from http_req_duration so we can
// dashboard reads vs writes independently).
export const readLatency = new Trend('read_latency', true);

// Latency for write endpoints.
export const writeLatency = new Trend('write_latency', true);

// Counter of 429 responses we observed across the run.
export const throttled = new Counter('throttled_429_total');

// Rate of 5xx responses (server-side errors). This is the SLA gate.
export const serverErrors = new Rate('server_errors');

// Counter of payloads that mention SQLITE_BUSY — surfacing whether WAL
// serialization is keeping up.
export const sqliteBusy = new Counter('sqlite_busy_total');
