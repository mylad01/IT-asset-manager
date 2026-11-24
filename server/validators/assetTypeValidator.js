import { z } from 'zod';

export const createAssetTypeSchema = z.object({
  name: z.string().min(1, 'Asset type name is required.').max(200),
});
