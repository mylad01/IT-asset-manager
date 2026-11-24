# Conversation v2 — Implementation Reference (2026-09-17)

Status: **implemented and verified**. All phases of the approved plan are complete.
Test suites: `testArchive` 12/12, `testAttachments` 11/11, `testConversations` 15/15,
`testConversationBackup` 5/5, `testMentions` 9/9, `testSecurity` all green.

## Architecture

### Hard-move archive (replaces flag-based archiving)

- `server/db/archiveDb.js` — a dedicated SQLite file (`<db-basename>-conversations-archive.sqlite`,
  derived from `DB_PATH`) holding archived **and** soft-deleted conversations.
  Schema mirrors the active conversation tables **plus** lifecycle columns on `conversations`:
  `archived_at / archived_by / archive_reason` (archive) and `deleted_at / deleted_by` (recycle bin).
  IDs are preserved on move, so restore is a pure inverse and deep links stay stable.
- `server/services/conversationArchiveService.js` — the engine:
  `archiveConversation` (copy rows in → delete from active → move files → VACUUM debounce),
  `restoreConversation` (transactional copy-out in FK-safe order: messages **before**
  attachments/reactions), `softDeleteConversation` (recycle bin, forwards the tombstone),
  `purgeArchivedConversation`, `purgeExpiredDeleted` (retention), `runAutoArchiveOnce`
  (idle auto-archive + retention purge + quota warning), `getStorageStats`.
- Files move between `uploads/conversations/` and `uploads/archive/conversations/`; paths stored in
  the DB are canonical uploads-relative (`server/utils/uploadPaths.js`) so they survive moves.

### Key invariants

1. **The archive DB has no `users` table.** Never join `users` on the archive connection —
   name enrichment (`user_name`, participant names, `archived_by_name`) happens in
   `conversationService` against the live DB. This caused two 500 bugs during development.
2. **Child-row insert order matters.** Active DB has FKs ON: when copying rows *out* of the
   archive, insert messages first, then attachments/reactions. Restore is wrapped in a
   transaction so a failure never leaves a half-restored conversation.
3. **Restore is root-only.** After archiving there is no participant roster in the active DB,
   so `requireMembership` cannot be evaluated — the route is `PUT /:id/unarchive` with `requireRoot`.
4. **Membership is enforced everywhere** (`server/middleware/conversationAuth.js`): participants
   full access, root bypasses (that IS oversight), everyone else 403. Archived conversations are
   root-only; `req.fromArchive` flags read-only serving; `rejectArchived` returns 409 on writes.
   The attachment-streaming route (`GET /messages/:msgId/attachments/:attachmentId`) sits outside
   the `/:id` namespace, so it uses `requireMessageMembership` — the same policy resolved from the
   message id (active DB first, then archive; archived messages are root-only, matching the
   recycle-bin surface). The controller no longer hand-rolls the check.

### Media

- Uploads via `server/config/conversationUpload.js`: strict mime allowlist (images, video,
  common files), per-kind size caps, `MAX_FILES` export (defined **before** use — module
  initialization order bug was fixed once already), size re-check in the controller because
  multer's `file.size` is unreliable in `fileFilter`.
- Serving: authenticated, membership-checked `GET /api/conversations/messages/:msgId/attachments/:attachmentId`
  with Range support. URLs in message payloads are relative; the frontend resolves them.
- UI: `AttachmentCard` / `MediaGallery` inline rendering, `Lightbox` (zoom, prev/next,
  keyboard), drag-drop + paste in `ChatInput` with XHR upload progress.

### Oversight (root)

`GET /conversations/oversight` + `/oversight/summary` + `/storage-stats`; audit-logged access
via `POST /:id/oversight-view`; message tombstones (`deleted_at` on messages, filtered everywhere);
UI in `OversightPanel.jsx` with join-to-participate.

### Lifecycle

Recycle bin: root `DELETE /:id` → archive DB with tombstone, restorable for
`conversation_retention_days` (default 30), purged by the scheduler with a summary notification.
Settings keys (defaults seeded by migration `20260917000001-conversation-v2.js`):
`conversation_auto_archive_enabled`, `conversation_auto_archive_days`, `conversation_retention_days`.

### Backup

`runConversationBackup` ZIP now contains `conversations.sqlite`,
`conversations-archive.sqlite` (online backup via `src.backup(stagingPath)` — do NOT pre-open the
destination, it deadlocks SQLITE_BUSY), `uploads/` and `uploads-archive/` trees.

## Routes layout (conversationRoutes.js)

Non-parameterized routes MUST precede `/:id`. Bulk ops under `/bulk/*`. Attachment streaming under
`/messages/:msgId/attachments/:attachmentId` to avoid colliding with the `/:id` namespace.
Conversation backup endpoints: `POST /backup`, `GET /backup/history` (root).

## Tests

- `scripts/testArchive.js` — hard-move, restore, recycle bin, oversight, storage stats, bulk ZIP.
- `scripts/testAttachments.js` — upload allowlist, video, membership 403, URL shape.
- `scripts/testConversations.js` — updated for hard-move semantics (active list no longer shows
  archived conversations; `?archived=true` is gone; unarchive is root-only).
- `scripts/testConversationBackup.js` — updated to expect the archive snapshot in the ZIP.

## Performance: hard-move archive at scale (benchmarked 2026-09-18)

Benchmark: `scripts/.runtime/bench-archive.mjs` — builds a 12k-message conversation
(1.2k reactions, 240 attachments, reads, participants) and times each phase.
Run with `BENCH_KEEP=1` to keep the conversation for repeat runs.

| Phase | Before | After |
|---|---|---|
| archive (hard-move) | 717 ms | **294 ms** |
| restore (hard-move) | 745–776 ms | **288 ms** |
| archived API read (page of 50) | 125 ms, unbounded payload | **2 ms, ≤100 rows** |
| archive list query | 2 ms | 2 ms |

Two optimizations made this happen:

1. **Bulk multi-VALUES inserts** in `copyConversationIn` / `copyConversationOut`
   (`bulkInsert` helper in `archiveDb.js`). The old loop did one awaited `stmt.run` per row
   (~50 µs of driver round-trips each → ~700 ms per move at 12k rows). Batches are sized to
   stay under SQLite's legacy 999-variable limit (`900 / columns.length` rows per statement).
2. **Archived message reads are paginated** like the active path (`limit` ≤ 100 + id-based
   `before` cursor, newest page first, reversed to ASC). Previously the archive branch of
   `getMessages` returned EVERY row in one JSON response — a multi-MB payload at 10k+.
   `archiveDb.getMessages(id, { limit: null })` still means "full history" for the
   export path / `getArchivedConversation`.

VACUUM after archive batches remains debounced (10 s) and off the request path by design.
