# Conversation Workspace — Design Spec

**Date:** 2026-09-13
**Status:** Approved
**Type:** Architectural — new subsystem

---

## 1. Overview

A real-time conversation workspace for IT admins and root admin. Supports two modes:

- **Ticket-linked conversations** — dedicated chat rooms for discussing specific tickets
- **Standalone conversations** — admin-to-admin chats outside of tickets

Slack-style layout: conversation list sidebar + active chat panel. Full real-time via WebSocket. Rich messages with file attachments, @mentions, reactions, edit/delete, and internal notes.

Staff interactions remain in the existing ticket comment system — this workspace is admin-only.

---

## 2. Database Schema

### 2.1 New Tables

```sql
-- Conversations (standalone or ticket-linked)
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'standalone' CHECK(type IN ('standalone', 'ticket-linked')),
  ticket_id INTEGER,
  created_by INTEGER NOT NULL,
  is_archived INTEGER DEFAULT 0,
  archived_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE INDEX idx_conversations_type ON conversations(type);
CREATE INDEX idx_conversations_ticket ON conversations(ticket_id);
CREATE INDEX idx_conversations_archived ON conversations(is_archived);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);

-- Conversation participants
CREATE TABLE conversation_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member' CHECK(role IN ('member', 'admin')),
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversation_id, user_id),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_conv_participants_conv ON conversation_participants(conversation_id);
CREATE INDEX idx_conv_participants_user ON conversation_participants(user_id);

-- Messages
CREATE TABLE conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  is_internal INTEGER DEFAULT 0,
  is_edited INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX idx_conv_messages_conv ON conversation_messages(conversation_id);
CREATE INDEX idx_conv_messages_user ON conversation_messages(user_id);
CREATE INDEX idx_conv_messages_created ON conversation_messages(created_at DESC);

-- Message attachments
CREATE TABLE message_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_msg_attachments_msg ON message_attachments(message_id);

-- Reactions
CREATE TABLE message_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, user_id, emoji),
  FOREIGN KEY(message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_msg_reactions_msg ON message_reactions(message_id);

-- Read tracking
CREATE TABLE conversation_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversation_id, user_id),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_conv_reads_conv ON conversation_reads(conversation_id);

-- Conversation backup logs
CREATE TABLE conversation_backup_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  size_bytes INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conv_backup_logs_created ON conversation_backup_logs(created_at DESC);
```

### 2.2 System Settings additions

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `conversation_auto_backup` | `'0'`/`'1'` | `'0'` | Enable auto-backup for conversations |
| `conversation_backup_interval` | number (hours) | `'24'` | Hours between auto-backups |

---

## 3. REST API Endpoints

### 3.1 Conversations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/conversations` | Admin | List conversations with last message preview + unread count. Query params: `type`, `archived`, `search`, `page`, `limit` |
| `POST` | `/api/conversations` | Admin | Create conversation. Body: `{ title, type, ticketId?, participantIds[] }` |
| `GET` | `/api/conversations/:id` | Participant | Get conversation details + participants |
| `PUT` | `/api/conversations/:id` | Admin | Update title. Body: `{ title }` |
| `PUT` | `/api/conversations/:id/archive` | Admin | Archive conversation |
| `PUT` | `/api/conversations/:id/unarchive` | Admin | Unarchive conversation |
| `DELETE` | `/api/conversations/:id` | Root | Delete conversation (cascades) |
| `GET` | `/api/conversations/search?q=` | Admin | Full-text search across titles + messages |

### 3.2 Participants

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/conversations/:id/participants` | Admin | Add participants. Body: `{ userIds[] }` |
| `DELETE` | `/api/conversations/:id/participants/:userId` | Admin | Remove participant |
| `GET` | `/api/conversations/:id/participants` | Participant | List participants |

### 3.3 Messages

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/conversations/:id/messages` | Participant | Paginated messages. Query: `before?` (cursor), `limit?` (default 50) |
| `POST` | `/api/conversations/:id/messages` | Participant | Send message. Body: `{ content, isInternal?, attachments[] }` |
| `PUT` | `/api/conversations/:id/messages/:msgId` | Sender | Edit own message. Body: `{ content }` |
| `DELETE` | `/api/conversations/:id/messages/:msgId` | Admin | Delete any message |
| `POST` | `/api/conversations/:id/messages/:msgId/reactions` | Participant | Add reaction. Body: `{ emoji }` |
| `DELETE` | `/api/conversations/:id/messages/:msgId/reactions/:emoji` | Participant | Remove own reaction |
| `PUT` | `/api/conversations/:id/read` | Participant | Mark conversation as read |

### 3.4 Attachments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/conversations/:id/messages/:msgId/attachments` | Participant | Upload file (multer, max 10MB, 5 files) |
| `GET` | `/api/conversations/attachments/:filename` | Participant | Serve attachment file |

### 3.5 Backup & Export

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/conversations/backup` | Root | Manual backup to UNC path |
| `GET` | `/api/conversations/backup/history` | Root | Backup log history |
| `GET` | `/api/conversations/:id/export?format=` | Root | Export single conversation (csv/json) |
| `GET` | `/api/conversations/export-all?format=` | Root | Bulk export all conversations |

### 3.6 File Structure

```
server/
  routes/conversationRoutes.js
  controllers/conversationController.js
  services/conversationService.js
  services/conversationBackupService.js
  models/conversationModel.js
  models/conversationMessageModel.js
  models/conversationParticipantModel.js
  validators/conversationValidator.js
```

### 3.7 Middleware Chain Pattern

```js
// Example: send message
router.post('/:id/messages',
  verifyToken,
  requireAdmin,
  writeLimiter,
  validate(addMessageSchema),
  upload.array('attachments', 5),
  conversationController.sendMessage
);

// Example: create conversation
router.post('/',
  verifyToken,
  requireAdmin,
  writeLimiter,
  validate(createConversationSchema),
  conversationController.createConversation
);
```

---

## 4. WebSocket Events

Extends existing `wsServer.js` — no new infrastructure.

### 4.1 Server → Client

| Event | Payload | When |
|-------|---------|------|
| `conversation:message` | `{ conversationId, message: { id, userId, userName, content, isInternal, createdAt }, senderId }` | New message sent |
| `conversation:typing` | `{ conversationId, userId, userName }` | User typing (debounced 3s) |
| `conversation:read` | `{ conversationId, userId, lastReadAt }` | User read up to timestamp |
| `conversation:reaction-added` | `{ conversationId, messageId, emoji, userId, userName }` | Reaction added |
| `conversation:reaction-removed` | `{ conversationId, messageId, emoji, userId }` | Reaction removed |
| `conversation:archived` | `{ conversationId }` | Conversation archived |
| `conversation:unarchived` | `{ conversationId }` | Conversation unarchived |
| `conversation:created` | `{ conversation: { id, title, type, createdBy } }` | New conversation created |
| `conversation:participants-changed` | `{ conversationId, added: [], removed: [] }` | Participants changed |

### 4.2 Client → Server

| Event | Payload | When |
|-------|---------|------|
| `conversation:join` | `{ conversationId }` | User opens a conversation |
| `conversation:leave` | `{ conversationId }` | User navigates away |
| `conversation:typing` | `{ conversationId }` | User starts typing (throttled) |

### 4.3 Room Management

- Server maintains `conversationRooms` Map: `conversationId → Set<WebSocket>`
- `conversation:message` broadcasts to all sockets in that room
- `conversation:typing` broadcasts to room except sender
- Online presence: existing `userSockets` Map (userId → Set<WebSocket>)

---

## 5. Frontend Components

### 5.1 New Files

```
src/pages/ConversationWorkspace.jsx
src/components/conversations/
  ConversationSidebar.jsx
  ConversationList.jsx
  ConversationItem.jsx
  ChatPanel.jsx
  ChatHeader.jsx
  ChatMessages.jsx
  ChatMessage.jsx
  ChatInput.jsx
  TypingIndicator.jsx
  ParticipantBadge.jsx
  ConversationSearch.jsx
```

### 5.2 Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Sidebar 300px]  │  [Chat Panel - flex-1]              │
│                   │                                     │
│  🔍 Search...     │  Chat Header                       │
│  ─────────────    │  ───────────────────────────────    │
│  ▸ Active (5)     │  👤 Alice, Bob, Charlie   [⋯]      │
│    ┌──────────┐   │                                     │
│    │ Camera.. │   │  ┌─────────────────────────────┐   │
│    │ Latest m…│   │  │ Alice          10:32 AM     │   │
│    │      🔴3 │   │  │ Hey, the camera dept has   │   │
│    ├──────────┤   │  │ issues with the RED...      │   │
│    │ Workst.. │   │  │                    👍 2     │   │
│    │ I'll ch… │   │  └─────────────────────────────┘   │
│    │          │   │                                     │
│    ├──────────┤   │  ┌─────────────────────────────┐   │
│    │ Standalone│   │  │ You           10:35 AM  ✏️ │   │
│    │ Meeting.. │   │  │ I'll check the inventory   │   │
│    │      🔴1 │   │  │ next. @Bob can you assist? │   │
│    └──────────┘   │  │              🔥 1  ✅ 1    │   │
│                   │  └─────────────────────────────┘   │
│  ▸ Archived (2)   │                                     │
│    ┌──────────┐   │  ┌─────────────────────────────┐   │
│    │ Old tic.. │   │  │ 🔒 Internal Note — Alice   │   │
│    └──────────┘   │  │ Budget approved for new...  │   │
│                   │  └─────────────────────────────┘   │
│                   │                                     │
│                   │  ┌─────────────────────────────┐   │
│                   │  │ Type a message...  📎 🔒 ➤ │   │
│                   │  └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 5.3 Animations (Framer Motion)

| Element | Animation |
|---------|-----------|
| Sidebar items | `staggerChildren` on list, `slide-in` from left |
| New message | `AnimatePresence` + slide up + fade in |
| Typing indicator | 3 bouncing dots, spring animation |
| Message hover | Subtle lift + show timestamp + edit/delete actions |
| Reaction add | Pop-in scale bounce (0 → 1.2 → 1) |
| Unread badge | Pulse glow animation on new message |
| Conversation switch | Crossfade between chat panels |
| Archive action | Slide out + fade, expand archived section |
| Search results | Staggered fade-in |
| File upload | Progress bar with shimmer |
| Internal note | Amber left border, glassmorphism tint |

### 5.4 Glassmorphism Styling

- Sidebar: `.glass-sidebar` class (existing)
- Chat panel: `glass-card` background
- Messages: own = indigo-tinted glass, others = default glass
- Internal notes: amber-tinted glass with lock icon
- Input area: `glass-strong` with blur
- Reactions: small `glass-badge` pills on hover

### 5.5 Route Registration

- Add `/conversations` route to `App.jsx` — admin-only (IT Admin + Root)
- Sidebar nav item: "Conversations" with `MessageSquare` icon (violet-300)
- Badge on nav item shows total unread count

---

## 6. Data Flow & Integration

### 6.1 Ticket-Linked Conversations

When an IT admin clicks "Start Conversation" on a ticket:
1. Creates conversation with `type: 'ticket-linked'`, `ticket_id` set
2. Auto-adds ticket submitter + assigned admin + root admin as participants
3. Title set from ticket title (e.g., "RE: Camera Dept RED issues")
4. Ticket link badge in chat header → clickable to open ticket detail

When ticket status changes → system message in conversation: "Ticket status changed to In Progress"

### 6.2 Notification Integration

- New message → existing `notificationEvents.js` system
- New event types: `conversation:message`, `conversation:mentioned`
- @mention triggers: extract `@username` from content → notify that user
- WebSocket pushes unread badge update to all participants

### 6.3 Activity Log Integration

- Conversation creation, archival, deletion logged to `activity_logs`
- Entity type: `'conversation'`
- Actions: `'create'`, `'archive'`, `'unarchive'`, `'delete'`

### 6.4 Role Permissions

| Action | IT Admin | Root Admin |
|--------|----------|------------|
| Create conversation | ✓ | ✓ |
| Add/remove participants | ✓ | ✓ |
| Send messages | ✓ | ✓ |
| Send internal notes | ✓ | ✓ |
| Edit own messages | ✓ | ✓ |
| Delete any message | ✓ | ✓ |
| Archive/unarchive | ✓ | ✓ |
| Delete conversation | ✗ | ✓ |
| Bulk export | ✗ | ✓ |
| Manual backup | ✗ | ✓ |
| Configure auto-backup | ✗ | ✓ |

---

## 7. Backup, Archive & Export

### 7.1 Conversation Backup

- New `conversation_backup_logs` table (same structure as `backup_logs`)
- `POST /api/conversations/backup` — root admin triggers manual backup
- Uses SQLite Backup API → ZIP with attachments from `uploads/conversations/`
- Saved to same UNC path configured in Settings (`backup_path`)
- Filename: `conversations-backup-{timestamp}.zip`
- Real-time progress via WebSocket (same pattern as existing backup)

### 7.2 Auto-Backup Scheduler

- Settings keys: `conversation_auto_backup`, `conversation_backup_interval`
- On server boot + after each backup: check if enabled + interval elapsed → trigger
- Settings panel: toggle + interval input + manual backup button + progress bar

### 7.3 Conversation Archival

- `is_archived` + `archived_at` fields on `conversations` table
- Archived conversations: separate "Archived" section in sidebar (collapsed)
- Messages become read-only (no new messages, no reactions)
- Still searchable and accessible
- Can be unarchived by admin

### 7.4 Chat History Access

- `GET /api/conversations/:id/messages` — cursor-based pagination (newest first)
- Messages include: sender info, attachments, reactions, internal flag, edit status
- `GET /api/conversations` — list with last message preview + unread count
- `GET /api/conversations/search?q=` — full-text search across titles + messages

### 7.5 Export

- Single conversation: CSV (timestamp, sender, message, internal, attachments) or JSON
- Bulk export: all conversations (root admin only)
- Download as file attachment (same pattern as activity log CSV)

### 7.6 Database Hardening

- Indexes on all foreign keys + `created_at`
- `ON DELETE CASCADE` for message cascades
- `CHECK` constraints on type/role fields
- WAL mode + busy_timeout (global config)
- Conversation tables included in main database backup

---

## 8. File Upload

- Storage: `uploads/conversations/{conversationId}/`
- Multer config: max 10MB per file, max 5 files per message
- Allowed types: images (jpg, png, gif, webp), PDFs, documents (doc, docx, txt)
- Filenames: `{timestamp}-{random}.{ext}` to avoid conflicts
- Served statically at `/api/conversations/attachments/{filename}`
- Cleanup: when message is deleted, delete associated files from disk

---

## 9. Migration File

Single migration: `server/db/migrations/YYYYMMDDHHMMSS-conversation-workspace.js`

Creates all 7 tables + indexes + system_settings seeds. Includes `down()` to drop all tables.

---

## 10. Success Criteria

1. Admins can create standalone or ticket-linked conversations
2. Messages appear in real-time via WebSocket
3. Typing indicators work
4. Unread badges update live
5. File attachments upload and display correctly
6. @mentions notify the mentioned user
7. Reactions can be added/removed
8. Internal notes visible only to IT Admins+
9. Messages can be edited/deleted
10. Conversations can be archived/unarchived
11. Chat history is searchable
12. Conversations can be exported (CSV/JSON)
13. Conversation backup works to UNC path
14. Auto-backup scheduler runs on configured interval
15. All existing tests continue to pass
16. Lint passes with no errors
