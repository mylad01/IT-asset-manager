/**
 * Format a numeric ID with # prefix and zero-padding.
 * e.g. 1 → #001, 12 → #012, 123 → #123
 * Non-numeric values are returned as-is with # prefix.
 */
export function formatId(id) {
  if (id == null) return '#—';
  const n = Number(id);
  if (Number.isNaN(n)) return `#${id}`;
  return `#${String(n).padStart(3, '0')}`;
}

/**
 * Format a numeric ID without # prefix (for asset tag input fields).
 * e.g. 1 → 001, 12 → 012
 */
export function padId(id) {
  if (id == null) return '—';
  const n = Number(id);
  if (Number.isNaN(n)) return String(id);
  return String(n).padStart(3, '0');
}
