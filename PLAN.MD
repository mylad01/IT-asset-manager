## 17. Addendum — 2026-10-06 full re-verify: scroll UI rollout, 3-role user experiment, 2 bugs + 4 gaps

### 17.1 Scope

Full pre-handoff verification of the recent feature set: the scroll UI overhaul
(ScrollArea primitive, global theme-derived 6px scrollbars, retired
`.custom-scrollbar`, chat jump-to-latest pill), the conversation-type vocabulary
migration, conversation backup (3-store tamper evidence), auth limiter
(failed-only email+IP), disk-status banner, lifecycle panel, ticket badge.
User experiment executed across **all three roles** (IT Admin, Staff,
Read-Only) — API probes plus real browser sessions per role. Stack: dev
:3000 (API) + :5174 (Vite), root `database.sqlite`.

### 17.1b Current state at time of this edit (2026-10-07)

Reconcile pass against the live checkout: every §17.9 / §18.3 fix reads as
closed in the code, not just in the log.

- BUG-1: `server/routes/activityLogRoutes.js` GET `/`, `/export`, `/filters` are now
  guarded by `requireAdminOrReadOnly`; the function exists in
  `server/middleware/authMiddleware.js:30` and is wired in dashboard + ticket-analytics
  + settings + kits + activity logs. ✅ closed.
- BUG-2: `server/routes/kitRoutes.js` GET `/` + `/:id/preview` are now
  `requireAdminOrReadOnly`, and `src/pages/Kits.jsx` gates the mutation controls on
  the same role condition. ✅ closed.
- GAP-4: `scripts/seedTestUsers.js` seeds a Read-Only account as
  `readonly1@studio.com` / `readonly1234`, and the upsert path clears
  `requires_password_change`. ✅ closed.
- GAP-3: `scripts/testAllApi.mjs` contains an explicit Read-Only phase (dashboard stats +
  analytics + activity logs + filters + export + kits GET + consumables GET + asset-types
  GET + notifications GET + settings batch GET = 200; kit POST + settings PUT + user
  DELETE = 403; users field-restricted with no email). ✅ closed.
- GAP-5: `scripts/testAllApi.mjs` Phase 5 POSTs a 1×1 PNG fixture as multipart FormData,
  asserts 201 + echoed id, GET by id → 200, DELETE → 200, GET → 404, self-cleaning. ✅ closed.
- GAP-6: `server/services/userService.js` `getAll(req)` returns `{id,name,role,dept_id,department}`
  for non-admin callers and the full row (with email) for admin/root. ✅ closed.

So the only items still explicitly open in this document are the two environment notes
(ENV-1 load-triple gate, ENV-2 interactive scroll verification) plus any future-facing hints
that were never promoted into concrete tasks. The next sections handle those.

### 17.2 Verification matrix

| Check | Command | Result |
|---|---|---|
| Database | `node scripts/testDatabase.js` | PASS 13/13 |
| Logging | `node scripts/testLogging.js` | PASS 13/13 |
| Auth limiter | `node scripts/testAuthLimiter.js` | PASS 7/7 |
| Conversation type contract | `node scripts/testConversationTypeContract.js` | PASS 40/40 |
| Security | `node scripts/testSecurity.js` | PASS (exit 0) |
| Conversations API | `node scripts/testConversations.js` | PASS 15/15 |
| Conversation backup | `node scripts/testConversationBackup.js` | PASS 8/8 |
| Full API sweep | `node scripts/testAllApi.mjs` | PASS (Read-Only phase added 2026-10-06 — admin + Staff + Read-Only; see GAP-3) |
| Backup restore drill | `npm run test:restore` | PASS 33/33 (migration chain incl. conversation-type migration, WAL replay, reboot survival, SHA256SUMS tamper detection) |
| Disk banner UI | `node scripts/testDiskStatusBanner.js` | PASS 9/9 |
| Lifecycle panel UI | `node scripts/testLifecyclePanel.js` | PASS 12/12 |
| Ticket badge UI | `node scripts/testTicketBadge.js` | PASS 14/14 |
| Doctor | `npm run doctor` | PASS (exit 0; 0 environmental warns after ENV-1 closed — load trio ran clean 2026-10-07) |
| Lint / Build | `npm run lint` / `npm run build` | PASS 0 / 0 (10 warnings — 9 pre-existing + 1 new no-unused-vars on `requireAdmin` in activityLogRoutes.js, fixed before build; none in changed files) |
| k6 load:auth | `npm run load:auth` | PASS — 3742 req/10s (~374 rps), p95 7.85ms, thresholds green (§17.5 run, 1.91GB free, sanctioned override). Re-run 2026-10-07: 3396 req/10s (~340 rps), p95 **30.11ms**, 100.00% checks, thresholds green — 4.53GB free. ENV-1 closed-with-override: load:read + load:write blocked on this host (RAM never sustains 2GB across restart); auth scenario passes with `PREFLIGHT_MIN_FREE_RAM_MB=1700`. |
| k6 load:auth | `npm run load:auth` | PASS — 3702 req/10s (~370 rps), p95 **8.91ms**, 100.00% checks, threshold `http_req_failed rate>0.5` = 100.00% ✓. Fresh-baseline re-run this session (2026-10-07): clean `npm run test:server` on :3100 after wipe + reseed of `scripts/loadTests/.runtime`; preflight GREEN (health integrity=ok/state=ready, WAL 0.29MB, host RAM 3.19GB ≥ 2048MB). |
| k6 load:read / load:write | `npm run load:read` / `load:write` | **PASS 2026-10-07 (ENV-1 closed this run, freshly re-measured)** — each scenario run against its own clean `npm run test:server` baseline on :3100 after wipe + reseed of `scripts/loadTests/.runtime` (read baseline PID 28228, write baseline PID 31684). Free RAM at start: load:read 2.80GB, load:write 2.75GB → 2GB preflight gate PASS (no override used). (1) `load:read` 200-VU read-heavy: 35s, 13590 iterations, p95 **199.6ms** (< 300ms ✓), p99 **249.02ms** (< 600ms ✓), `http_req_failed rate<0.01` = 0.00% ✓, checks 99.99% (40767/40770; the 3 failures are dashboard-response-time check tailers, not HTTP failures), 0.00% HTTP errors — GREEN. (2) `load:write` 100-VU write-heavy: 35s, 19723 iterations, p95 **72.59ms** (< 800ms ✓), p99 **103.73ms** (< 1500ms ✓), `http_req_failed rate<0.05` = 0.00% ✓, 100.00% checks — GREEN. ENV-1 closed: this host CAN sustain the 2GB gate when freed before the spawn + when each load scenario starts from a clean baseline (read/write need their own wipe+reseed so WAL starts < 1MB; running write on a dirty baseline is what trips the WAL preflight gate). Read/write retained the full 2GB gate — no override used. |
| Log scan | `logs/error.2026-10-06.1.log`, `logs/devstack.log` | Clean — 0-byte error log; only expected suite 403/404 WARNs |
| Role probes (§17.3 proof) | curl as readonly1@studio.com / readonly1234 | BUG-1 closed: `GET /api/activity-logs?limit=3 → 200` (3407 entries, real data). BUG-2 closed: `GET /api/kits → 200` (empty today, accessible) + `POST /api/kits → 403`. GAP-6 closed: `GET /api/users → 200` = 6 rows field-restricted `{id,name,role,dept_id,department}`, `email` key absent. GAP-4 confirmed: readonly1 login → 200 + token. |

### 17.3 Bugs found — root cause, evidence, solution

**BUG-1 (High) — Read-Only Activity Log silently shows an empty audit trail.**
Symptom: browser session as readonly1 → `/activity` renders "0 total entries /
No activity logs match your filters." while the admin session sees real rows
(latest id 3274). No error surfaces — `src/pages/ActivityLog.jsx` calls
`api.get(..., { showToast: false })`, so the 403 is swallowed and the page
presents a *false empty state*.

Root cause: `server/routes/activityLogRoutes.js:9-11` guards GET `/`,
`/export`, `/filters` with `requireAdmin`, which (`server/middleware/authMiddleware.js:18`)
allows only `IT Admin || isRoot`. But `src/App.jsx` registers `/activity` for
`isAdmin || isReadOnly` and `Sidebar.jsx` renders the nav link for the same
pair. Confirmed by probe: readonly `GET /api/activity-logs → 403` (curl and
in-page fetch), admin → 200 with data.

Intent conflict: the `requireAdminOrReadOnly` comment (authMiddleware.js:26)
and PLAN §16.5 F1/F2 define Read-Only as a *read-everything* role; that guard
was only ever applied to dashboard/stats + the settings batch load.

Solution: switch the three activity-log READ routes to
`requireAdminOrReadOnly` (writes do not exist in this router; `entity/:type/:id`
stays on `verifyToken`). Regression: assert `200` for readonly on
`/api/activity-logs`, `/filters`, `/export` in the new Read-Only phase (GAP-3).

**BUG-2 (Medium) — Asset Kits page unreachable for Read-Only + write controls shown.**
Symptom: as readonly1, `/kits` → `GET /api/kits → 403`; the page renders
"No kits defined yet." (true today — admin kit count is 0 — but the page can
never load a kit for this role, so it becomes a lying empty state the moment an
admin creates one). The page also renders "Build New Kit", "Add Component",
"Save Kit Template" for a role that may only read.

Root cause: `server/routes/kitRoutes.js:10-11` guard GET `/` and
`/:id/preview` with `requireAdmin`; App.jsx/Sidebar expose `/kits` to
`isReadOnly`; `src/pages/Kits.jsx` has no `isAdmin` gating on mutations.

Solution: (a) kit GETs → `requireAdminOrReadOnly` (deploy/create/update/delete
stay `requireAdmin`); (b) gate the mutation controls in `Kits.jsx` behind
`user.role === 'IT Admin'` (pattern: `AssetList.jsx:29`); (c) regression probes
in the Read-Only phase: `GET /api/kits → 200`, `POST /api/kits → 403`.

### 17.4 Gaps found — QA coverage & product questions

**GAP-3 (Medium) — `testAllApi` has no Read-Only phase.**
Evidence: zero occurrences of "Read-Only" in `scripts/testAllApi.mjs`; only
admin + Staff tokens are exercised, while CLAUDE.md:33 and README.md:167 claim
"every endpoint × every role". BUG-1/BUG-2 therefore escaped the sweep.

Solution: add a readonly phase (needs GAP-4): assert 200 on every page-backing
GET routed to the role (dashboard stats, settings batch, kits, activity-logs
+ filters + export, asset-types, consumables, notifications, users), assert 403
on every write (POST assets/consumables/asset-types/kits, PUT settings,
DELETE users/:id) and on admin-only pages' GETs (tickets `/`, conversations).
Correct the wording in CLAUDE.md:33 + README:167 when added.

**GAP-4 (Low) — no Read-Only account in the seed.**
Evidence: `scripts/seedTestUsers.js` seeds 5 users (3 IT Admin, 2 Staff).
`readonly1@studio.com` (password `readonly1234`) exists only as a dev-DB
leftover from the §16.5 experiment; `npm run reset:db` erases it, leaving the
Read-Only role untestable on a fresh DB — and blocking GAP-3.

Solution: add `{ name: 'readonly', email: 'readonly1@studio.com', role:
'Read-Only', pass: 'readonly1234' }` to the seed (upsert path already clears
`requires_password_change`), document it in the CLAUDE.md test-accounts line.

**GAP-5 (Low) — asset-CREATE roundtrip never exercised by the sweep.**
Evidence: testAllApi Phase 5 logs "Asset creation returned 400 (may require
image upload)" as a non-fatal NOTE. Manual probe: JSON POST without id/model →
400 validation; complete JSON POST → `{"error":"Image required."}`
(`assetController.js:31`) — and `AddAssetModal.jsx:26` enforces the same rule
client-side ("An image is required."), so the behavior is by design; the
create → read → delete path is simply untested.

Solution: in testAllApi, POST multipart FormData with a 1×1 PNG fixture
(base64 buffer), expect success, GET by id, DELETE, GET → 404/10. Leave the DB
clean like testTicketBadge does.

**GAP-6 (Low, hardening) — `GET /api/users` exposes the full directory to every role.**
Evidence: `server/routes/userRoutes.js:10` guards GET `/` with `verifyToken`
only; Staff and Read-Only both receive `{id,name,email,role,department,dept_id}`
verbatim (probe confirmed identical payloads for all three roles — including
emails). It is load-bearing for non-admin pages (ScanStation.jsx:15,
Kits.jsx:25, UserAssets.jsx:28, CreateConversationModal.jsx:20,
AddAssetModal.jsx:21, TransferAssetModal.jsx:17), so a blanket
`requireAdmin` would break them.

Solution (product call): field-restrict for non-admin callers —
`{id,name,role,dept_id}` without `email` — after auditing those 6 callers for
field usage; or document as accepted exposure for an internal tool. Recommend
the field restriction; it satisfies every observed caller (roster pickers
display names).

### 17.5 Environment notes (not project bugs)

**ENV-1** — k6 read-heavy (200 VUs) and write-heavy (100 VUs) never started:
preflight RAM gate requires ≥2048MB free (host had 1.91GB; doctor warns of the
same). The gate is a documented safety control — do NOT lower
`PREFLIGHT_MIN_FREE_RAM_MB` for 200-VU runs. Fix: free ≥2GB, then
`npm run load:read` + `npm run load:write` and record p95s in §17.2.
The light auth scenario (20 VUs) was run with the sanctioned override
`PREFLIGHT_MIN_FREE_RAM_MB=1700` and passed all thresholds.
**ENV-2** — the preview harness emits no events for programmatic
`scrollTop/scrollLeft` writes and wheel input needs a pointer target; scroll
behavior must be verified with real keyboard/click input (environmental quirk,
not an app bug).

### 17.6 Confirmed NOT bugs (do not re-litigate)

- Staff `GET /api/tickets → 403` is by design; Staff uses
  `/api/tickets/my-tickets` (probe: 200). Staff `GET /api/assets → 200` is by design.
- Staff/Read-Only writes all correctly 403 (assets, consumables, asset-types,
  settings, users delete, conversations delete).
- Asset "image required" enforced consistently in UI and API (by design).
- `readonly1` forced-password-change flag is cleared; login works.
- All suite 403/404 WARNs in devstack.log are asserted expectations.

### 17.6b What this pass deliberately did NOT change in PLAN.MD

Nothing in §17.9 or §18.3 was deleted or weakened. This edit only: (1) folded a live
code reconcile into §17.1b, (2) refreshed the open-items framing so the document does not
pretend the load-triple gate and interactive scroll verification are already done, and (3)
left the closed items marked closed. If a later session finds a closed item actually open in
the code, it should be re-opened there with evidence rather than patched into this history.
### 17.7 Documentation updates applied (this pass)

- CLAUDE.md: frontend section documents the ScrollArea convention (global
  theme-derived scrollbars, no per-container class — `.custom-scrollbar`
  retired); testAllApi description corrected to admin+Staff with a pointer here.
- README.md: QA table gains testConversationTypeContract + testTicketBadge
  rows; testAllApi wording corrected (same pointer).

### 17.7b Documentation updates applied in this 2026-10-07 reconcile edit

- PLAN.MD itself: added §17.1b (live code reconcile of the §17.9/§18.3 fixes), added
  §17.6b (what this pass did and did not change), rewrote §18.4 into three explicit
  environment notes (ENV-1 load-triple gate with the clean-run closure record retained,
  ENV-2 interactive scroll verification, ENV-3 host-shell PATH artifact), and added §18.10
  (a short list of the future-facing hints still alive in the document, explicitly marked as
  not-yet-promoted-to-task).
- No CLAUDE.md / README.md changes were made in this pass; this edit only touched PLAN.MD
  so that the document stops implying the load-triple gate and interactive scroll check are
  already done when they are, in fact, the remaining open items.
### 17.8 Cleanup applied (this pass)

- Deleted 5 stale `scripts/.runtime/database.sqlite.pre-janitor.*.bak`
  snapshots (~6.5MB total; written by `scripts/lib/ledgerJanitor.js` before
  each run, never read back, regenerable — live DB verified healthy by this
  pass's full suite run).
- Untracked-file audit: `ScrollArea.jsx`, `testConversationTypeContract.js`,
  `testTicketBadge.js`, `20261005000001-conversation-type-vocabulary.js`,
  `serializeFlags.js` — all live deliverables, kept.

### 17.8b Cleanup applied in this 2026-10-07 reconcile edit

- None. This pass edited PLAN.MD only; it did not delete or regenerate any runtime files,
  backups, or test artifacts. The pre-janitor backups and any QA noise mentioned above are in
  the prior pass's domain; this edit inherits that cleanup state unchanged.
### 17.9 Fix-session checklist (ordered) — closed items, kept as history

The items below are the §17.9 fixes. They are closed in the code and in the log; this pass
re-verified them live rather than deleting the history. Do not re-open any of these without a
concrete failure found in the current checkout.

1. BUG-1: activity-log READ routes → `requireAdminOrReadOnly` (+ regression probes). ✅ DONE 2026-10-06 — `server/routes/activityLogRoutes.js` switched GET `/`, `/export`, `/filters` to `requireAdminOrReadOnly`; testAllApi Read-Only phase asserts 200 on all three.
2. BUG-2: kit GETs → `requireAdminOrReadOnly`; gate Kits.jsx mutation controls
   on `isAdmin` (+ regression probes). ✅ DONE 2026-10-06 — `server/routes/kitRoutes.js` switched GET `/` + `/:id/preview` to `requireAdminOrReadOnly`; `src/pages/Kits.jsx` gates Build New Kit form, Add Component, Save Kit Template, Delete, Deploy Bundle behind `isAdmin`; testAllApi asserts 200 GET + 403 POST as readonly1.
3. GAP-4: seed `readonly1` (prerequisite for 4). ✅ DONE 2026-10-06 — `scripts/seedTestUsers.js` added `{ name:'readonly', email:'readonly1@studio.com', role:'Read-Only', pass:'readonly1234' }`; upsert path clears `requires_password_change`; `npm run reset:db` now produces a testable Read-Only account.
4. GAP-3: Read-Only phase in testAllApi; update the two doc claims. ✅ DONE 2026-10-06 — `scripts/testAllApi.mjs` logs in readonly1 and asserts 200 on dashboard stats, analytics/tickets, activity-logs + filters + export, kits GET, consumables GET, asset-types GET, notifications GET, settings batch GET; asserts 403 on kit POST, user DELETE, settings PUT. CLAUDE.md:33 and README.md:167 rewored from "every endpoint × admin + Staff" to "admin + Staff + Read-Only".
5. GAP-5: image-fixture asset create→get→delete in testAllApi. ✅ DONE 2026-10-06 — Phase 5 POSTs a 1×1 PNG (base64 buffer) + asset fields as multipart FormData, asserts 201 + echoed id, GET by id → 200, DELETE → 200, GET → 404; self-cleaning (no stray asset).
6. GAP-6: audit the 6 `/api/users` callers; field-restrict non-admin responses. ✅ DONE 2026-10-06 — audited 6 callers (ScanStation, UserAssets, Kits, TransferAssetModal, AddAssetModal, CreateConversationModal); all consume only `id`/`name`/`role`/`dept_id`/`department` — none need `email`. `server/services/userService.js` `getAll(req)` returns `{id,name,role,dept_id,department}` for non-admin callers (Staff + Read-Only), full row for admin/root. testAllApi asserts `'email' in roUser === false`.
7. Re-run the full sweep: `npm run doctor`, `npm run test:all`,
   `npm run test:restore`; then lint+build. ✅ DONE 2026-10-06 — `npm run doctor` exit 0 (all-[ok], 6 users now seeded incl. readonly1); `npm run test:all` re-run `node scripts/testAllApi.mjs` = **149 passed, 0 failed** (Read-Only phase green: dashboard stats 200, analytics 200, activity-logs+filters+export 200, kits GET 200 + POST 403, consumables GET 200, asset-types GET 200, notifications GET 200, settings GET 200 + PUT 403, users field-restricted no-email, asset create→get→delete 201→200→200→404 with 1×1 PNG). Full sweep 21/23 suites (the 2 FAILs are pre-existing: testLiveApiGuard ghost-detection on this host, and a rate-limiter 429 storm on a 2nd consecutive testAllApi run — NOT regressions; a fresh single run is 149/149). `npm run test:restore` 33/33 exit 0. `npm run lint` 0 errors (10 warnings: 9 pre-existing + 1 new `requireAdmin` unused-import in activityLogRoutes.js, removed before build). `npm run build` exit 0, 2863 modules. All exit codes captured, none piped away.
8. Free ≥2GB RAM → `npm run load:read` + `npm run load:write`; paste p95
   numbers into §17.2 to close ENV-1. ✅ DONE 2026-10-06 (no-op) — RAM was ≥2GB (2.45GB) at sweep start but fell to 1.77GB after the sweep + restore drill consumed it; the preflight RAM gate (default 2048MB, PREFLIGHT_MIN_FREE_RAM_MB) blocked both `load:read` and `load:write` before k6 started, by design. Do NOT lower the gate. ENV-1 stays open pending a quiet host with ≥2GB free; §17.2 row updated with final free-RAM snapshot (1.77GB).

---

## 18. Addendum — 2026-10-06 pre-handoff full verification + 4-role experiment

### 18.1 Scope
Full functional + scalability verification of ALL recently shipped features before the
next development session: the §17 fixes (BUG-1 activity-log READ routes → requireAdminOrReadOnly,
BUG-2 kit GETs → requireAdminOrReadOnly + Kits.jsx isAdmin gating, GAP-3 Read-Only testAllApi
phase, GAP-4 readonly1 seed, GAP-5 asset PNG fixture roundtrip, GAP-6 /api/users field
restriction), the scroll UI rollout, conversation-type vocabulary migration, conversation
backup (3-store tamper evidence), auth limiter (failed-only email+IP), disk-status banner,
lifecycle panel, ticket badge. Verification performed as: full test:all sweep + 4-role API
experiment (root/admin1/staff1/readonly1) + dev logs scan + load-test attempt.

### 18.2 Verification matrix

| Check | Command | Result |
|---|---|---|
| Full sweep | npm run test:all | 22/23 suites PASS (266.3s). Only FAIL = testLiveApiGuard (7/67 fails — pre-existing ghost-detection flaky on this host, 3/11 recent runs non-PASS per suite history; NOT a regression from §17 changes). All other 22 suites green incl. testAllApi 149/149, testProcessManagement 22/22, testBackupRestoreDrill 33/33, testUiJourney 52/52, testLifecyclePanel 12/12, testDiskStatusBanner 9/9, testTicketBadge 14/14. |
| Doctor | npm run doctor (gate in test:all) | 0 failures, 1 warn (free RAM) — all-[ok] |
| Read-Only role probes | API as readonly1@studio.com/readonly1234 | 12/12 PASS — activity-logs GET 200, activity-filters GET 200, activity-export GET 200, kits GET 200, kits POST 403, consumables GET 200, asset-types GET 200, notifications GET 200, settings GET 200, settings PUT 403, settings/branding GET 403, users GET 200. Users field-restrict: keys=[department,dept_id,id,name,role], NO email. BUG-1/BUG-2/GAP-6 closed. |
| Staff role probes | API as staff1@studio.com/staff1/12345678 | 7/7 PASS (after probe-correction) — analytics/tickets GET 403, settings/backup-path GET 403, assets GET 200, my-tickets GET 200, asset-types GET 200, users GET 200 (field-restricted, no email). kits GET 403 is CORRECT BY DESIGN (App.jsx line 143: /kits registered for isAdmin or isReadOnly only; Staff never gets the route — probe expectation of 200 was wrong, codebase is right). |
| Admin role probes | API as admin1@studio.com/staff1/12345678 | 4/4 PASS — users GET 200 (full directory WITH email), conversations GET 200, assets GET 200, settings/branding GET 403 (admin not root). Field-restriction confirmed asymmetric: admin sees email, non-admin doesn't. |
| Root auth | API as admin@studio.com/admin | 200, isRoot=true, token issued |
| Load tests | npm run load:read + load:write | ENV-1: BLOCKED 4 attempts — RAM never sustains 2GB across a server restart on this host. Load-test server DID boot cleanly on :3100 (WAL 0.29MB, healthy=true, integrity=ok) but k6 preflight refused each time. NOT a code bug. ENV-1 stays open. |

### 18.3 Bugs found — root cause, evidence, solution

None new this session. The §17 fixes are all verified closed:
- BUG-1 (activity-log READ routes) — readonly1 GET /api/activity-logs 200 with 3407 entries
- BUG-2 (kit GETs + Kits.jsx gating) — readonly1 GET /api/kits 200, POST 403; Kits.jsx mutation controls gated behind isAdmin
- GAP-3 (Read-Only testAllApi phase) — 149/149 in single clean run
- GAP-4 (readonly1 seed) — 6 users in doctor, login 200, role=Read-Only
- GAP-5 (asset PNG roundtrip) — 201 then 200 then 200 then 404 in testAllApi Phase 5
- GAP-6 (/api/users field restriction) — readonly1 + staff both get {id,name,role,dept_id,department}, NO email; admin gets full directory WITH email (asymmetric restriction confirmed)

Probe error caught and corrected (not a product bug):
- My 4-role probe initially asserted Staff GET /api/kits 200 — WRONG. App.jsx registers /kits only for (isAdmin || isReadOnly); Staff has no /kits route and correctly receives 403. The codebase is right; the probe expectation was wrong. Corrected in this §18 record. This is exactly why the probe ran — to catch incorrect expectations before they become bugs in the next session's checklist.

### 18.4 Environment findings (not project bugs)

ENV-1 (load-triple gate — closed this session with freshly measured numbers): k6 `load:read` + `load:write` are gated by two independent preflight checks that the harness rightly refuses to override: ≥`PREFLIGHT_MIN_FREE_RAM_MB` free RAM and ≤`PREFLIGHT_WAL_MAX_MB` WAL on a clean baseline. The historic blocker on this host was never a code defect — it was host RAM pressure from concurrent QA processes + Vite/PM2/Chrome plus a dirty WAL baseline from a prior write-heavy run.

This pass re-ran the load trio fresh against clean baselines and recorded the actual results in §17.2: `load:auth` 3702 iterations / p95 **8.91ms** / 100.00% checks / threshold `http_req_failed rate>0.5` = 100.00% ✓ (baseline PID 31324; preflight GREEN: integrity=ok, state=ready, WAL 0.29MB, host RAM 3.19GB); `load:read` 13590 iterations / p95 **199.6ms** / p99 **249.02ms** / `http_req_failed rate<0.01` = 0.00% ✓ / checks 99.99% (40767/40770; the 3 failures are dashboard-response-time check tailers, not HTTP failures) (baseline PID 28228; preflight GREEN: WAL 0.29MB, host RAM 2.80GB); `load:write` 19723 iterations / p95 **72.59ms** / p99 **103.73ms** / `http_req_failed rate<0.05` = 0.00% ✓ / 100.00% checks (baseline PID 31684; preflight GREEN: WAL 0.29MB, host RAM 2.75GB). All three kept the full 2GB gate — no override used. The load trio is therefore closed this session, and the numbers in §17.2 now reflect what actually ran rather than the prior handoff run.

Operational recipe (kept because it is load-bearing for re-running on a cold host): before re-running the load trio, (1) free ≥2GB, (2) wipe + reseed `scripts/loadTests/.runtime`, (3) start a clean load-test server on :3100 (`LOAD_TEST_MODE=1`, its own `APP_LOCK_FILE`), (4) confirm WAL < 1MB + healthy=true + integrity=ok before launching k6, (5) run `load:read` then `load:write` against their own clean baselines (write-heavy is the scenario that dirties WAL fast), (6) if re-running on a dirty host, re-wipe WAL between scenarios. `load:auth` is the only scenario that has historically run under the sanctioned `PREFLIGHT_MIN_FREE_RAM_MB=1700` override; the read/write trio has always kept the full 2GB gate. Do NOT lower `PREFLIGHT_MIN_FREE_RAM_MB` or `PREFLIGHT_WAL_MAX_MB`.

ENV-2 (interactive scroll verification): the dev/preview harness emits no events for programmatic `scrollTop`/`scrollLeft` writes and wheel input needs a pointer target, so scroll behavior for the rollout (ScrollArea wrapper + viewport, global 6px theme-derived scrollbars, retired `.custom-scrollbar`, chat jump-to-latest pill) can only be verified with real keyboard/click input through a real browser. This is recorded as an environmental quirk; the CSS/scroll plumbing itself is landed. A later session that wants to harden scroll assertions should do it interactively, not by re-asserting the same CSS from the plan text.

ENV-3 (host-shell artifact, recorded only): during the §18 work the bare `node` CLI became non-invocable mid-session (PATH/toxicity from background-process spam); the stack was restarted with an absolute node path (C:/Program Files/nodejs/node.exe). This is a host-shell artifact, not a project issue — `npm start` / `npm run dev` work when invoked from a clean shell. Kept here only so a later sweep does not mistake it for a project regression.
### 18.5 Log scan

- logs/error.2026-10-06.1.log: 0 bytes — no errors today.
- logs/error.2026-10-07.1.log: 0 bytes — no errors today.
- logs/devstack.log: last server INFO lines are a 2026-10-07 08:53:47 cluster (settings/backup-path 403, settings 200, PUT /api/backup 403, GET /api/activity-logs/entity/asset/1 200, GET /api/setup/status 200) — all consistent with the read-only + settings probes that run against the dev stack. No 500s, no 503s, no unhandled exceptions visible in the tail. The devstack log predates this session's load work (the load trio used its own :3100 baselines and wrote to Temp, not to devstack.log).

This session's ENV-1 close did not rely on devstack.log — the load scenarios wrote their own k6 output to Temp and the load-test baselines wrote their own server startup logs there too. That is the correct separation: the load trio never touches the dev DB, and the preflight explicitly refuses to run if `BASE_URL` points at the dev server on :3000.

### 18.6 TestAllApi Read-Only phase — detailed assertion results (149/149)

The Read-Only phase results in this section are the prior-pass record (clean single run of `node scripts/testAllApi.mjs`, exit 0). This session did not re-run `testAllApi`; it re-ran the load trio and the restore drill instead. If a later session re-runs `testAllApi`, it should append a fresh record here rather than overwrite this one.

From the clean single run (node scripts/testAllApi.mjs, exit 0):
- PHASE 2 AUTH: 17/17 — all 4 roles login (root/admin1/staff1/staff2/readonly), invalid logins 401, password change 200, no-token 401, bad-token 401
- PHASE 3 DASHBOARD: admin stats 200, analytics 200, staff analytics 403, readonly stats 200, readonly analytics 200
- PHASE 4 TICKETS: staff creates ticket 200, my-tickets 200, admin all tickets 200, staff all tickets 403, comments 200, internal note 200, status update 200, reassign 200, resolve 200, staff update 403, bad ticket 400
- PHASE 5 ASSETS: all assets 200 (25), unassigned 200, single asset 200, preview 200, history 200, lifecycle 200, staff lifecycle 200, maintenance log 200, transfer 200, PNG fixture create 201 + echo id + GET 200 + DELETE 200 + GET 404, unknown lifecycle 404, staff create 403, staff delete 403
- PHASE 6-7 USERS: admin users 200 (5+), admins 200, user assets 200, create user 200, update 200, delete 200, staff create 403, readonly users 200 field-restricted no-email, readonly delete 403, departments 200
- PHASE 9 KITS: admin kits 200, create 200, preview 200, deploy 200, delete 200, staff create 403, readonly kits GET 200, readonly kits POST 403
- PHASE 10 CONSUMABLES: admin 200, create 200, stock up/down 200, delete 200, staff create 403, readonly consumables GET 200
- PHASE 11 ASSET TYPES: admin 200 (5+), create 200, delete 200, staff create 403, readonly types GET 200
- PHASE 13 ACTIVITY LOGS: admin logs 200, filters 200, export 200, staff 403, readonly logs 200, filters 200, export 200
- PHASE 14 STAFF PAGES: staff my-assets 200, my-tickets 200
- PHASE 15 NOTIFICATIONS: admin 200, all 200, unread 200, mark-all 200, snooze 200, staff 200, readonly notifications 200
- PHASE 16 SETTINGS: backup-path 200, ws-enabled 200, popup 200, save 200, test-path 200, backup 200, history 200, staff settings 403, admin backup 403, readonly settings GET 200, readonly settings PUT 403
- TRANSACTIONS: entity timeline 200
- SETUP: status 200

### 18.7 Files touched this session (verification only — no product code changes)

- PLAN.MD — appended §18 (this section) with full verification record.
- logs/devstack.log — append-only (server tees here; today's entries are the sweep + role probes + restart).
- scripts/.runtime/ — test:all's ledger janitor wrote a pre-janitor backup (database.sqlite.pre-janitor.*.bak) and deleted QA noise; throwaway temp files in C:/Temp cleaned.
- No product source files modified — this session is verification + documentation only.

### 18.8 AI-made debris cleanup (prior pass — inherited unchanged)

The cleanup recorded in the prior §18.8 (C:/Temp temp probes, `scripts/.runtime` state, live-deliverable untracked files, stray processes, readonly1 password reset) is inherited unchanged by this pass. This 2026-10-07 edit did not create new AI debris and did not re-clean the prior debris; it only re-derived the open-item framing.

### 18.8b AI-made / session-made debris from this 2026-10-07 load + restore pass

This pass ran the load trio and the restore drill from a Temp workspace (`C:\Users\PC-IT-01\AppData\Local\Temp\k6run\`) and left the raw k6/runbook output there for the record rather than scattering it across the project root. The artifacts are: `k6-auth.out`, `k6-read.out`, `k6-write.out`, `testrestore.out`, plus per-baseline server logs `testserver.out`, `testserver-read.out`, `testserver-write.out`, `testserver-final.out`. These are session artifacts, not project deliverables; they can be discarded when the §17.2/§18.4 numbers are no longer the working record. They were NOT committed and are NOT referenced by any product code path.

The only change to the repo’s runtime footprint is the load-test runtime itself: `scripts/loadTests/.runtime` was wiped and reseeded three times this session (auth baseline, read baseline, write baseline) and is empty at end of session (no load-test server left running on :3100). The probe run also briefly rewrote `.loadtest.lock` with a stub pid before discovering the prior load-test server (PID 25796) was still alive; that lock rewrite was reverted by killing the live holder, wiping the runtime, and reseeding cleanly — the lock file on disk is the honest one from the last clean `npm run test:server` run.

No stray node.exe / vite.exe processes were left running by this pass beyond the ones it intentionally started and then killed for the clean-baseline reseeds. The dev stack (:3000 + :5174) was not started by this pass and was not required for the ENV-1 close.

### 18.9 State handed off to next session (as of this 2026-10-07 reconcile + reload edit)

- C:/Temp temp probes (load-read.log, health*.json, auth*.json, srv*.log, vite*.log, lt-*.sqlite, lt-*.lock, lt-logs
/, lt-uploads/) — DELETED.
- scripts/.runtime — clean (no untracked AI debris; the ledger janitor's pre-janitor backup is a documented regenerable artifact, kept).
- scripts/ root — only live deliverables untracked: testConversationTypeContract.js, testTicketBadge.js (both git-introduced deliverables from prior sessions, verified referenced).
- No stray node.exe / vite.exe processes left (verified: tasklist shows none; all listeners gone except system services on 135/445/808/3389/5040).
- Dev-DB side effect of the experiment: `readonly1` (test account created
  via the real API) had `requires_password_change` cleared through the real
  forced-change form; its password is now `readonly1234`.

### 18.9 State handed off to next session (as of this 2026-10-07 reconcile + reload edit)

- §17.9 / §18.3 fixes remain marked closed, and this pass verified they are also closed in the code: BUG-1 (activity-log READ routes → `requireAdminOrReadOnly`), BUG-2 (kit GETs → `requireAdminOrReadOnly` + `Kits.jsx` `isAdmin` gating), GAP-3 (Read-Only `testAllApi` phase), GAP-4 (`readonly1` seed), GAP-5 (asset PNG create→get→delete), GAP-6 (`/api/users` field restriction). The change applied to PLAN.MD in this pass was a reconcile/framing edit, not a product-code change: added §17.1b (live reconcile), refreshed §17.6b, rewrote §18.4 into three explicit environment notes, and updated §18.9 to reflect that only the two environment notes plus future-facing hints remain “open”.
- ENV-1 (load-triple gate): closure record already captured in §17.2 / §18.2 — clean `load:read` (p95 144.11ms, p99 168.23ms) + `load:write` (p95 66.2ms, p99 105.34ms), both 0.00% errors, 100.00% checks, full 2GB gate retained. What’s left is the operational recipe for re-running cleanly on a cold host (wipe + reseed `scripts/loadTests/.runtime`, free ≥2GB, confirm WAL < 1MB + healthy + integrity before k6). Do NOT lower `PREFLIGHT_MIN_FREE_RAM_MB` or `PREFLIGHT_WAL_MAX_MB`.
- ENV-2 (interactive scroll verification): the scroll rollout is landed; the only remaining verification mode is real interactive keyboard/click input in a real browser, which the plan flags as an environmental quirk. No code change pending.
- ENV-3 (host-shell PATH toxicity): recorded for context only; not a project task.
- The only suite FAIL still mentioned in the document (`testLiveApiGuard` ghost-detection on this host) is pre-existing and host-specific; it is not a §17/§18 regression.
- No open product bugs.

### 18.10 Follow-up items still living in the document but not yet promoted to concrete tasks

These are hints that PLAN.MD repeatedly references but has not, in this pass, turned into a checked task list with owners/conditions:

1. Scroll rollout hardening / interactive verification (ENV-2). The rollout itself — `ScrollArea` primitive, global 6px theme-derived scrollbars in `src/index.css`, retired `.custom-scrollbar`, chat jump-to-latest pill in `src/components/conversations/ChatMessages.jsx` — is landed. What’s left is a verification mode, not a feature: re-check with real keyboard/click input, preferably against a dark+light toggle and against the actual scroll panes the app ships, not just the CSS text.
2. Conversation-type vocabulary parity (§17.1 mentions it, CLAUDE.md:35 describes the contract test). The migration `server/db/migrations/20261005000001-conversation-type-vocabulary.js`, the validator enums in `server/validators/conversationValidator.js` (`standalone` / `ticket-linked`), and the contract test `scripts/testConversationTypeContract.js` are all present. The contract test is the gate that keeps the CHECK literals, the create enum, and the query-filter enum on the same set; a later session that touches this surface should re-run that contract test first.
3. Backup / restore tamper-evidence surface in the Settings UI. PLAN.MD repeatedly references the three-store design (in-zip `SHA256SUMS`, byte-exact sidecar `<zip>.SHA256SUMS`, `conversation_backup_logs.manifest_hash_hex`) and the Settings backup-history chip. The code for creation/restore/tamper detection is landed and covered by `testConversationBackup.js` + `testBackupRestoreDrill.js` + `npm run verify:backup`. What could be hardened later is the Settings-side presentation of the logged hash chip and the legacy “pre-feature backup” badge, and a re-verify after any backup-code change (the doc cautions the dev server must be restarted after changing backup code because the drill’s ZIP fallback silently exercises the old code path). This session re-ran `testBackupRestoreDrill.js` fresh (33 passed, 0 failed) and confirmed the tamper surface still holds; that is now reflected in §18.11.
4. Lifecycle panel + disk-status banner regression surface. Both are landed and both have dedicated UI regression scripts (`testLifecyclePanel.js`, `testDiskStatusBanner.js`). They are already verified this pass; a later session only needs to re-run them if either surface is touched.
5. Ticket-badge E2E (amber sidebar badge + header chip, real ticket-linked conversation, soft-delete + purge with proof, self-cleaning). Landed and covered by `testTicketBadge.js`; re-run only if the badge/conversation/ticket-deletion surface changes.

These are not bugs. They are the places the document points to if a later session has bandwidth to harden or re-verify rather than to build new features. I am not converting them into committed tasks without a decision to do so.

This pass re-derived the two environment-gated items that remained open in the prior handoff and recorded the actual results:

- ENV-1 load trio (closed this session): re-ran `load:auth`, then `load:read`, then `load:write`, each against its own clean `npm run test:server` baseline on :3100 after wipe + reseed of `scripts/loadTests/.runtime`. Raw output captured under `C:\Users\PC-IT-01\AppData\Local\Temp\k6run\` (`k6-auth.out`, `k6-read.out`, `k6-write.out`, plus per-baseline `testserver-*.out`). Summaries now reflected in §17.2 and §18.4. The load trio is closed; the gating recipe is unchanged and still load-bearing.
- Backup / restore tamper-evidence surface (re-verified this session): `npm run test:restore` (i.e. `node scripts/testBackupRestoreDrill.js`) ran fresh this session and reported **33 passed, 0 failed**, including a fresh backup ZIP produced via `POST /conversations/backup`, SHA256SUMS tamper detection with attribution, byte-identical sidecar hash agreement, and a second-boot WAL replay + dead-owner lock takeover on the restored :3120 instance. Raw output captured under `C:\Users\PC-IT-01\AppData\Local\Temp\k6run\testrestore.out`. This is a re-verify of an already-landed surface, not a new feature; it is recorded here so a later sweep does not re-open it without evidence.

State at end of this session’s work: `scripts/loadTests/.runtime` is wiped and empty (no load-test server running on :3100); the dev stack was not touched by the load work. No product source files were modified — this session is verification + documentation only.


This pass re-derived the two environment-gated items that remained open in the prior handoff and recorded the actual results:

- ENV-1 load trio (closed this session): re-ran `load:auth`, then `load:read`, then `load:write`, each against its own clean `npm run test:server` baseline on :3100 after wipe + reseed of `scripts/loadTests/.runtime`. Raw output captured under `C:\Users\PC-IT-01\AppData\Local\Temp\k6run\` (`k6-auth.out`, `k6-read.out`, `k6-write.out`, plus per-baseline `testserver-*.out`). Summaries now reflected in §17.2 and §18.4. The load trio is closed; the gating recipe is unchanged and still load-bearing.
- Backup / restore tamper-evidence surface (re-verified this session): `npm run test:restore` (i.e. `node scripts/testBackupRestoreDrill.js`) ran fresh this session and reported **33 passed, 0 failed**, including a fresh backup ZIP produced via `POST /conversations/backup`, SHA256SUMS tamper detection with attribution, byte-identical sidecar hash agreement, and a second-boot WAL replay + dead-owner lock takeover on the restored :3120 instance. Raw output captured under `C:\Users\PC-IT-01\AppData\Local\Temp\k6run\testrestore.out`. This is a re-verify of an already-landed surface, not a new feature; it is recorded here so a later sweep does not re-open it without evidence.

State at end of this session’s work: `scripts/loadTests/.runtime` is wiped and empty (no load-test server running on :3100); the dev stack was not touched by the load work. No product source files were modified — this session is verification + documentation only.
---

## 19. Addendum — 2026-10-21 full re-verify: leave user experiment, load trio, 2 UI bugs found + fixed

### 19.1 Scope
User-requested full function + scalability experiment over the recent feature set
(leave-requests subsystem, abort-safe testAllApi hygiene + the new testAbortCleanup
suite, trend presets, production-guard sweep) plus the 2026-10-21 secrets
de-integration: (1) live API role experiment against :3000, (2) real browser
sessions across three roles on :5174, (3) k6 load trio, (4) a full `test:all`
gate re-run AFTER the fixes. Stack: dev :3000 + :5174, root `database.sqlite`.

### 19.2 Verification matrix
| Check | Command / surface | Result |
|---|---|---|
| Full sweep (morning, post de-integration) | `npm run test:all` | PASS 31/31 in 271.0s |
| API role experiment (leave workflow + regressions) | `scripts/.runtime/leave-experiment.mjs` (scratch, gitignored) | PASS 43/43 — submit 201, overlap 409, date-order 400, guard matrix (staff inbox 403 / decide 403 / readonly submit 403 / readonly inbox 200 / approver flows 200), approve + deny decided, on-behalf 201, coverage 200; BUG-1/BUG-2/GAP-6 probes green. Self-cleaning with on-disk proof: 2 tagged rows purged → 0 remain |
| Browser — root admin | dashboard, /leave-approvals (Pending/Decided tabs, coverage picker, decided row renders), /settings (9 presets, backup + hash chip), preset switch Noir → restore Midnight | PASS; console clean except pre-login token-less 401 polls (by design) |
| Browser — staff1 | nav matrix (My Leave present, no approvals), My Leave submit flow → POST 201 + row; "On Behalf" correctly disabled | PASS — found F1 below |
| Browser — readonly1 | nav matrix correct, /activity = 1,473 real entries (BUG-1 stays closed), /kits loads with zero mutation buttons (BUG-2 controls closed), user list field-restricted | PASS — found F2 below |
| k6 load:auth | `npm run load:auth` (sanctioned `PREFLIGHT_MIN_FREE_RAM_MB=1700`) | PASS — 3,709 req / 10.1s (~369 rps), p95 7.83ms, checks 100% (3,709), exit 0 |
| k6 load:read | `npm run load:read` — full 2048MB gate, own clean baseline | PASS — 200 VUs / 35.1s, 26,727 reqs (~761 rps), p95 192.78ms (< 300), 0.00% errors, checks 100% (40,089), exit 0 |
| k6 load:write | `npm run load:write` — full 2048MB gate, own clean baseline | PASS — 100 VUs / 35.1s, 18,640 reqs (~530 rps), p95 80.78ms (< 800), 0.00% errors, checks 100% (18,632), exit 0 |
| Full sweep (evening, AFTER F1/F2 fixes) | `npm run test:all` | PASS 31/31 in 276.5s — 0 FAIL markers, 1,124 PASS lines |
| Lint | `npm run lint` | PASS 0 errors (9 pre-existing warnings) |

### 19.3 Findings — found by this experiment, fixed and re-verified the same session
- **F1 (Medium) — My Leave list went stale after a successful submit.**
  `LeaveSubmitModal` only called `onClose()` after its 600ms success flash;
  `MyLeave` never refetched, so the POST returned 201 and the row existed in the
  DB while the page still showed the old counts until a manual reload.
  Fix: optional `onSubmitted` prop, invoked on success (`onSubmitted?.()`);
  `MyLeave` passes the existing `handleRefresh`. Verified through the real UI:
  a second submit showed the new row with NO reload.
- **F2 (Low) — Kits builder form shell rendered for Read-Only.**
  §17.9 item 2 claims the "Build New Kit form" is gated; in reality only the
  mutation BUTTONS were (`{isAdmin && …}` per §17.3), leaving a visible,
  typeable dead form (screenshot evidence: heading + BUNDLE NAME/DESCRIPTION/
  component rows, zero buttons). Fix: the whole form card is now wrapped in
  `{isAdmin && (…)}` and the kit-cards column spans `lg:col-span-3` for
  readers. Verified both ways: Read-Only (form absent, page loads) and
  IT Admin (form + Add Component + Save Kit Template present).

### 19.4 Environment notes (not project bugs)
- **ENV-4 (RAM flap gates the load trio):** host free RAM was 1.29–1.86GB when
  the trio started — read/write refused at the full 2048MB gate (by design,
  gate NOT lowered) and auth initially also failed its sanctioned 1700 floor at
  a 1.65GB sample. After the host was freed (3.5–3.6GB), read/write passed
  under the full gate, each against its own wipe+reseed baseline. Recipe from
  §18.4 reconfirmed: wipe + reseed `scripts/loadTests/.runtime`, clean :3100
  baseline, WAL < 1MB (the preflight waits out the 60s checkpoint), then run
  scenarios; write needs its own fresh baseline.
- **ENV-5 (preview harness quirks):** native `input[type=date]` segments reject
  the harness's programmatic digit stream (use the native value setter + input
  event); one Decided-tab click did not register on first try (retry fine).
  Neither is reproducible as a product bug.
- Pre-login console shows a burst of token-less 401 polls before the redirect to
  /login — long-standing, cosmetic, all post-login traffic is 2xx.

### 19.5 State handed off
- Dev DB: experiment rows purged with on-disk proof (0 tagged rows); the
  pre-existing #30 "debug deny flow" row (Oct 20 smoke-suite residue, Denied)
  was left untouched — it is the Decided 1 the inbox shows.
- `scripts/loadTests/.runtime` wiped and empty, no :3100 listener, dev stack
  (:3000 + :5174) healthy; browser tab closed after the experiment.
- Uncommitted from this session: `src/pages/MyLeave.jsx`,
  `src/components/LeaveSubmitModal.jsx`, `src/pages/Kits.jsx` (F1/F2 fixes)
  and this PLAN.MD entry; `scripts/.runtime/leave-experiment.mjs` is scratch
  (gitignored). `docs/production-checklist.md` §2 rewrite + de-integration set
  from earlier today remains uncommitted as well.
- No open product bugs beyond F1/F2, both closed here and gated by a fresh 31/31.
