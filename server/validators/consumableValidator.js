import { z } from 'zod';

export const createConsumableSchema = z.object({
  name: z.string().min(1, 'Name is required.').max(200),
  description: z.string().max(1000).optional().or(z.literal('')),
  quantity: z.number().int().min(0, 'Quantity cannot be negative.').max(100000),
  threshold: z.number().int().min(0).max(100000).optional().default(5),
});

export const adjustStockSchema = z.object({
  amount: z.number().int().min(-1000, 'Adjustment too large.').max(10000, 'Adjustment too large.'),
});
