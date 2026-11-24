import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Monitor, History, Package, Box, Tags, ArchiveRestore, ScanBarcode, UserCheck, LogOut, ShieldAlert, MonitorPlay, LifeBuoy, Wrench, Sun, Moon, Settings, CalendarDays, MessageSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../hooks/useNotifications';
import NotificationBell from './NotificationBell';
import NotificationLeaveIcon from './NotificationLeaveIcon';
import WidgetErrorBoundary from './error-boundaries/WidgetErrorBoundary';
import api from '../utils/apiClient';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { toggleTheme, isDark } = useTheme();
  const { convUnreadCount } = useNotifications();
  const location = useLocation();

  // Brand identity (PLAN.MD §13 P3): root-editable name + logo, public read.
  const [brand, setBrand] = useState({ brandName: 'Studio IT Sync', brandLogo: null });
  useEffect(() => {
    let cancelled = false;
    api.get('/api/branding', { showToast: false }).then(({ ok, data }) => {
      if (!cancelled && ok && data) {
        setBrand({ brandName: data.brandName || 'Studio IT Sync', brandLogo: data.brandLogo || null });
        if (data.brandName) document.title = data.brandName;
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const isAdmin = user?.role === 'IT Admin' || user?.isRoot;
  const isReadOnly = user?.role === 'Read-Only';
  const isStaff = user?.role === 'Staff';
  const isManager = user?.role === 'Department Manager';

  const isActive = (path) => location.pathname === path;

  const NavLink = ({ to, icon: Icon, label, color = '', highlight = false, badge = 0, badgeNode = null }) => (
    <Link
      to={to}
      className={`glass-nav-item ${isActive(to) ? 'active' : ''}`}
    >
      <Icon size={18} className={color} />
      <span className={`text-sm ${color} ${highlight ? 'font-bold' : 'font-medium'}`}>{label}</span>
      {badgeNode ? (
        <span className="ml-auto">{badgeNode}</span>
      ) : badge > 0 ? (
        <span
          className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-[color:var(--ui-violet-strong)] text-white text-[10px] font-bold flex items-center justify-center shadow-lg shadow-[color:var(--ui-violet-strong)]/30"
          title={`${badge} unread message${badge === 1 ? '' : 's'}`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );

  return (
    <aside className="glass-sidebar w-64 flex flex-col shrink-0 h-full">
      <div className="p-5 border-b border-white/8 dark:border-black/8" style={{ borderColor: 'var(--glass-border-subtle)' }}>
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1.5">
            {brand.brandLogo ? (
              <img src={brand.brandLogo} alt="Brand logo" className="h-8 w-auto max-w-[160px] object-contain" />
            ) : (
              <span className="text-xl font-black text-glow" style={{ color: 'var(--text-heading)' }}>{brand.brandName}</span>
            )}
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded-full w-fit" style={{ color: 'var(--badge-blue-text)', background: 'var(--badge-blue-bg)', border: '1px solid rgba(59, 130, 246, 0.20)' }}>
              {user?.role}
            </span>
          </div>
          <WidgetErrorBoundary fallbackText="Notifications unavailable">
            <NotificationBell />
          </WidgetErrorBoundary>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {(isAdmin || isReadOnly) && (
          <NavLink to="/" icon={LayoutDashboard} label="Dashboard" />
        )}

        {(isAdmin || isReadOnly || isStaff) && (
          <NavLink to="/calendar" icon={CalendarDays} label="Notification Calendar" color="text-[color:var(--ui-pink-hi)]" highlight />
        )}

        {isStaff && (
          <>
            <NavLink to="/my-assets" icon={MonitorPlay} label="My Assigned Gear" color="text-[color:var(--ui-cyan-hi)]" highlight />
            <NavLink to="/my-tickets" icon={LifeBuoy} label="Support Tickets" color="text-[color:var(--ui-violet-hi)]" highlight />
            <NavLink to="/leave" icon={CalendarDays} label="My Leave" color="text-[color:var(--status-info)]" />
          </>
        )}

        {(isAdmin || isManager) && (
          <>
            <NavLink to="/my-assets" icon={MonitorPlay} label="My Assigned Gear" color="text-[color:var(--ui-cyan-hi)]" highlight />
            <NavLink to="/my-tickets" icon={LifeBuoy} label="Support Tickets" color="text-[color:var(--ui-violet-hi)]" highlight />
          </>
        )}

        {/* Spec 2026-10-13 §7 nav matrix: /leave = Staff, Manager, Admin — Read-Only is route-hidden. */}
        {(isAdmin || isManager) && (
          <NavLink to="/leave" icon={CalendarDays} label="My Leave" color="text-[color:var(--status-info)]" />
        )}

        {(isAdmin || isReadOnly || isManager) && (
          <NavLink to="/leave-approvals" icon={CalendarDays} label="Leave Approvals" color="text-[color:var(--ui-violet-hi)]" badgeNode={<NotificationLeaveIcon />} />
        )}

        {(isAdmin || isReadOnly) && (
          <>
            <NavLink to="/scan" icon={ScanBarcode} label="Scan Station" color="text-[color:var(--status-success)]" highlight />

            {isAdmin && (
              <>
                <NavLink to="/helpdesk" icon={Wrench} label="IT Helpdesk" color="text-[color:var(--ui-indigo-hi)]" highlight />
                <NavLink to="/conversations" icon={MessageSquare} label="Conversations" color="text-[color:var(--ui-violet-hi)]" highlight badge={convUnreadCount} />
                <NavLink to="/assets" icon={Monitor} label="All Hardware" />
                <NavLink to="/user-assets" icon={UserCheck} label="Personnel Resources" color="text-[color:var(--ui-sky-hi)]" />
                <NavLink to="/storage" icon={ArchiveRestore} label="Storage Room" />
                <NavLink to="/users-admin" icon={ShieldAlert} label="User Access" color="text-[color:var(--ui-violet-hi)]" />
              </>
            )}

            <NavLink to="/kits" icon={Package} label="Asset Kits" />
            <NavLink to="/consumables" icon={Box} label="Consumables" />
            <NavLink to="/types" icon={Tags} label="Global Asset Types" />
            <NavLink to="/activity" icon={History} label="Activity Log" />
          </>
        )}

        {/* Settings — every role gets the per-user sections (PLAN.MD §13 P3:
            non-admin route opening). Section CONTENT is gated by the
            registry's fail-closed roles map, not by hiding the route. */}
        <NavLink to="/settings" icon={Settings} label="Settings" color="text-[color:var(--status-warning-hi)]" />
      </nav>

      <div className="p-4 border-t" style={{ borderColor: 'var(--glass-border-subtle)' }}>
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="theme-toggle w-full mb-3"
          title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
          <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
        </button>

        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[color:var(--status-info-strong)] to-[color:var(--ui-purple-deep)] flex items-center justify-center tt font-bold text-sm shrink-0 shadow-lg" style={{ boxShadow: '0 4px 12px rgba(99, 102, 241, 0.30)' }}>
            {user?.name?.charAt(0)}
          </div>
          <div className="overflow-hidden flex-1">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--text-heading)' }}>{user?.name}</p>
            <p className="text-xs truncate" style={{ color: 'var(--text-on-glass-muted)' }}>{user?.email}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition-all duration-200 text-xs font-semibold cursor-pointer"
          style={{ background: 'var(--nav-hover)', color: 'var(--sidebar-text)', border: '1px solid var(--glass-border-subtle)' }}
        >
          <LogOut size={14} />
          Secure Logout
        </button>
      </div>
    </aside>
  );
}
