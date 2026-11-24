import { z } from 'zod';

const validRoles = ['Staff', 'IT Admin', 'Read-Only', 'Department Manager'];
const numericId = () => z.union([z.string(), z.number()]).nullable().optional().transform(v => v != null && v !== '' ? String(v) : null);

export const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required.').max(100),
  email: z.string().email('A valid email address is required.').max(255),
  role: z.enum(validRoles, { errorMap: () => ({ message: 'Role must be Staff, IT Admin, Read-Only, or Department Manager.' }) }),
  password: z.string().min(8, 'Password must be at least 8 characters long.').max(128),
  dept_id: numericId(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1, 'Name is required.').max(100),
  email: z.string().email('A valid email address is required.').max(255),
  role: z.enum(validRoles, { errorMap: () => ({ message: 'Role must be Staff, IT Admin, Read-Only, or Department Manager.' }) }),
  password: z.string().min(8, 'Password must be at least 8 characters long.').max(128).optional().or(z.literal('')),
  dept_id: numericId(),
});
