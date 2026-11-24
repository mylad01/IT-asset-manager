import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Download, ShieldCheck, Clock, User, HardDrive, ChevronLeft, ChevronRight, X, Ticket, Package, Users, Box } from 'lucide-react';
import api from '../utils/apiClient';
import ScrollArea from '../components/glass/ScrollArea';
import { formatId } from '../utils/formatId';
import { useHighlight } from '../hooks/useHighlight';
import { getStoredToken } from '../utils/appStorage';
import useTablePrefs from '../hooks/useTablePrefs';
import toast from 'react-hot-toast';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const ENTITY_ICONS = {
  asset: HardDrive,
  ticket: Ticket,
  consumable: Package,
  user: Users,
  kit: Box,
};

const ACTION_COLORS = {
  create: 'glass-badge-green',
  update: 'glass-badge-blue',
  delete: 'glass-badge-red',
  transfer: 'glass-badge-yellow',
  assign: 'glass-badge-purple',
  status_change: 'glass-badge-cyan',
  audit_note: 'glass-badge-gray',
  stock_adjust: 'glass-badge-orange',
};

const ACTION_LABELS = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  transfer: 'Transferred',
  assign: 'Assigned',
  status_change: 'Status Changed',
  audit_note: 'Audit Note',
  stock_adjust: 'Stock Adjusted',
};

function formatChanges(changes) {
  if (!changes) return null;
  try {
    const parsed = typeof changes === 'string' ? JSON.parse(changes) : changes;
    return Object.entries(parsed).map(([field, { old: oldVal, new: newVal }]) => {
      const oldStr = oldVal === null || oldVal === undefined ? '-' : String(oldVal);
      const newStr = newVal === null || newVal === undefined ? '-' : String(newVal);
      return (
        <span key={field} className="inline-flex items-center gap-1 text-xs mr-3 mb-1">
          <span className="tt-label font-medium">{field}:</span>
          <span className="text-[color:var(--status-danger)]/80 line-through">{oldStr}</span>
          <span className="tt-muted">&rarr;</span>
          <span className="text-[color:var(--status-success)]/80">{newStr}</span>
        </span>
      );
    });
  } catch {
    return <span className="text-xs tt-muted">{String(changes)}</span>;
  }
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default function ActivityLog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [filterUsers, setFilterUsers] = useState([]);
  const { highlightedId } = useHighlight();
  // P2 Tables & Data: the registry's pageSize pref (via useTablePrefs' local
  // override layer) replaces the hardcoded 50-row page.
  const tablePrefs = useTablePrefs('activity-log');

  const [filters, setFilters] = useState({
    entity_type: searchParams.get('entity_type') || '',
    action: searchParams.get('action') || '',
    user_id: searchParams.get('user_id') || '',
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
    search: searchParams.get('search') || '',
    page: parseInt(searchParams.get('page')) || 1,
  });

  const updateFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({ entity_type: '', action: '', user_id: '', from: '', to: '', search: '', page: 1 });
  };

  const hasActiveFilters = filters.entity_type || filters.action || filters.user_id || filters.from || filters.to || filters.search;

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (filters.entity_type) params.set('entity_type', filters.entity_type);
    if (filters.action) params.set('action', filters.action);
    if (filters.user_id) params.set('user_id', filters.user_id);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.search) params.set('search', filters.search);
    params.set('page', filters.page);
    params.set('limit', tablePrefs.pageSize);

    setSearchParams(Object.fromEntries(params), { replace: true });

    const { ok, data } = await api.get(`/api/activity-logs?${params.toString()}`, { showToast: false });
    if (ok && data) {
      setLogs(data.logs || []);
      setPagination(data.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 });
    } else {
      setLogs([]);
    }
    setIsLoading(false);
  }, [filters, setSearchParams, tablePrefs.pageSize]);

  const fetchFilterOptions = useCallback(async () => {
    const { ok, data } = await api.get('/api/activity-logs/filters', { showToast: false });
    if (ok && data) {
      setFilterUsers(data.users || []);
    }
  }, []);

  useEffect(() => { fetchFilterOptions(); }, [fetchFilterOptions]);
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (filters.entity_type) params.set('entity_type', filters.entity_type);
    if (filters.action) params.set('action', filters.action);
    if (filters.user_id) params.set('user_id', filters.user_id);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.search) params.set('search', filters.search);

    const token = getStoredToken();
    try {
      const response = await fetch(`${BASE_URL}/api/activity-logs/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `activity_log_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        toast.error('Failed to export activity log');
      }
    } catch {
      toast.error('Failed to export activity log');
    }
  };

  const goToPage = (page) => {
    setFilters(prev => ({ ...prev, page }));
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-10">
        <div className="h-12 bg-white/5 rounded-lg animate-pulse" />
        <div className="glass-card p-6 space-y-4">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-white/10 pb-4 gap-4">
        <div>
          <h1 className="text-3xl font-black tt text-glow flex items-center gap-3">
            <ShieldCheck className="text-[color:var(--ui-indigo)]" /> Activity Log
          </h1>
          <p className="tt-label mt-1 font-medium">
            Comprehensive audit trail of all system operations. {pagination.total.toLocaleString()} total entries.
          </p>
        </div>
        <button onClick={exportCsv} className="glass-btn glass-btn-indigo flex items-center gap-2 px-4 py-2.5 text-xs">
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className="glass-card p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Search size={16} className="tt-muted shrink-0" />
            <input
              type="text"
              placeholder="Search users, entities, changes..."
              value={filters.search}
              onChange={e => updateFilter('search', e.target.value)}
              className="glass-input border-0 bg-transparent px-0 text-sm flex-1 min-w-0"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filters.entity_type}
              onChange={e => updateFilter('entity_type', e.target.value)}
              className="glass-input text-sm py-2 px-2 flex-1 min-w-[120px]"
            >
              <option value="">All Entities</option>
              <option value="asset">Assets</option>
              <option value="ticket">Tickets</option>
              <option value="consumable">Consumables</option>
              <option value="user">Users</option>
              <option value="kit">Kits</option>
            </select>

            <select
              value={filters.action}
              onChange={e => updateFilter('action', e.target.value)}
              className="glass-input text-sm py-2 px-2 flex-1 min-w-[120px]"
            >
              <option value="">All Actions</option>
              <option value="create">Created</option>
              <option value="update">Updated</option>
              <option value="delete">Deleted</option>
              <option value="transfer">Transferred</option>
              <option value="assign">Assigned</option>
              <option value="status_change">Status Changed</option>
              <option value="audit_note">Audit Note</option>
              <option value="stock_adjust">Stock Adjusted</option>
            </select>

            <select
              value={filters.user_id}
              onChange={e => updateFilter('user_id', e.target.value)}
              className="glass-input text-sm py-2 px-2 flex-1 min-w-[120px]"
            >
              <option value="">All Users</option>
              {[...new Map(filterUsers.map(u => [u.user_id, u])).values()].map(u => (
                <option key={u.user_id} value={u.user_id}>{u.user_name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={filters.from}
              onChange={e => updateFilter('from', e.target.value)}
              className="glass-input text-sm py-2 px-2 flex-1 min-w-[130px]"
              placeholder="From"
            />
            <input
              type="date"
              value={filters.to}
              onChange={e => updateFilter('to', e.target.value)}
              className="glass-input text-sm py-2 px-2 flex-1 min-w-[130px]"
              placeholder="To"
            />

            {hasActiveFilters && (
              <button onClick={clearFilters} className="glass-btn text-xs flex items-center gap-1 py-2 px-3">
                <X size={14} /> Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <ScrollArea>
          <table className="w-full text-left border-collapse glass-table">
            <thead>
              <tr>
                <th className="p-3 sm:p-4 whitespace-nowrap">Time</th>
                <th className="p-3 sm:p-4 whitespace-nowrap">User</th>
                <th className="p-3 sm:p-4 whitespace-nowrap">Action</th>
                <th className="p-3 sm:p-4 whitespace-nowrap">Entity</th>
                <th className="p-3 sm:p-4">Changes</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-12 text-center tt-muted font-bold italic">
                    No activity logs match your filters.
                  </td>
                </tr>
              ) : (
                logs.map(log => {
                  const EntityIcon = ENTITY_ICONS[log.entity_type] || HardDrive;
                  return (
                    <tr
                      key={log.id}
                      className={`border-t border-white/5 hover:bg-white/[0.02] ${highlightedId && String(log.id) === String(highlightedId) ? 'animate-row-highlight' : ''}`}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2 text-sm tt-sec font-medium" title={log.created_at}>
                          <Clock size={14} className="tt-muted" />
                          {timeAgo(log.created_at)}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-full bg-white/5 tt-muted">
                            <User size={14} />
                          </div>
                          <div>
                            <p className="text-sm font-bold tt">{log.user_name || 'System'}</p>
                            {log.ip_address && (
                              <p className="text-xs tt-muted font-mono">{log.ip_address}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`glass-badge ${ACTION_COLORS[log.action] || 'glass-badge-gray'}`}>
                          {ACTION_LABELS[log.action] || log.action}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-full bg-[color:var(--ui-indigo-strong)]/15 text-[color:var(--ui-indigo-hi)]">
                            <EntityIcon size={14} />
                          </div>
                          <div>
                            <p className="text-sm font-bold tt">{formatId(log.entity_id)}</p>
                            <p className="text-xs font-medium tt-muted uppercase">{log.entity_type}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap items-center">
                          {formatChanges(log.changes)}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm tt-muted">
            Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="glass-btn p-2 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm tt-sec px-3">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="glass-btn p-2 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
