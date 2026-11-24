import { z } from 'zod';

const kitItemSchema = z.object({
  asset_type: z.string().min(1, 'Asset type is required.').max(100),
  quantity: z.number().int().min(1, 'Quantity must be at least 1.').max(500),
});

export const createKitSchema = z.object({
  name: z.string().min(1, 'Kit name is required.').max(200),
  description: z.string().max(1000).optional().or(z.literal('')),
  items: z.array(kitItemSchema).min(1, 'At least one kit item is required.').max(50),
});

export const deployKitSchema = z.object({
  user_id: z.union([z.string(), z.number()]).transform(v => String(v)),
  dept_id: z.union([z.string(), z.number(), z.null()]).transform(v => v == null ? null : String(v)),
  asset_selections: z.record(z.string(), z.array(z.string())).optional(),
});
