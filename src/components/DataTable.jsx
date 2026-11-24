import React, { useState, useMemo, useEffect } from 'react';
import { Search, ChevronLeft, ChevronRight, Columns3 } from 'lucide-react';
import useTablePrefs from '../hooks/useTablePrefs';
import usePrefsVersion from '../hooks/usePrefsVersion';
import { readStoredPrefs } from '../config/applyPreferences';
import ScrollArea from './glass/ScrollArea';

export default function DataTable({ columns = [], data = [], searchPlaceholder = 'Search...', highlightId = null, sortBy = null, tableId = null }) {
  const [searchTerm, setSearchTerm] = useState('');
  // P2 Tables & Data (PLAN.MD §13): page size + column visibility via the
  // useTablePrefs adapter. tableId is optional — without it the table keeps
  // its classic no-paging behavior (all rows) except the global page size.
  const tablePrefs = useTablePrefs(tableId);
  // Live reactivity: a prefs-changed bump re-renders this table, so the
  // render-time readHiddenTotals() below always reflects the current blob
  // (same-tab toggles AND cross-tab storage events).
  usePrefsVersion();
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [page, setPage] = useState(1);

  const filteredData = useMemo(() => {
    const rows = Array.isArray(data) ? data : [];
    let result = rows.filter(row => {
      if (!row) return false;
      return Object.values(row).some(val =>
        val !== null && val !== undefined && String(val).toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
    if (sortBy) {
      result = [...result].sort((a, b) => {
        const va = a[sortBy];
        const vb = b[sortBy];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return va - vb;
        return String(va).localeCompare(String(vb));
      });
    }
    return result;
  }, [data, searchTerm, sortBy]);

  // ── Paging (client-side; only when a page size is in effect) ──────────
  const pageSize = tableId ? tablePrefs.pageSize : 0; // 0 = show all (classic behavior)
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(filteredData.length / pageSize)) : 1;
  useEffect(() => { setPage(1); }, [searchTerm, pageSize, data.length]);
  const pagedData = pageSize > 0
    ? filteredData.slice((page - 1) * pageSize, page * pageSize)
    : filteredData;

  // ── Column visibility ─────────────────────────────────────────────────
  const visibleColumns = tableId
    ? columns.filter((c) => !tablePrefs.hiddenColumns.includes(c.accessor ?? c.header))
    : columns;

  return (
    <div className="w-full">
      <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="glass-input pl-10"
          />
        </div>
        {tableId && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setColumnPickerOpen((o) => !o)}
              className="glass-btn p-2 text-xs flex items-center gap-1.5"
              title="Columns"
              aria-expanded={columnPickerOpen}
            >
              <Columns3 size={14} />
            </button>
            {columnPickerOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 glass-modal p-3 w-52 animate-glass-in">
                <p className="text-[11px] font-bold tt-label uppercase mb-2">Visible columns</p>
                <ScrollArea contentClassName="space-y-1.5 max-h-52">
                  {columns.map((c) => {
                    const key = c.accessor ?? c.header;
                    const checked = !tablePrefs.hiddenColumns.includes(key);
                    return (
                      <label key={key} className="flex items-center gap-2 text-sm tt cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => tablePrefs.toggleColumn(key)}
                          className="accent-[color:var(--status-info-strong)]"
                        />
                        {c.header || String(key)}
                      </label>
                    );
                  })}
                </ScrollArea>
                <button
                  type="button"
                  onClick={tablePrefs.showAllColumns}
                  className="mt-2 text-[11px] tt-muted hover:tt underline"
                >
                  Show all
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Result count — hideable via the registry's hideColumnTotals pref. */}
      {tableId && !(readHiddenTotals()) && (
        <div className="px-4 pb-1 -mt-1 text-[11px] tt-label">
          {filteredData.length} result{filteredData.length === 1 ? '' : 's'}
        </div>
      )}

      <ScrollArea>
        <table className="w-full min-w-[600px] text-left border-collapse glass-table">
          <thead>
            <tr>
              {visibleColumns.map((col, idx) => (
                <th key={idx}>{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedData.length > 0 ? (
              pagedData.map((row, rowIndex) => (
                <tr key={row.id || rowIndex} className={highlightId && String(row.id) === String(highlightId) ? 'animate-row-highlight' : ''}>
                  {visibleColumns.map((col, colIndex) => (
                    <td key={colIndex}>
                      {col.render ? col.render(row, rowIndex) : (row[col.accessor] !== undefined ? row[col.accessor] : '')}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={visibleColumns.length} className="p-8 text-center text-white/30 text-sm italic">
                  No records available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>

      {pageSize > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
          <p className="text-xs tt-muted">
            Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, filteredData.length)} of {filteredData.length}
          </p>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="glass-btn p-1.5 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Previous page">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs tt-sec px-2">Page {page} of {totalPages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="glass-btn p-1.5 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Next page">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* * Inline read of the hideColumnTotals registry pref (kept tiny to avoid a
 * context dependency here; the pref has no DOM attribute by design). Reads
 * through the ONE prefs accessor — no hand-rolled localStorage parsing. */
function readHiddenTotals() {
  try {
    return readStoredPrefs().hideColumnTotals === true;
  } catch {
    return false;
  }
}
