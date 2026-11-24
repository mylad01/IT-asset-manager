/**
 * useTablePrefs — PLAN.MD §13 P2 Tables & Data adapter.
 *
 * Client-side table prefs (page size, column visibility) live in localStorage
 * under `studioTablePrefs` keyed by tableId — per-browser view settings, not
 * identity data, so they deliberately stay OUT of users.ui_prefs (which holds
 * registry preferences synced via the API). The registry's global `pageSize`
 * pref is the DEFAULT page size; a table's local override wins when present.
 *
 * Storage audit (doctor check #16): this module is the docstring-justified
 * SINGLE OWNER of the `studioTablePrefs` literal — the key is scoped, not
 * retired. Justification: these are per-BROWSER view settings (column
 * choices, per-table page size), meaningless on another machine and wrong
 * to sync through the per-user prefs API; the registry blob would turn a
 * viewing convenience into server state. The only cross-source read is the
 * registry DEFAULT (readStoredPrefs().pageSize) — never a write.
 *
 * Exposed to DataTable as a tiny object so the component stays dumb:
 *   { pageSize, hiddenColumns, setPageSize, toggleColumn, showAllColumns }
 */
import { useState, useCallback, useEffect } from 'react';
import { readStoredPrefs } from '../config/applyPreferences';

const STORAGE_KEY = 'studioTablePrefs';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Private mode / quota — prefs stay session-local, never fatal.
  }
}

export default function useTablePrefs(tableId) {
  const [prefs, setPrefs] = useState(() => readAll()[tableId] || {});

  useEffect(() => {
    setPrefs(readAll()[tableId] || {});
  }, [tableId]);

  const persist = useCallback((updater) => {
    setPrefs((prev) => {
      const next = updater(prev);
      const all = readAll();
      all[tableId] = next;
      writeAll(all);
      // No change event: the old table-prefs-changed dispatch had zero
      // listeners (a dead dual-write hazard the storage audit removed).
      // Each DataTable instance owns its hook; tableIds are per-table.
      return next;
    });
  }, [tableId]);

  /** Effective page size: local override → registry default (50). */
  const pageSize = prefs.pageSize ?? readStoredPrefs().pageSize ?? 50;

  const setPageSize = useCallback((n) => {
    persist((prev) => ({ ...prev, pageSize: Number(n) || undefined }));
  }, [persist]);

  const hiddenColumns = prefs.hiddenColumns || [];

  const toggleColumn = useCallback((accessorOrHeader) => {
    persist((prev) => {
      const hidden = new Set(prev.hiddenColumns || []);
      if (hidden.has(accessorOrHeader)) hidden.delete(accessorOrHeader);
      else hidden.add(accessorOrHeader);
      return { ...prev, hiddenColumns: [...hidden] };
    });
  }, [persist]);

  const showAllColumns = useCallback(() => {
    persist((prev) => ({ ...prev, hiddenColumns: [] }));
  }, [persist]);

  return { pageSize, hiddenColumns, setPageSize, toggleColumn, showAllColumns };
}
