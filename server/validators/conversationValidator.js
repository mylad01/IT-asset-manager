import { z } from 'zod';

export const createConversationSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters.').max(200),
  type: z.enum(['standalone', 'ticket-linked']).optional().default('standalone'),
  ticketId: z.union([z.string(), z.number()]).nullable().optional().transform(v => v != null && v !== '' ? Number(v) : null),
  participantIds: z.array(z.union([z.string(), z.number()])).optional().default([]).transform(arr => arr.map(Number)),
})
  // The DB CHECK enforces ticket-linked ⇒ ticket_id NOT NULL (the app's own
  // vocabulary, since the 20261005 type-vocabulary migration). Reject at the
  // edge with a 400 instead of letting SQLite answer 500 CHECK constraint
  // failed.
  .refine((v) => v.type !== 'ticket-linked' || v.ticketId != null, {
    message: 'A ticket-linked conversation needs a ticketId.',
    path: ['ticketId'],
  });

export const updateConversationSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters.').max(200),
});

export const addMessageSchema = z.object({
  // Content is optional: a message may consist of attachments only (the UI
  // enables send for photo/file-only messages). "Empty overall" (no content
  // AND no files) is rejected in the service, which can see req.files —
  // the schema cannot.
  content: z.string().max(10000).optional().default('').transform(v => (v || '').trim()),
  // multipart/form-data delivers every field as a string (FormData.append of a
  // boolean arrives as "true"/"false"), so normalize both shapes here.
  isInternal: z.union([z.boolean(), z.string()]).optional().default(false).transform(v => v === true || v === 'true'),
});

export const editMessageSchema = z.object({
  content: z.string().min(1, 'Message cannot be empty.').max(10000),
});

export const addParticipantsSchema = z.object({
  userIds: z.array(z.union([z.string(), z.number()])).min(1, 'At least one user is required.').transform(arr => arr.map(Number)),
});

export const addReactionSchema = z.object({
  emoji: z.string().min(1, 'Emoji is required.').max(10),
});

export const conversationQuerySchema = z.object({
  type: z.enum(['standalone', 'ticket-linked']).optional(),
  archived: z.enum(['true', 'false']).optional().transform(v => v === 'true' ? true : v === 'false' ? false : undefined),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});

export const messageQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});

// Root bulk ops: ids array, de-duplicated, bounded.
export const bulkIdsSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'At least one id is required.').max(100).transform((arr) => [...new Set(arr)]),
});

// GET /archive list: ids CSV or search required (enforced in the controller).
export const archiveListQuerySchema = z.object({
  ids: z.string().optional(),
  search: z.string().max(200).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});

export const exportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).optional().default('json'),
});
