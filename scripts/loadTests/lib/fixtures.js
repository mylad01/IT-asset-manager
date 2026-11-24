// Fixture IDs. These are deterministic so the load harness can hammer the
// same rows worst-case-style, exercising SQLite write serialization.
//
// The seeded test DB is created by running `npm run test:server` once, which
// triggers server/db/seed.js. That script inserts the root admin and the
// default departments/asset_types. It does NOT create kits or consumables —
// the write-heavy scenario seeds those itself via setup() so we don't depend
// on the dev seed for these specific rows.

import http from 'k6/http';
import { check } from 'k6';
import { bearer } from './auth.js';
import { BASE_URL } from './config.js';

// Seed N kits and M consumables if they don't already exist. Returns the
// arrays of IDs so the scenario can mutate them.
export function seedKitsAndConsumables(adminToken, kitCount = 1, consumableCount = 5) {
  const headers = bearer(adminToken).headers;

  // Discover a valid asset_type_id and dept_id from the seeded DB.
  const typesRes = http.get(`${BASE_URL}/api/asset-types`, { headers });
  const deptsRes = http.get(`${BASE_URL}/api/departments`, { headers });
  if (
    !check(typesRes, { 'asset-types list ok': (r) => r.status === 200 }) ||
    !check(deptsRes, { 'departments list ok': (r) => r.status === 200 })
  ) {
    throw new Error('Could not list seed reference data for kit/consumable setup.');
  }

  const types = typesRes.json();
  const depts = deptsRes.json();
  if (!Array.isArray(types) || types.length === 0) {
    throw new Error('No asset_types in test DB — seed did not run.');
  }
  if (!Array.isArray(depts) || depts.length === 0) {
    throw new Error('No departments in test DB — seed did not run.');
  }

  const assetTypeId = types[0].id;
  const deptId = depts[0].id;

  const kitIds = [];
  for (let i = 0; i < kitCount; i += 1) {
    const res = http.post(
      `${BASE_URL}/api/kits`,
      JSON.stringify({
        name: `loadtest-kit-${i}`,
        description: 'created by k6 write-heavy setup',
        items: [{ asset_type: 'Workstation', quantity: 1 }],
      }),
      { headers },
    );
    if (res.status === 200 || res.status === 201) {
      const kitId = res.json().id;
      if (!kitId) {
        throw new Error(`POST /api/kits returned no id (status ${res.status}) — update fixtures.js to match the API response shape.`);
      }
      kitIds.push(kitId);
    }
  }

  const consumableIds = [];
  for (let i = 0; i < consumableCount; i += 1) {
    const res = http.post(
      `${BASE_URL}/api/consumables`,
      JSON.stringify({
        name: `loadtest-consumable-${i}`,
        description: 'created by k6 write-heavy setup',
        quantity: 10000,
        threshold: 5,
      }),
      { headers },
    );
    if (res.status === 200 || res.status === 201) {
      const id = res.json().id;
      if (!id) {
        throw new Error(`POST /api/consumables returned no id (status ${res.status}) — update fixtures.js to match the API response shape.`);
      }
      consumableIds.push(id);
    }
  }

  // Discover a valid user_id for kit deploy payloads.
  const usersRes = http.get(`${BASE_URL}/api/users`, { headers });
  const users = usersRes.json();
  const userId = Array.isArray(users) && users.length > 0 ? users[0].id : null;

  return { kitIds, consumableIds, userId, deptId, assetTypeId };
}
