// serializeFlags.js — the conversation API's boolean serialization boundary.
//
// SQLite has no boolean type: the 0/1 INTEGER flags on `conversations`
// (is_archived) and `conversation_messages` (is_internal, is_edited) come back
// from the driver as numbers, so JSON carries them as `0`/`1` and every client
// that treats them as booleans has to guess. (React makes the cost visible:
// `{0 && <X/>}` renders a literal "0" — the stray-zero bug.) Rows crossing the
// model → controller / WebSocket boundary are normalized HERE, once, so HTTP
// responses, WS broadcasts and export payloads all declare real booleans.
//
// Scope: READ / serialization paths only. Code that BINDS values back into
// SQL (archive copy in/out, bulk inserts) must keep using the raw row — those
// paths rely on the literal 0/1 columns and never go through these helpers.

/** SQLite / driver value → real boolean. */
export function toBool(value) {
  return value === 1 || value === '1' || value === true;
}

/**
 * Copy of `row` with each key in `keys` coerced to a boolean. Keys the query
 * did not select are left absent — a projection that omits `is_archived` must
 * not grow an invented `is_archived: false`.
 */
export function withBoolFlags(row, keys) {
  if (!row) return row;
  const out = { ...row };
  for (const key of keys) {
    if (key in out) out[key] = toBool(out[key]);
  }
  return out;
}

/** Array convenience for the db.all() paths. */
export function withBoolFlagsAll(rows, keys) {
  return rows.map((row) => withBoolFlags(row, keys));
}

/** conversations.is_archived */
export const CONVERSATION_FLAGS = ['is_archived'];
/** conversation_messages.is_internal / is_edited */
export const MESSAGE_FLAGS = ['is_internal', 'is_edited'];
