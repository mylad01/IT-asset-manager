import { z } from 'zod';

const ticketStatuses = ['Submitted to Manager', 'Submitted to Helpdesk Administrator', 'In Progress', 'Waiting on User', 'Resolved'];
const ticketPriorities = ['Low', 'Medium', 'High', 'Critical'];
const numericId = () => z.union([z.string(), z.number()]).nullable().optional().transform(v => v != null && v !== '' ? String(v) : null);

export const createTicketSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters.').max(200),
  description: z.string().min(10, 'Description must be at least 10 characters.').max(5000),
  category: z.string().min(1, 'Category is required.').max(100),
  priority: z.enum(ticketPriorities).optional().default('Medium'),
  asset_id: z.string().nullable().optional(),
  assigned_admin_id: numericId(),
});

export const assignAdminSchema = z.object({
  assigned_admin_id: numericId(),
});

export const updateTicketStatusSchema = z.object({
  status: z.enum(ticketStatuses, {
    errorMap: () => ({ message: 'Status must be one of: Submitted to Manager, Submitted to Helpdesk Administrator, In Progress, Waiting on User, Resolved.' }),
  }),
});

export const addCommentSchema = z.object({
  text: z.string().min(1, 'Comment text is required.').max(5000),
  is_internal: z.boolean().optional().default(false),
});
