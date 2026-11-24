import { z } from 'zod';

const assetStatuses = ['In Storage', 'Deployed', 'In Repair', 'Retired'];
const numericId = () => z.union([z.string(), z.number()]).nullable().optional().transform(v => v != null && v !== '' ? String(v) : null);

export const createAssetSchema = z.object({
  id: z.string().min(1, 'Asset ID is required.').max(100),
  type: z.string().min(1, 'Asset type is required.').max(100),
  model: z.string().min(1, 'Model is required.').max(200),
  serial_number: z.string().max(100).optional().or(z.literal('')),
  purchase_date: z.string().max(30).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
  custom_attributes: z.string().max(5000).optional().or(z.literal('')),
  status: z.enum(assetStatuses).optional().default('In Storage'),
  dept_id: numericId(),
  assigned_to_user_id: numericId(),
});

export const transferAssetSchema = z.object({
  new_user_id: numericId(),
  new_dept_id: numericId(),
  transfer_notes: z.string().min(10, 'A detailed transfer reason is required (min 10 characters).').max(500),
});

export const addLogEntrySchema = z.object({
  notes: z.string().min(1, 'Log notes cannot be empty.').max(2000),
  action_type: z.string().max(50).optional().default('AUDIT_NOTE'),
});

export const updateAssetSchema = z.object({
  type: z.string().min(1, 'Asset type is required.').max(100).optional(),
  model: z.string().min(1, 'Model is required.').max(200).optional(),
  serial_number: z.string().max(100).optional().or(z.literal('')),
  purchase_date: z.string().max(30).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
  custom_attributes: z.string().max(5000).optional().or(z.literal('')),
  status: z.enum(assetStatuses).optional(),
  dept_id: numericId(),
  assigned_to_user_id: numericId(),
});
