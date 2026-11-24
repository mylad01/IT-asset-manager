export function sanitizeId(value) {
  return (value && value !== 'null' && value !== '') ? value : null;
}

export function formatTimestamp(date) {
  return new Date(date).toISOString();
}

export const ROLES = {
  STAFF: 'Staff',
  IT_ADMIN: 'IT Admin',
  READ_ONLY: 'Read-Only',
  DEPARTMENT_MANAGER: 'Department Manager',
};

export const ASSET_STATUSES = {
  IN_STORAGE: 'In Storage',
  DEPLOYED: 'Deployed',
};

export const TICKET_STATUSES = {
  SUBMITTED_TO_MANAGER: 'Submitted to Manager',
  SUBMITTED_TO_HELPDESK_ADMIN: 'Submitted to Helpdesk Administrator',
  IN_PROGRESS: 'In Progress',
  WAITING_ON_USER: 'Waiting on User',
  RESOLVED: 'Resolved',
};

export const ACTION_TYPES = {
  TRANSFER: 'TRANSFER',
  CHECK_OUT: 'CHECK_OUT',
  AUDIT_NOTE: 'AUDIT_NOTE',
};
