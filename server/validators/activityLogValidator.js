import { z } from 'zod';

export const queryLogsSchema = z.object({
  entity_type: z.enum(['asset', 'ticket', 'consumable', 'user', 'kit']).optional(),
  action: z.enum(['create', 'update', 'delete', 'transfer', 'assign', 'dispatch', 'status_change', 'comment', 'audit_note', 'stock_adjust']).optional(),
  user_id: z.coerce.number().int().positive().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});
