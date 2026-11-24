import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Bell, AlertTriangle, Info, AlertCircle, X, Filter, Clock, ArrowRight, Zap, CheckSquare, Square, ListChecks, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../utils/apiClient';
import { GlassCard, GlassButton } from '../components/glass';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TYPE_META = {
  ticket: { label: 'Ticket', dot: 'bg-[color:var(--status-info)]', chipBg: 'bg-[color:var(--status-info-strong)]/15', chipText: 'text-[color:var(--status-info)]', filterActive: 'bg-[color:var(--status-info-strong)]/20 text-white' },
  asset: { label: 'Asset', dot: 'bg-[color:var(--status-success)]', chipBg: 'bg-[color:var(--status-success-strong)]/15', chipText: 'text-[color:var(--status-success)]', filterActive: 'bg-[color:var(--status-success-strong)]/20 text-white' },
  consumable: { label: 'Consumable', dot: 'bg-[color:var(--status-warning)]', chipBg: 'bg-[color:var(--status-warning-strong)]/15', chipText: 'text-[color:var(--status-warning)]', filterActive: 'bg-[color:var(--status-warning-strong)]/20 text-white' },
  auth: { label: 'Auth', dot: 'bg-[color:var(--status-danger)]', chipBg: 'bg-[color:var(--status-danger-strong)]/15', chipText: 'text-[color:var(--status-danger)]', filterActive: 'bg-[color:var(--status-danger-strong)]/20 text-white' },
  backup: { label: 'Backup', dot: 'bg-[color:var(--ui-purple)]', chipBg: 'bg-[color:var(--ui-purple-strong)]/15', chipText: 'text-[color:var(--ui-purple)]', filterActive: 'bg-[color:var(--ui-purple-strong)]/20 text-white' },
  system: { label: 'System', dot: 'bg-[color:var(--ui-neutral)]', chipBg: 'bg-[color:var(--ui-neutral-strong)]/15', chipText: 'text-[color:var(--ui-neutral)]', filterActive: 'bg-[color:var(--ui-neutral-strong)]/20 text-white' },
};

// Per-type colors are COMPLETE class strings (the PRIORITY_META pattern):
// template-built `bg-${color}-400` is invisible to Tailwind's scanner, and a
// var()-indirection class would dodge the light-brightness override layer in
// index.css, which keys off these exact semantic class strings.

const PRIORITY_META = {
  critical: { icon: AlertCircle, color: 'text-[color:var(--status-danger)]', bg: 'bg-[color:var(--status-danger-strong)]/15', ring: 'ring-[color:var(--status-danger-strong)]/30' },
  warning: { icon: AlertTriangle, color: 'text-[color:var(--status-warning)]', bg: 'bg-[color:var(--status-warning-strong)]/15', ring: 'ring-[color:var(--status-warning-strong)]/30' },
  info: { icon: Info, color: 'text-[color:var(--status-info)]', bg: 'bg-[color:var(--status-info-strong)]/15', ring: 'ring-[color:var(--status-info-strong)]/30' },
};

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getDaysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function getFirstDayOfMonth(y, m) { return new Date(y, m - 1, 1).getDay(); }
function formatDateKey(y, m, d) { return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function relativeTime(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Sparkline ──────────────────────────────────────────────────────
function Sparkline({ summary, daysInMonth, selectedDay, onDayClick }) {
  const maxCount = Math.max(1, ...Object.values(summary));
  return (
    <div className="flex items-end gap-[2px] h-12 px-1">
      {Array.from({ length: daysInMonth }).map((_, i) => {
        const day = i + 1;
        const count = summary[formatDateKey(0, 0, day)] || 0;
        const height = count > 0 ? Math.max(12, (count / maxCount) * 48) : 2;
        const isSelected = selectedDay === day;
        return (
          <button
            key={i}
            onClick={() => onDayClick(day)}
            className="flex-1 flex items-end justify-center cursor-pointer group relative"
            style={{ height: '100%' }}
            title={`Day ${day}: ${count} notification${count !== 1 ? 's' : ''}`}
          >
            <div
              className={`w-full rounded-t transition-all duration-300 ${
                isSelected
                  ? 'bg-[color:var(--status-info)] shadow-[0_0_8px_rgba(96,165,250,0.5)]'
                  : count > 0
                  ? 'bg-[color:var(--status-info-strong)]/50 group-hover:bg-[color:var(--status-info)]/70'
                  : 'bg-white/8 group-hover:bg-white/15'
              }`}
              style={{ height: `${height}px`, minHeight: '2px' }}
            />
          </button>
        );
      })}
    </div>
  );
}

// ── Stats Bar ──────────────────────────────────────────────────────
function StatsBar({ summary, details, daysInMonth }) {
  const totalNotifications = Object.values(summary).reduce((a, b) => a + b, 0);
  const activeDays = Object.keys(summary).length;
  const busiestDay = Object.entries(summary).sort((a, b) => b[1] - a[1])[0];

  const typeBreakdown = useMemo(() => {
    const counts = {};
    for (const n of details) {
      counts[n.type] = (counts[n.type] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [details]);

  return (
    <div className="flex items-center gap-6 flex-wrap">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-[color:var(--status-info-strong)]/15 flex items-center justify-center">
          <Bell size={14} className="text-[color:var(--status-info)]" />
        </div>
        <div>
          <p className="text-lg font-black leading-none" style={{ color: 'var(--text-heading)' }}>{totalNotifications}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-on-glass-muted)' }}>total</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-[color:var(--status-success-strong)]/15 flex items-center justify-center">
          <Calendar size={14} className="text-[color:var(--status-success)]" />
        </div>
        <div>
          <p className="text-lg font-black leading-none" style={{ color: 'var(--text-heading)' }}>{activeDays}<span className="text-xs font-normal" style={{ color: 'var(--text-on-glass-muted)' }}>/{daysInMonth}</span></p>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-on-glass-muted)' }}>active days</p>
        </div>
      </div>
      {busiestDay && busiestDay[1] > 0 && (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[color:var(--status-warning-strong)]/15 flex items-center justify-center">
            <Zap size={14} className="text-[color:var(--status-warning)]" />
          </div>
          <div>
            <p className="text-lg font-black leading-none" style={{ color: 'var(--text-heading)' }}>{busiestDay[0].split('-')[2]}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-on-glass-muted)' }}>busiest</p>
          </div>
        </div>
      )}
      {typeBreakdown.length > 0 && (
        <div className="flex items-center gap-1.5 ml-auto">
          {typeBreakdown.slice(0, 4).map(([type, count]) => (
            <span key={type} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'var(--glass-bg)', color: 'var(--text-on-glass-muted)' }}>
              <span className={`w-1.5 h-1.5 rounded-full ${(TYPE_META[type] || TYPE_META.system).dot}`} />
              {count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Notification Card ──────────────────────────────────────────────
function NotificationCard({ n, index, onDismiss, onSnooze, selectionMode, isSelected, onToggleSelect }) {
  const p = PRIORITY_META[n.priority] || PRIORITY_META.info;
  const PIcon = p.icon;
  const t = TYPE_META[n.type] || TYPE_META.system;

  const handleClick = () => {
    if (selectionMode) {
      onToggleSelect(n.id);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, height: 0 }}
      transition={{ delay: index * 0.04, type: 'spring', stiffness: 300, damping: 30 }}
      layout
      onClick={handleClick}
      className={`group relative p-4 rounded-2xl border transition-all duration-200 ${
        isSelected
          ? 'border-[color:var(--status-info-strong)]/40 bg-[color:var(--status-info-strong)]/10 ring-1 ring-[color:var(--status-info-strong)]/20'
          : selectionMode
          ? 'hover:border-white/20 cursor-pointer border-white/5'
          : 'hover:border-white/20 border-white/5'
      } ${p.bg}`}
    >
      <div className="flex items-start gap-3">
        {selectionMode ? (
          <div className="shrink-0 mt-0.5">
            {isSelected ? (
              <CheckSquare size={16} className="text-[color:var(--status-info)]" />
            ) : (
              <Square size={16} style={{ color: 'var(--text-on-glass-muted)' }} />
            )}
          </div>
        ) : (
          <div className={`p-1.5 rounded-lg ${p.bg} ring-1 ${p.ring} shrink-0`}>
            <PIcon size={14} className={p.color} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold truncate" style={{ color: 'var(--text-heading)' }}>
              {n.title || 'Notification'}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${t.chipBg} ${t.chipText}`}>
              {t.label}
            </span>
            {n.is_read === 1 && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-white/8" style={{ color: 'var(--text-on-glass-muted)' }}>
                read
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--text-on-glass-muted)' }}>
            {n.message}
          </p>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--text-on-glass-muted)' }}>
              <Clock size={10} />
              {relativeTime(n.created_at)}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-on-glass-muted)' }}>{formatTime(n.created_at)}</span>
            {n.link && (
              <a href={n.link} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[color:var(--status-info)] hover:text-[color:var(--status-info-hi)] transition-colors" onClick={e => e.stopPropagation()}>
                View <ArrowRight size={10} />
              </a>
            )}
          </div>
        </div>
        {!selectionMode && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
            {!n.is_read && (
              <button onClick={() => onDismiss(n.id)} className="p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer" title="Dismiss">
                <X size={12} style={{ color: 'var(--text-on-glass-muted)' }} />
              </button>
            )}
            <button onClick={() => onSnooze(n.id)} className="p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer" title="Snooze 24h">
              <Clock size={12} style={{ color: 'var(--text-on-glass-muted)' }} />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Calendar ──────────────────────────────────────────────────
export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [details, setDetails] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filterType, setFilterType] = useState(null);
  const [jumpDate, setJumpDate] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const calendarRef = useRef(null);
  const focusedDayRef = useRef(null);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;

  const fetchCalendar = useCallback(async () => {
    const { ok, data } = await api.get(`/api/notifications/calendar?year=${year}&month=${month}`);
    if (ok) setSummary(data.summary);
  }, [year, month]);

  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowSearch(false);
      return;
    }
    setShowSearch(true);
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      const { ok, data } = await api.get(`/api/notifications/search?query=${encodeURIComponent(searchQuery.trim())}&limit=20`);
      if (ok) setSearchResults(data.results);
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleDayClick = useCallback(async (day) => {
    setSelectedDay(day);
    setDetailLoading(true);
    setFilterType(null);
    setSelectedIds(new Set());
    setSelectionMode(false);
    const { ok, data } = await api.get(`/api/notifications/calendar?year=${year}&month=${month}&day=${day}`);
    if (ok) setDetails(data.details);
    setDetailLoading(false);
  }, [year, month]);

  const handleDismiss = useCallback(async (id) => {
    await api.put(`/api/notifications/${id}/dismiss`);
    setDetails(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
  }, []);

  const handleSnooze = useCallback(async (id) => {
    await api.put(`/api/notifications/${id}/snooze`, { hours: 24 });
    setDetails(prev => prev.filter(n => n.id !== id));
  }, []);

  const filteredDetails = filterType ? details.filter(n => n.type === filterType) : details;
  const uniqueTypes = [...new Set(details.map(n => n.type))];

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === filteredDetails.length) return new Set();
      return new Set(filteredDetails.map(n => n.id));
    });
  }, [filteredDetails]);

  const handleBatchDismiss = useCallback(async () => {
    const ids = [...selectedIds];
    await Promise.all(ids.map(id => api.put(`/api/notifications/${id}/dismiss`)));
    setDetails(prev => prev.map(n => selectedIds.has(n.id) ? { ...n, is_read: 1 } : n));
    setSelectedIds(new Set());
  }, [selectedIds]);

  const handleBatchSnooze = useCallback(async () => {
    const ids = [...selectedIds];
    await Promise.all(ids.map(id => api.put(`/api/notifications/${id}/snooze`, { hours: 24 })));
    setDetails(prev => prev.filter(n => !selectedIds.has(n.id)));
    setSelectedIds(new Set());
  }, [selectedIds]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (selectedDay === null) return;

      let newDay = selectedDay;
      if (e.key === 'ArrowRight') { e.preventDefault(); newDay = Math.min(selectedDay + 1, daysInMonth); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); newDay = Math.max(selectedDay - 1, 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); newDay = Math.min(selectedDay + 7, daysInMonth); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); newDay = Math.max(selectedDay - 7, 1); }
      else if (e.key === 'Escape') { setSelectedDay(null); setDetails([]); return; }
      else return;

      if (newDay !== selectedDay) {
        setSelectedDay(newDay);
        handleDayClick(newDay);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDay, daysInMonth, handleDayClick]);

  const goToToday = () => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth() + 1);
    setSelectedDay(null);
    setDetails([]);
  };

  const prevMonth = () => {
    setSelectedDay(null); setDetails([]);
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };

  const nextMonth = () => {
    setSelectedDay(null); setDetails([]);
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const handleJumpToDate = (e) => {
    e.preventDefault();
    if (!jumpDate) return;
    const d = new Date(jumpDate);
    if (isNaN(d.getTime())) return;
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelectedDay(d.getDate());
    handleDayClick(d.getDate());
    setJumpDate('');
  };

  // Build week rows
  const weeks = useMemo(() => {
    const rows = [];
    let currentWeek = new Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      currentWeek.push(d);
      if (currentWeek.length === 7) {
        rows.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null);
      rows.push(currentWeek);
    }
    return rows;
  }, [daysInMonth, firstDay]);

  return (
    <div className="space-y-6">
      {/* Header — stacks on mobile so the date-jump controls stay reachable
          (a one-line row clips them past the viewport on phones) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black" style={{ color: 'var(--text-heading)' }}>Notification Calendar</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-on-glass-muted)' }}>Click a day to view notification history</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <form onSubmit={handleJumpToDate} className="flex items-center gap-1.5">
            <input
              type="date"
              value={jumpDate}
              onChange={e => setJumpDate(e.target.value)}
              className="glass-input text-xs px-2 py-1.5 w-36"
            />
            <GlassButton type="submit" variant="default" size="sm">Go</GlassButton>
          </form>
          <GlassButton onClick={goToToday} variant="default" size="sm">Today</GlassButton>
        </div>
      </div>

      {/* Search Bar */}
      <GlassCard className="p-3">
        <div className="flex items-center gap-3">
          <Search size={16} style={{ color: 'var(--text-on-glass-muted)' }} className="shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search notifications by title or message..."
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--text-heading)' }}
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearch(false); }}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X size={14} style={{ color: 'var(--text-on-glass-muted)' }} />
            </button>
          )}
        </div>
      </GlassCard>

      {/* Search Results */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <GlassCard className="overflow-hidden">
              <div className="p-4 border-b" style={{ borderColor: 'var(--glass-border-subtle)' }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-heading)' }}>
                    Search Results
                    {searchResults.length > 0 && (
                      <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-on-glass-muted)' }}>
                        ({searchResults.length} found)
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearch(false); }}
                    className="p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <X size={14} style={{ color: 'var(--text-on-glass-muted)' }} />
                  </button>
                </div>
              </div>
              <div className="max-h-[40vh] overflow-y-auto">
                {searchLoading ? (
                  <div className="text-center py-8" style={{ color: 'var(--text-on-glass-muted)' }}>
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                      <Clock size={20} className="mx-auto" />
                    </motion.div>
                    <p className="text-xs mt-2">Searching...</p>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="text-center py-8" style={{ color: 'var(--text-on-glass-muted)' }}>
                    <Search size={24} className="mx-auto mb-2 opacity-30" />
                    <p className="text-xs">No results found</p>
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor: 'var(--glass-border-subtle)' }}>
                    {searchResults.map((n) => {
                      const p = PRIORITY_META[n.priority] || PRIORITY_META.info;
                      const PIcon = p.icon;
                      const t = TYPE_META[n.type] || TYPE_META.system;
                      const resultDate = new Date(n.created_at);
                      const resultMonth = resultDate.getMonth() + 1;
                      const resultDay = resultDate.getDate();
                      const resultYear = resultDate.getFullYear();

                      return (
                        <button
                          key={n.id}
                          onClick={() => {
                            setYear(resultYear);
                            setMonth(resultMonth);
                            setSelectedDay(resultDay);
                            handleDayClick(resultDay);
                            setSearchQuery('');
                            setSearchResults([]);
                            setShowSearch(false);
                          }}
                          className="w-full flex items-start gap-3 p-3 hover:bg-white/5 transition-colors cursor-pointer text-left"
                        >
                          <div className={`p-1 rounded-lg ${p.bg} ring-1 ${p.ring} shrink-0 mt-0.5`}>
                            <PIcon size={12} className={p.color} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-bold truncate" style={{ color: 'var(--text-heading)' }}>
                                {n.title || 'Notification'}
                              </span>
                              <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${t.chipBg} ${t.chipText}`}>
                                {t.label}
                              </span>
                            </div>
                            <p className="text-[11px] leading-relaxed truncate" style={{ color: 'var(--text-on-glass-muted)' }}>
                              {n.message}
                            </p>
                            <span className="text-[10px] mt-1 inline-block" style={{ color: 'var(--text-on-glass-muted)' }}>
                              {MONTH_NAMES[resultMonth - 1]} {resultDay}, {resultYear}
                            </span>
                          </div>
                          <ArrowRight size={12} className="shrink-0 mt-1 opacity-0 group-hover:opacity-100" style={{ color: 'var(--text-on-glass-muted)' }} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <GlassCard className="p-4">
        <StatsBar summary={summary} details={details} daysInMonth={daysInMonth} />
      </GlassCard>

      {/* Calendar */}
      <GlassCard className="p-6" ref={calendarRef}>
        {/* Month/Year nav */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer" style={{ color: 'var(--text-on-glass)' }}>
            <ChevronLeft size={22} />
          </button>
          <div className="flex items-center gap-3">
            <select
              value={month}
              onChange={e => { setMonth(Number(e.target.value)); setSelectedDay(null); setDetails([]); }}
              className="glass-select text-sm font-bold px-3 py-1.5 rounded-xl cursor-pointer"
              style={{ color: 'var(--text-heading)' }}
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={i} value={i + 1}>{name}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={e => { setYear(Number(e.target.value)); setSelectedDay(null); setDetails([]); }}
              className="glass-select text-sm font-bold px-3 py-1.5 rounded-xl cursor-pointer"
              style={{ color: 'var(--text-heading)' }}
            >
              {Array.from({ length: 11 }).map((_, i) => {
                const y = now.getFullYear() - 5 + i;
                return <option key={y} value={y}>{y}</option>;
              })}
            </select>
          </div>
          <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer" style={{ color: 'var(--text-on-glass)' }}>
            <ChevronRight size={22} />
          </button>
        </div>

        {/* Sparkline */}
        <div className="mb-4 px-1">
          <Sparkline summary={summary} daysInMonth={daysInMonth} selectedDay={selectedDay} onDayClick={handleDayClick} />
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-[36px_repeat(7,1fr)] gap-1 mb-1">
          <div />
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={`text-center text-[10px] font-bold uppercase tracking-wider py-1.5 ${(i === 0 || i === 6) ? 'text-white/30' : ''}`} style={{ color: i === 0 || i === 6 ? undefined : 'var(--text-on-glass-muted)' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="space-y-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${year}-${month}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {weeks.map((week, wi) => {
                const weekStartDate = new Date(year, month - 1, week.find(Boolean));
                const weekNum = weekStartDate ? getWeekNumber(weekStartDate) : '';
                const isCurrentWeek = week.some(d => {
                  if (!d) return false;
                  return isCurrentMonth && today.getDate() === d;
                });

                return (
                  <div key={wi} className={`grid grid-cols-[36px_repeat(7,1fr)] gap-1 rounded-xl py-0.5 ${isCurrentWeek ? 'bg-[color:var(--ui-indigo-strong)]/5' : ''}`}>
                    <div className="flex items-center justify-center text-[9px] font-bold" style={{ color: 'var(--text-on-glass-muted)' }}>
                      {weekNum}
                    </div>
                    {week.map((day, di) => {
                      if (day === null) return <div key={`empty-${di}`} />;
                      const dateKey = formatDateKey(year, month, day);
                      const count = summary[dateKey] || 0;
                      const isToday = isCurrentMonth && today.getDate() === day;
                      const isSelected = selectedDay === day;
                      const isWeekend = di === 0 || di === 6;

                      // Heatmap intensity
                      const maxCount = Math.max(1, ...Object.values(summary));
                      const intensity = count > 0 ? Math.min(count / maxCount, 1) : 0;

                      return (
                        <motion.button
                          key={day}
                          whileHover={{ scale: 1.08 }}
                          whileTap={{ scale: 0.92 }}
                          onClick={() => handleDayClick(day)}
                          className={`relative aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all duration-200 cursor-pointer border ${
                            isSelected
                              ? 'ring-2 ring-[color:var(--status-info-strong)]/60 border-[color:var(--status-info-strong)]/30 z-10'
                              : 'border-transparent hover:border-white/15'
                          }`}
                          style={{
                            background: isSelected
                              ? 'rgba(59, 130, 246, 0.18)'
                              : isToday
                              ? 'rgba(99, 102, 241, 0.12)'
                              : count > 0
                              ? `rgba(59, 130, 246, ${0.03 + intensity * 0.12})`
                              : isWeekend
                              ? 'rgba(255,255,255,0.02)'
                              : 'transparent',
                            color: 'var(--text-on-glass)',
                          }}
                          ref={isToday ? focusedDayRef : null}
                        >
                          {/* Today indicator */}
                          {isToday && (
                            <motion.div
                              className="absolute inset-0 rounded-xl border-2 border-[color:var(--ui-indigo-strong)]/40"
                              animate={{ opacity: [0.4, 0.8, 0.4] }}
                              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                            />
                          )}

                          <span className={`text-sm font-semibold leading-none ${isToday ? 'text-[color:var(--ui-indigo)]' : isWeekend ? 'text-white/40' : ''}`}>
                            {day}
                          </span>

                          {/* Notification dots */}
                          {count > 0 && (
                            <div className="flex items-center gap-0.5">
                              {count <= 3 ? (
                                Array.from({ length: count }).map((_, di) => (
                                  <span key={di} className={`w-1 h-1 rounded-full ${isSelected ? 'bg-[color:var(--status-info-hi)]' : 'bg-[color:var(--status-info)]/60'}`} />
                                ))
                              ) : (
                                <span className={`text-[8px] font-bold leading-none ${isSelected ? 'text-[color:var(--status-info-hi)]' : 'text-[color:var(--status-info)]/70'}`}>
                                  {count}
                                </span>
                              )}
                            </div>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Keyboard hint */}
        <div className="mt-4 flex items-center justify-center gap-4 text-[10px] font-medium" style={{ color: 'var(--text-on-glass-muted)' }}>
          <span>← → ↑ ↓ navigate</span>
          <span>Enter select</span>
          <span>Esc close</span>
        </div>
      </GlassCard>

      {/* Inline Detail Panel */}
      <AnimatePresence>
        {selectedDay !== null && (
          <motion.div
            initial={{ opacity: 0, y: 20, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 20, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <GlassCard className="overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--glass-border-subtle)' }}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-[color:var(--status-info-strong)]/15">
                    <Calendar size={20} className="text-[color:var(--status-info)]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold" style={{ color: 'var(--text-heading)' }}>
                      {MONTH_NAMES[month - 1]} {selectedDay}, {year}
                    </h3>
                    <p className="text-xs" style={{ color: 'var(--text-on-glass-muted)' }}>
                      {details.length} notification{details.length !== 1 ? 's' : ''}
                      {filterType && ` · filtered by ${filterType}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Type filters */}
                  {uniqueTypes.length > 1 && !selectionMode && (
                    <div className="flex items-center gap-1 mr-2">
                      <Filter size={12} style={{ color: 'var(--text-on-glass-muted)' }} />
                      <button
                        onClick={() => setFilterType(null)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                          !filterType ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'
                        }`}
                      >
                        All
                      </button>
                      {uniqueTypes.map(t => (
                        <button
                          key={t}
                          onClick={() => setFilterType(filterType === t ? null : t)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                            filterType === t ? (TYPE_META[t] || TYPE_META.system).filterActive : 'text-white/40 hover:text-white/60'
                          }`}
                        >
                          {TYPE_META[t]?.label || t}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Select All checkbox (visible when in selection mode) */}
                  {selectionMode && filteredDetails.length > 0 && (
                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer mr-2"
                      style={{ color: 'var(--text-on-glass)' }}
                    >
                      {selectedIds.size === filteredDetails.length ? (
                        <CheckSquare size={14} className="text-[color:var(--status-info)]" />
                      ) : (
                        <Square size={14} style={{ color: 'var(--text-on-glass-muted)' }} />
                      )}
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        {selectedIds.size === filteredDetails.length ? 'Deselect all' : 'Select all'}
                      </span>
                    </button>
                  )}

                  {/* Select toggle */}
                  {filteredDetails.length > 0 && (
                    <button
                      onClick={() => {
                        setSelectionMode(prev => !prev);
                        setSelectedIds(new Set());
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all cursor-pointer text-[10px] font-bold uppercase tracking-wider ${
                        selectionMode
                          ? 'bg-[color:var(--status-info-strong)]/20 text-[color:var(--status-info-hi)] ring-1 ring-[color:var(--status-info-strong)]/30'
                          : 'hover:bg-white/10'
                      }`}
                      style={selectionMode ? {} : { color: 'var(--text-on-glass)' }}
                    >
                      <ListChecks size={13} />
                      {selectionMode ? 'Cancel' : 'Select'}
                    </button>
                  )}

                  <button
                    onClick={() => { setSelectedDay(null); setDetails([]); setSelectionMode(false); setSelectedIds(new Set()); }}
                    className="p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                    style={{ color: 'var(--text-on-glass)' }}
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Notification list */}
              <div className="p-5 max-h-[50vh] overflow-y-auto space-y-2">
                {detailLoading ? (
                  <div className="text-center py-12" style={{ color: 'var(--text-on-glass-muted)' }}>
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                      <Clock size={24} className="mx-auto" />
                    </motion.div>
                    <p className="text-xs mt-3">Loading notifications...</p>
                  </div>
                ) : filteredDetails.length === 0 ? (
                  <div className="text-center py-12" style={{ color: 'var(--text-on-glass-muted)' }}>
                    <Bell size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No notifications for this day</p>
                    <p className="text-xs mt-1 opacity-60">{filterType ? 'Try removing the filter' : 'Nothing happened on this day'}</p>
                  </div>
                ) : (
                  <AnimatePresence mode="popLayout">
                    {filteredDetails.map((n, i) => (
                      <NotificationCard
                        key={n.id}
                        n={n}
                        index={i}
                        onDismiss={handleDismiss}
                        onSnooze={handleSnooze}
                        selectionMode={selectionMode}
                        isSelected={selectedIds.has(n.id)}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                  </AnimatePresence>
                )}
              </div>

              {/* Batch Actions Bar */}
              <AnimatePresence>
                {selectionMode && selectedIds.size > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="flex items-center justify-between px-5 py-3 border-t"
                    style={{ borderColor: 'var(--glass-border-subtle)', background: 'rgba(59, 130, 246, 0.06)' }}
                  >
                    <span className="text-xs font-bold" style={{ color: 'var(--text-heading)' }}>
                      {selectedIds.size} selected
                    </span>
                    <div className="flex items-center gap-2">
                      <GlassButton onClick={handleBatchDismiss} variant="default" size="sm">
                        Dismiss
                      </GlassButton>
                      <GlassButton onClick={handleBatchSnooze} variant="default" size="sm">
                        Snooze 24h
                      </GlassButton>
                      <button
                        onClick={() => setSelectedIds(new Set())}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer"
                        style={{ color: 'var(--text-on-glass-muted)' }}
                      >
                        Clear
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
