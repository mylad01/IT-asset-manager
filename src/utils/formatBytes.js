// formatBytes.js — shared human-readable byte formatter for the
// conversation UI (attachment cards, lightbox, chat input, archive browser,
// oversight panel). One definition instead of five near-identical locals.
export default function formatBytes(b) {
  if (b == null) return '';
  if (b === 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
