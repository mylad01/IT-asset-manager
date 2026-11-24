// Mention extraction: resolves "@Full Name" tokens in message content against
// the conversation's participant roster. The client inserts mentions as
// `@<participant.name> ` (names may contain spaces — e.g. "Ann-Marie Lee"),
// so a naive /\B@\w+/ regex would truncate at the first space. Matching is
// therefore longest-name-first over the roster instead of tokenising content.

/**
 * Resolve @name mentions in content against a roster of users.
 * @param {string} content - raw message content
 * @param {Array<{id: number|string, name: string}>} roster - candidate users
 *   (typically the conversation's participants)
 * @returns {Array<number|string>} ids of mentioned users, deduped, roster order
 */
export function resolveMentions(content, roster) {
  if (!content || !Array.isArray(roster) || roster.length === 0) return [];

  const mentioned = [];
  for (const user of roster) {
    if (!user || user.name == null || user.id == null) continue;
    const escaped = String(user.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Delimiters stop the match so "@Ann" never matches inside "@Ann-Marie".
    const re = new RegExp(`(^|\\s)@${escaped}(?=$|[\\s.,;:!?)\\]])`, 'u');
    if (re.test(content)) mentioned.push(user.id);
  }
  return [...new Set(mentioned)];
}

/**
 * Mention tokens found in content that match no roster user — surfaced in
 * the message payload so the UI can grey out stale/unresolvable names.
 * @param {string} content
 * @param {Array<{name: string}>} roster
 * @returns {string[]} the "@Name" tokens that resolved to nobody
 */
export function findUnresolvedMentions(content, roster) {
  if (!content) return [];
  const names = (Array.isArray(roster) ? roster : [])
    .map(u => u?.name)
    .filter(Boolean);
  const tokens = content.match(/(^|\s)@[^\s@][^\s]*/gu) || [];
  const cleaned = tokens.map(t => t.trim().replace(/^@/, ''));
  return [...new Set(cleaned.filter(name => !names.includes(name)))];
}
