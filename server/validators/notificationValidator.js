import { z } from 'zod';

export const calendarQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  day: z.coerce.number().int().min(1).max(31).optional(),
});

export const searchQuerySchema = z.object({
  query: z.string().max(200).optional(),
  type: z.enum(['ticket', 'asset', 'consumable', 'auth', 'backup', 'system']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
