import React, { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Menu } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import P2MotionConfig from './components/settings/P2MotionConfig';
import { readStoredPrefs } from './config/applyPreferences';
import usePrefsVersion from './hooks/usePrefsVersion';
import { Toaster } from 'react-hot-toast';
import GlobalErrorBoundary from './components/error-boundaries/GlobalErrorBoundary';
import DiskStatusBanner from './components/DiskStatusBanner';
import AnimatedPage from './components/AnimatedPage';
import Sidebar from './components/Sidebar';
import { GlassDrawer } from './components/glass';

// Pre-auth screens stay eager — they are tiny and needed at first paint.
import Login from './pages/Login';
import ForcePasswordChange from './pages/ForcePasswordChange';
import SetupWizard from './pages/SetupWizard';

// Route pages are code-split: heavy deps (recharts, etc.) only load when a
// page is first visited, keeping the initial bundle small.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AssetList = lazy(() => import('./pages/AssetList'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const Kits = lazy(() => import('./pages/Kits'));
const Consumables = lazy(() => import('./pages/Consumables'));
const AssetTypes = lazy(() => import('./pages/AssetTypes'));
const Storage = lazy(() => import('./pages/Storage'));
const ScanStation = lazy(() => import('./pages/ScanStation'));
const UserAssets = lazy(() => import('./pages/UserAssets'));
const MyAssets = lazy(() => import('./pages/MyAssets'));
const MyTickets = lazy(() => import('./pages/MyTickets'));
const Helpdesk = lazy(() => import('./pages/Helpdesk'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const ConversationWorkspace = lazy(() => import('./pages/ConversationWorkspace'));
const Settings = lazy(() => import('./pages/Settings'));
const MyLeave = lazy(() => import('./pages/MyLeave'));
const LeaveApprovals = lazy(() => import('./pages/LeaveApprovals'));

function PageFallback() {
  return (
    <div className="h-full min-h-[60vh] flex items-center justify-center">
      <div className="glass-card rounded-2xl px-8 py-6 flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-[color:var(--ui-indigo)]/60 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm tt-muted">Loading…</p>
      </div>
    </div>
  );
}

// Titles for the mobile top bar (keep in sync with the routes below).
const PAGE_TITLES = {
  '/': 'Dashboard',
  '/calendar': 'Notification Calendar',
  '/my-assets': 'My Assigned Gear',
  '/my-tickets': 'Support Tickets',
  '/scan': 'Scan Station',
  '/helpdesk': 'IT Helpdesk',
  '/conversations': 'Conversations',
  '/assets': 'All Hardware',
  '/user-assets': 'Personnel Resources',
  '/storage': 'Storage Room',
  '/users-admin': 'User Access',
  '/settings': 'Settings',
  '/kits': 'Asset Kits',
  '/consumables': 'Consumables',
  '/types': 'Global Asset Types',
  '/activity': 'Activity Log',
  '/leave': 'My Leave',
  '/leave-approvals': 'Leave Approvals',
};

function AnimatedRoutes() {
  const location = useLocation();
  const { user, loading, setupPending } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile nav drawer

  // Close the mobile drawer on navigation (picking a page, redirects).
  // Esc is handled inside GlassDrawer.
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  if (loading) return null;

  // Show setup wizard if setup is pending
  if (setupPending) return <SetupWizard />;

  if (!user) return <Login />;
  if (user.requires_password_change === 1) return <ForcePasswordChange />;

  const isAdmin = user.role === 'IT Admin' || user.isRoot;
  const isReadOnly = user.role === 'Read-Only';
  const isStaff = user.role === 'Staff';
  const isManager = user.role === 'Department Manager';

  const pageTitle = PAGE_TITLES[location.pathname] || 'Studio IT Sync';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile nav: one Sidebar instance — static on desktop, slide-in
          drawer with overlay below md. The shared GlassDrawer owns overlay,
          Esc and focus handling; App only owns the open state. */}
      <GlassDrawer
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        label="Main navigation"
      >
        <Sidebar />
      </GlassDrawer>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar: hamburger + current page title */}
        <div
          className="md:hidden flex items-center gap-3 px-4 py-2.5 border-b shrink-0"
          style={{ borderColor: 'var(--glass-border-subtle)', background: 'var(--sidebar-bg)' }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-lg hover:bg-white/10 tt-muted hover:tt"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <span className="font-bold tt truncate text-sm">{pageTitle}</span>
        </div>

        <main className="flex-1 overflow-auto p-4 md:p-8 relative">
          <AnimatePresence mode="wait">
            {/* className="h-full" — AnimatedPage sits directly in <main>, which
                is height-bounded by the h-screen shell. Without it this wrapper
                is auto-height, and every page's own `h-full` root (e.g.
                ConversationWorkspace) resolves against an indefinite parent
                and silently grows to content — pushing layout out to
                <main>'s scroller instead of scrolling inside its pane. */}
            <AnimatedPage key={location.pathname} className="h-full">
              <Suspense fallback={<PageFallback />}>
                <Routes location={location}>
                  <Route path="/" element={isStaff ? <Navigate to="/my-assets" replace /> : <Dashboard />} />
                  {(isStaff || isAdmin) && (<>
                    <Route path="/my-assets" element={<MyAssets />} />
                    <Route path="/my-tickets" element={<MyTickets />} />
                  </>)}
                  {(isAdmin || isReadOnly) && (<>
                    <Route path="/scan" element={<ScanStation />} />
                    <Route path="/kits" element={<Kits />} />
                    <Route path="/consumables" element={<Consumables />} />
                    <Route path="/types" element={<AssetTypes />} />
                    <Route path="/activity" element={<ActivityLog />} />
                  </>)}
                  {(isAdmin || isReadOnly || isStaff) && (
                    <Route path="/calendar" element={<CalendarPage />} />
                  )}
                  {/* Leave requests (spec 2026-10-13 §7): /leave = Staff + Manager (view-only) + Admin (+ on-behalf); Read-Only is route-HIDDEN (spec §7 table ❌). /leave-approvals = Manager + Admin + Read-Only (buttons stripped). */}
                  {(isStaff || isManager || isAdmin) && (
                    <Route path="/leave" element={<MyLeave />} />
                  )}
                  {(isAdmin || isReadOnly || isManager) && (
                    <Route path="/leave-approvals" element={<LeaveApprovals />} />
                  )}
                  {isAdmin && (<>
                    <Route path="/helpdesk" element={<Helpdesk />} />
                    <Route path="/conversations" element={<ConversationWorkspace />} />
                    <Route path="/assets" element={<AssetList />} />
                    <Route path="/user-assets" element={<UserAssets />} />
                    <Route path="/storage" element={<Storage />} />
                    <Route path="/users-admin" element={<UserManagement />} />
                  </>)}
                  {/* Settings open to EVERY role (PLAN.MD §13 P3): per-user
                      sections are universal; admin/root-only content gates
                      itself via the registry's fail-closed roles map. */}
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </AnimatedPage>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  // Full live reactivity (PLAN.MD §13): subscribing to the prefs-changed
  // ping re-renders App on every applyPreferences write (and cross-tab
  // storage events), so every pref read below re-derives from the blob.
  usePrefsVersion();
  const motionLevel = readStoredPrefs().motion || 'full';

  // Toaster styling derives from the SAME tokens the pre-paint script and
  // the CSS appliers write — a fresh object per render lets react-hot-toast
  // pick up glass-tier/theme changes on already-mounted toasters too.
  const toastStyle = {
    background: 'var(--toast-bg)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid var(--glass-border)',
    borderRadius: '14px',
    padding: '12px 16px',
    fontSize: '14px',
    color: 'var(--text-on-glass)',
    boxShadow: 'var(--glass-shadow-lg)',
  };

  return (
    <BrowserRouter>
      <P2MotionConfig motionLevel={motionLevel}>
      <ThemeProvider>
        <AuthProvider>
          <GlobalErrorBoundary>
            <AnimatedRoutes />
          </GlobalErrorBoundary>
          <DiskStatusBanner />
          <Toaster position="top-right" toastOptions={{ style: toastStyle }} />
        </AuthProvider>
      </ThemeProvider>
      </P2MotionConfig>
    </BrowserRouter>
  );
}
