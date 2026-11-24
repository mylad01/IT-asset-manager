# Department Leave Requests — Design Spec

**Date:** 2026-10-13
**Status:** Awaiting spec review (design approved in-session 2026-10-13)
**Type:** Architectural — new subsystem (new role, new table, approval workflow, calendar UI)

---

## 1. Overview

Users submit leave requests (date range + description + optional attachments) that route **only** to the approvers of their own department. Department managers — a new fourth role — accept or deny those requests from an approvals inbox wired into the existing notification system. IT Admin/root retain read + decide fallback visibility.

### Goals
- Dept-scoped routing enforced **server-side** (other departments' requests are never returned, not merely hidden in UI).
- Contiguous multi-day range selection in a glass-styled calendar UI with no new npm dependency.
- Image + PDF attachments, private (never publicly served).
- Managers get approvals **inside the existing notification center** (bell, toasts, WS push, calendar) plus a sidebar badge — no parallel notification system.

### Non-goals (deferred)
Half-day leave, leave balances/quotas, holiday awareness, ICS export, withdraw/cancel, email delivery.

### Decisions confirmed with the user
| Question | Decision |
|---|---|
| Role modeling | New 4th role `'Department Manager'` (not a flag) |
| Visibility scope | Own department only, strictly |
| Manager as requester | **Managers cannot submit leave.** Admin/root file on their behalf (`/on-behalf`). |
| Attachments | Images (JPEG/PNG/WebP/GIF) + PDF, ≤3 files, 10 MB each |
| Overlap | Server blocks a user's ranges overlapping their own `Pending`/`Approved` leave (409) |
| Admin/root | Read everything + decide fallback (incl. managerless departments, and never self-decide) |

---

## 2. Access matrix

Roles: `Staff`, `IT Admin`, `Read-Only`, **`Department Manager`** (new), plus `isRoot`.

| Capability | Staff | Dept Manager | Read-Only | IT Admin / Root |
|---|---|---|---|---|
| Submit own leave (multipart POST) | ✅ | ❌ 403 | ❌ 403 | ✅ |
| View own requests (`/mine`) | ✅ | ✅ | ✅ (own, will be empty) | ✅ |
| View pending inbox | ❌ 403 | ✅ own dept only | ✅ read-only, all | ✅ all |
| Decide (approve/deny) | ❌ | ✅ own dept only, **never own request** | ❌ 403 | ✅ any, **never own request** |
| File on behalf of another user | ❌ | ❌ | ❌ 403 | ✅ |
| Coverage ranges (`/coverage`) | ❌ 403 | ✅ own dept | ✅ all | ✅ all |
| Download attachments | own only | own dept's requests | ✅ all | ✅ all |
| `/leave` page (submit + my list) | ✅ | ✅ view-only (no form) | ❌ hidden | ✅ (+ on-behalf form) |
| `/leave-approvals` page | ❌ | ✅ | ✅ buttons stripped | ✅ |

**Dept scoping rule:** a `Department Manager` with `dept_id IS NULL` sees nothing (fail closed). Requests with `dept_id IS NULL` (submitter unassigned) are visible only to admin/root.

---

## 3. Data model — migration `server/db/migrations/20261013000001-leave-requests.js`

```sql
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,            -- requester (may be ≠ actor when filed on-behalf)
  submitted_by INTEGER,                -- actor: self, or the admin who filed on-behalf (nullable: ON DELETE SET NULL below would violate NOT NULL)
  dept_id INTEGER,                     -- SNAPSHOT of requester's dept at submit time (NULL allowed)
  start_date TEXT NOT NULL,            -- YYYY-MM-DD
  end_date TEXT NOT NULL,              -- YYYY-MM-DD, >= start_date
  description TEXT NOT NULL,           -- 10..2000 chars
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Denied')),
  decision_note TEXT,                  -- optional reason from the approver
  decided_by INTEGER,                  -- user_id of approver
  decided_at DATETIME,
  attachments TEXT,                    -- JSON array: [{ name, path, mime, size }]
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(submitted_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(dept_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY(decided_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dept_status ON leave_requests(dept_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user_status ON leave_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_created ON leave_requests(created_at DESC);
```

Notes:
- `dept_id` snapshot keeps audit history stable if the requester or department later moves.
- `down()` drops the table + indexes (standard Umzug contract, column-guarded `CREATE IF NOT EXISTS` like existing migrations).
- Vocabulary contract (repo convention proven by `testConversationTypeContract.js`): `LEAVE_STATUSES` (exported from the validator) must equal the `status` CHECK literals **exactly**, and `LEAVE_DECISIONS` (`['Approved','Denied']`) must be `LEAVE_STATUSES` minus `'Pending'` — every decision value the API accepts has to pass the CHECK when written as `status`.

---

## 4. API — new `server/routes/leaveRequestRoutes.js`, mounted `router.use('/leave-requests', …)` in `server/routes/index.js`

All routes: `verifyToken` first; writes add `writeLimiter`; multipart routes run `upload.array('attachments', 3)` **before** `validate(...)` (multer populates `req.body` — same ordering note as conversationRoutes).

| # | Route | Guards | Behavior |
|---|---|---|---|
| 1 | `POST /` | role ∈ {Staff, IT Admin} or root; 403 for Manager/Read-Only | Fields: `start_date`, `end_date`, `description`, files ≤3. Overlap check in-txn → **409** with the conflicting range in `error`. `dept_id` = requester's current dept. Emits `leave:submitted`. |
| 2 | `POST /on-behalf` | `requireAdmin` (IT Admin/root) | Extra field `user_id` (target). Same validations incl. overlap. Target may be a manager. `submitted_by` = admin. |
| 3 | `GET /mine` | any authenticated | Requester's own rows, newest first, with attachment metadata (no bytes). |
| 4 | `GET /pending?view=pending\|decided` | manager (own dept), admin/root (all), Read-Only (all, read) ; others 403 | Full rows incl. `description`, requester name, dept name, attachment metadata. `view=pending` (default) → `status='Pending'` ordered `created_at ASC`; `view=decided` → `Approved`/`Denied` ordered `decided_at DESC` (powers the Decided tab from §7). Manager scope: `WHERE dept_id = ?` with NULL-dept manager → empty set. |
| 5 | `GET /pending-count` | any authenticated | Approver scope: manager → own dept (NULL dept → 0), admin/root → all, **everyone else (Staff, Read-Only) → 0** — it is an action-queue count, so the badge never lights up for non-approvers. |
| 6 | `PUT /:id/decide` | manager of that dept / admin/root; 403 if caller is the requester; 409 unless `Pending` | Body: `{ decision: 'Approved' \| 'Denied', decision_note?: string ≤500 }`. Sets `decided_by/at`. Emits `leave:approved` / `leave:denied`. |
| 7 | `GET /coverage?from&to` | manager (own dept), admin/root, Read-Only; others 403 | `Pending`+`Approved` ranges in `[from, to]` — powers the approvals-page availability strip. |
| 8 | `GET /:id` | requester / same-dept manager / admin/root / Read-Only | Single row for the detail pane. Declared after the literal routes (`/pending`, `/mine`, …) — Express 5 matches in order. |
| 9 | `GET /:id/attachments/:idx` | same as #8 | Streams file bytes with `Content-Disposition: attachment` + `nosniff`. **The only path that serves leave attachment bytes.** |

Layering (repo rules): `routes → controller → service → model`. Multi-step writes wrap in `withTransaction` (never hand-rolled BEGIN/COMMIT). `activityLogService.logChange()` on submit and decide (`entityType: 'leave_request'`, mirroring ticketService's usage).

### Validators — new `server/validators/leaveRequestValidator.js`
```js
dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealCalendarDate)
createLeaveSchema    = { start_date: dateStr, end_date: dateStr.refine(>= start), description: z.string().min(10).max(2000) }
onBehalfSchema       = createLeaveSchema + { user_id: numericId() }
decideSchema         = { decision: z.enum(['Approved','Denied']), decision_note: z.string().max(500).optional() }
coverageQuerySchema  = { from: dateStr, to: dateStr }
pendingQuerySchema   = { view: z.enum(['pending','decided']).default('pending') }
```
Overlap is a **service-level** check (needs a DB read inside the transaction), not Zod: `WHERE user_id = ? AND status IN ('Pending','Approved') AND start_date <= :newEnd AND end_date >= :newStart`.

---

## 5. Uploads & storage (revised by empirical verification)

### Storage
- Files: `uploads/leave-requests/<uuid>.<ext>` — resolution via `uploadsRoot()` from `server/utils/uploadPaths.js` (honors `UPLOADS_DIR` for isolated QA instances; lands inside `uploads/` so **backup/restore includes them automatically** — `backupService` zips all of `uploads/`).
- Row metadata in the `attachments` JSON column: `{ name, path: 'leave-requests/<file>', mime, size }`.
- Filename extension derived from the **validated MIME**, never `originalname` (rule from `uploadSafety.js`, security review 2026-10-12).

### Multer — new `server/config/leaveUpload.js`
Pattern follows `conversationUpload.js`: allowlist requires **both** mime and extension to match (`jpeg/png/webp/gif` + `.jpg/.jpeg/.png/.webp/.gif`; `application/pdf` + `.pdf`), anchored tests, per-file 10 MB enforced post-upload via a `findOverCapFiles`-style stat (multer's `fileSize` limit set to 10 MB as hard ceiling), `MAX_FILES = 3`, friendly `multerErrorMessage` mapping.

### Content verification — extend `server/utils/uploadSafety.js`
- Reuse `extForImageMime` for rasters; add `extForLeaveMime()` covering `application/pdf → .pdf`.
- Add `validateLeaveFile(path, mime)`: rasters → existing `validateImageFile` magic bytes; PDF → first bytes must be `%PDF-`.
- Add `privateUploadsGuard(req, res, next)`: **404** for any path under `/uploads/conversations/`, `/uploads/archive/conversations/` (the archived tree — same public exposure, verified alongside the active one), or `/uploads/leave-requests/`, mounted in `server/index.js` **before** `express.static('uploads')`.

### ⚠️ Pre-existing gap this fixes (verified 2026-10-13)
`conversationRoutes.js` claims "no static express.static mount for uploads/conversations", but the **global** `app.use('/uploads', express.static('uploads'))` serves that subtree. Verified live: `GET /uploads/conversations/<file>` returned **HTTP 200 with byte-exact PDF bytes and no auth** (536,186 bytes, `%PDF-1.7`, no token). `grep -rn "uploads/conversations" src/` → zero frontend references (the frontend uses the membership-checked streaming URL the API serializes), and no QA suite fetches that path. The guard therefore closes a real unauthenticated-read hole for conversation attachments **and** prevents the same class for leave attachments, with no known consumer breakage. `testConversations` + `testBackupRestoreDrill` must be re-run after implementing the guard to prove nothing regressed.

---

## 6. Notifications — extend `server/services/notificationEvents.js`

Three new registry entries:

| Event | Recipients | Priority | Link |
|---|---|---|---|
| `leave:submitted` | **new type `dept-managers`** (see below) | `warning` | `/leave-approvals?req=<id>` |
| `leave:approved` | `user` (requester) | `info` | `/leave?req=<id>` |
| `leave:denied` | `user` (requester) | `warning` | `/leave?req=<id>` |

- New recipient type `dept-managers`: `SELECT id FROM users WHERE role = 'Department Manager' AND dept_id = ?` (from `payload.deptId`); **if empty → fall back to all IT Admins** so a managerless/dept-less submission never dies silently.
- `getEventType`: add `leave:` prefix → `'leave'`.
- `getEventTitle/Message/Link`: entries for all three (e.g. title `Leave Request: <start> → <end>`, message `${payload.requesterName} requested leave …`).
- Real-time delivery is automatic: `emit()` → `notificationModel.createManyInTxn` (same txn as the request write) → `pushToUser` WS → `useNotifications` → NotificationBell popup, slide-in toasts, unread-count, Notification Calendar.

**"Notifications center for these tasks on their panel"** = the above + a **pending badge** on the `/leave-approvals` Sidebar `NavLink` (the `badge` prop already exists — same pattern as `convUnreadCount`) fed by `/pending-count`. No new notification UI is built.

`src/components/notifications/visuals.jsx`: add a `leave` entry to `typeIcons` (lucide `CalendarDays`, `--ui-pink-hi` to match the Notification Calendar accent); unknown types fall back to `system` today, so this is additive.

---

## 7. Frontend

### Role plumbing (complete inventory — every hard-coded role site)
| File | Change |
|---|---|
| `server/validators/userValidator.js` | `validRoles` += `'Department Manager'`, update both error messages |
| `server/utils/helpers.js` | `ROLES.DEPARTMENT_MANAGER` |
| `server/middleware/authMiddleware.js` | new `requireLeaveApprover` (manager / IT Admin / root) — role gate only; dept scoping stays in the service |
| `shared/preferencesRegistry.js` | `PREF_SECTIONS_META`: add `'Department Manager'` to the six user-scope sections (**fail-closed** — without this a manager loses all Settings sections); `branding` stays `['IT Admin']` |
| `server/services/brandingService.js` | `ALLOWED_ROLES` += `'Department Manager'` (per-role brand overrides work for the new role) |
| `src/components/AddUserModal.jsx` | role `<option>` |
| `src/pages/UserManagement.jsx` | role `<option>` + badge render (distinct badge for managers) |
| `src/App.jsx` | `isManager` const; routes: `/` redirects managers to `/my-assets`; `my-assets`/`my-tickets`/`calendar`/`leave` groups += manager; `/leave-approvals` for manager/admin/Read-Only; `PAGE_TITLES` += `/leave`, `/leave-approvals` |
| `src/components/Sidebar.jsx` | nav entries: `/leave` (Staff, Manager, Admin), `/leave-approvals` (Manager, Admin, Read-Only) **with pending badge** |

Not touched: `authMiddleware`'s existing `requireAdmin`/`requireRoot` semantics, `CreateConversationModal`'s admin-only user list, ticket machinery (leave is **not** modeled on tickets — see §10).

### Pages
1. **`src/pages/MyLeave.jsx` (`/leave`)** — submit form (GlassDateRangePicker + description textarea + attachment dropzone with chips/size guard) + "my requests" table (status chips: Pending=amber `--status-warning`, Approved=emerald `--status-success`, Denied=red `--status-danger`; row opens detail modal with attachment download). Manager: same list, **form replaced by an info note** ("Requests are filed by your administrator"). Admin: form plus a `SearchableSelect` "File on behalf of…" user picker switching to route #2. Read-Only: route hidden.
2. **`src/pages/LeaveApprovals.jsx` (`/leave-approvals`)** — two tabs (Pending / Decided). Pending rows expand to a detail pane: requester, dept, date span, description, attachments, **coverage strip** (route #7: teammates already off within the requested span, rendered as a mini day-bar), and Approve / Deny actions — Deny opens `GlassConfirmModal` with optional note. Read-Only: same data, no action controls. Deep links `?req=<id>` from notifications preselect the row.
3. **`src/components/leave/DateRangePicker.jsx`** — the custom calendar:
   - Month grid, Sunday-first (matches `CalendarPage`'s `getFirstDayOfMonth` convention), weekday header row, prev/next month with framer-motion crossfade using `EASE` from `components/notifications/visuals.jsx`.
   - **Selection = click start → click end; contiguous highlighted span across week rows** (rounded caps at range ends, continuous band between). Clicking an earlier day restarts the range; hover previews the tentative end while a start is pending.
   - Past dates and days already covered by the caller's own Pending/Approved leave are disabled (blocked days show a subtle strike/`--status-danger` dot); server re-enforces both.
   - Today marker, `aria-label` per day, keyboard: arrows move focus, Enter selects, Esc cancels. Popover on `glass-card`, all colors `-[color:var(--token)]` semantic arbitrary values only (doctor check #18; no palette classes, no template-built strings).
4. **`src/components/leave/` shared bits** — `LeaveForm.jsx`, `AttachmentDropzone.jsx`, `LeaveDetailModal.jsx`. Submission via `apiClient` FormData (already supported: `body instanceof FormData` branch sets no Content-Type).

---

## 8. Error handling
- 400 Zod (dates, description bounds) — standard `validate` → `errorHandler`.
- 403 wrong role / cross-dept manager / self-decide — `AppError` with actionable message.
- 409 overlap (payload includes conflicting `{ start_date, end_date }`) and 409 non-`Pending` decide.
- 413/400 multer from `leaveUpload` caps via friendly `multerErrorMessage` — the leave routes translate multer errors **locally** (route wrapper around `leaveUpload.array(...)`) because the central `errorHandler`'s `LIMIT_FILE_SIZE` text is conversation-flavored ("videos up to 50 MB") and would misstate the 10 MB leave cap.
- 404 for attachment index out of range and for guarded `/uploads/*` private paths.
- All routed through the central `errorHandler` (stays last).

## 9. Testing — new `scripts/testLeaveRequests.js` (repo convention: standalone Node script, real stack on :3000 + :5174)
Self-seeding via API with admin token (own dept + users created and **purged with proof**, `testTicketBadge` pattern — **no seed-script contract changes**):
1. Staff submits → row + `leave:submitted` notification row exists for the same-dept manager.
2. **Cross-dept manager gets empty pending set** (proof of server-side scoping) and 403 on decide.
3. Manager submit → 403; Read-Only submit → 403.
4. Overlap → 409 with conflicting range; non-overlapping passes.
5. Decide happy path → status/`decided_by/at`, `leave:approved`/`leave:denied` row for requester.
6. Self-decide → 403; decide twice → 409; decide after Approved → 409.
7. On-behalf: admin files for a **manager** → lands in that dept's pending inbox.
8. Managerless dept (no manager exists) → falls back to admin recipients.
9. Attachment matrix: uploader + same-dept manager 200 ✓, other-dept manager 403 ✗, anon 401 ✗, admin 200 ✓; PDF with non-`%PDF-` head rejected + file deleted from disk; **`GET /uploads/leave-requests/<file>` → 404** (guard proof); same for `/uploads/conversations/<file>` (regression proof for the fixed gap); same for `/uploads/archive/conversations/<file>` — asserted against a real archived file (proof, not a trivial 404 on a missing path — seed one by archiving a conversation first).
10. `GET /pending-count` matches inbox length for manager, 0 for Staff.
11. `GET /pending?view=decided` returns the rows decided in steps 5–6 for manager + admin ordered `decided_at DESC` and excludes still-pending rows; omitted view defaults to `pending`; `view=garbage` → 400.
12. Vocabulary contract (§3): `LEAVE_STATUSES` / `LEAVE_DECISIONS` from the validator asserted equal to the `leave_requests.status` CHECK literals read from `sqlite_master`, and `LEAVE_DECISIONS === LEAVE_STATUSES − 'Pending'`.

Also updated: `scripts/testAllApi.mjs` (hit the new endpoints' 403s for Staff/Read-Only sweeps if it enumerates them), and post-implementation re-runs of `testConversations` + `testBackupRestoreDrill` (static-guard blast radius), `npm run lint`, `npm run build`, `npm run doctor` (checks #12 layering, #13 cycles, #14 resolution, #18 semantic colors).

## 10. Considered & rejected
- **Modeling leave as tickets** — tempting ("Submitted to Manager" exists) but tickets are helpdesk-shaped: fixed status vocabulary, `assigned_admin_id`, no attachments, admin-only visibility. Wrong abstraction.
- **Flag instead of role** — rejected by user decision (User Management wouldn't render it distinctly).
- **Second notification center** — rejected; existing bell/toasts/WS/calendar cover it.
- **Storing attachments outside `uploads/`** — rejected: `backupService` only zips `uploads/`, so out-of-tree files would silently miss backups. Private-by-guard inside `uploads/` keeps backup/restore whole.
- **New date-picker dependency (react-day-picker etc.)** — rejected: theming a third-party picker to match all 20+ theme presets is strictly harder than a token-driven custom grid; also keeps `package.json` untouched.

## 11. Open questions
None blocking. Deferred backlog (§1 overview) is explicitly out of scope for this plan.
