import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { HardDrive, Download, RefreshCw, AlertCircle, CheckCircle, MessageSquare, Clock, Archive, Database, Zap } from 'lucide-react';
import api from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';
import GlassCard from '../components/glass/GlassCard';
import GlassButton from '../components/glass/GlassButton';
import { GlassInput } from '../components/glass/GlassInput';
import GlassBadge from '../components/glass/GlassBadge';
import GlassConfirmModal from '../components/glass/GlassConfirmModal';
import AppearanceSection from '../components/settings/AppearanceSection';
import LayoutAndMotionSection from '../components/settings/LayoutAndMotionSection';
import TablesAndDataSection from '../components/settings/TablesAndDataSection';
import AccessibilitySection from '../components/settings/AccessibilitySection';
import NotificationsSection from '../components/settings/NotificationsSection';
import BrandingSection from '../components/settings/BrandingSection';
import ManageSection from '../components/settings/ManageSection';
import { canSeeSection } from '../config/preferencesRegistry';

/** Inline per-row save acknowledgement — appears next to the changed row for ~2s. */
function SavedTick({ show }) {
  return (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--status-success)] transition-opacity duration-300 shrink-0 ${show ? 'opacity-100' : 'opacity-0'}`}
    >
      <CheckCircle size={12} /> Saved
    </span>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [backupPath, setBackupPath] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupProgress, setBackupProgress] = useState(null);
  const [backupHistory, setBackupHistory] = useState([]);
  const [convAutoBackup, setConvAutoBackup] = useState(false);
  const [convBackupInterval, setConvBackupInterval] = useState(24);
  const [convBackupLoading, setConvBackupLoading] = useState(false);
  const [convBackupProgress, setConvBackupProgress] = useState(null);
  const [convBackupHistory, setConvBackupHistory] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // ── v2 lifecycle state ──
  const [convAutoArchive, setConvAutoArchive] = useState(false);
  const [convAutoArchiveDays, setConvAutoArchiveDays] = useState(90);
  const [convRetentionDays, setConvRetentionDays] = useState(30);
  const [convArchiveRetentionDays, setConvArchiveRetentionDays] = useState(0);
  const [convQuotaMb, setConvQuotaMb] = useState(0);
  const [storageStats, setStorageStats] = useState(null);
  const [archiveRunLoading, setArchiveRunLoading] = useState(false);
  const [confirmLifecycleRun, setConfirmLifecycleRun] = useState(false);
  const [savedLifecycleRows, setSavedLifecycleRows] = useState({});
  const lifecycleSaveTimers = useRef({});
  const lifecycleSavedTimers = useRef({});

  useEffect(() => {
    loadSettings();
    if (user?.isRoot) {
      loadBackupHistory();
      loadConvBackupHistory();
      loadStorageStats();
    }
  }, [user?.isRoot]);

  // ── Batch load: one GET /api/settings replaces the eleven per-key GETs
  // (PLAN.MD §13 P1). Response shape: { settings: { key: value, ... } }.
  const loadSettings = async () => {
    try {
      const { ok, data } = await api.get('/api/settings', { showToast: false });
      if (!ok || !data?.settings) return;
      const s = data.settings;
      if (typeof s.backup_path !== 'undefined') setBackupPath(s.backup_path || '');
      if (typeof s.conversation_auto_backup !== 'undefined') setConvAutoBackup(s.conversation_auto_backup === '1');
      if (typeof s.conversation_backup_interval !== 'undefined') setConvBackupInterval(parseInt(s.conversation_backup_interval || '24', 10));
      if (typeof s.conversation_auto_archive_enabled !== 'undefined') setConvAutoArchive(s.conversation_auto_archive_enabled === '1');
      if (typeof s.conversation_auto_archive_days !== 'undefined') setConvAutoArchiveDays(parseInt(s.conversation_auto_archive_days || '90', 10));
      if (typeof s.conversation_retention_days !== 'undefined') setConvRetentionDays(parseInt(s.conversation_retention_days || '30', 10));
      if (typeof s.conversation_archive_retention_days !== 'undefined') setConvArchiveRetentionDays(parseInt(s.conversation_archive_retention_days || '0', 10));
      if (typeof s.conversation_storage_quota_mb !== 'undefined') setConvQuotaMb(parseInt(s.conversation_storage_quota_mb || '0', 10));
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const loadBackupHistory = async () => {
    const { ok, data } = await api.get('/api/backup/history', { showToast: false });
    if (ok && Array.isArray(data)) {
      setBackupHistory(data);
    }
  };

  const loadConvBackupHistory = async () => {
    const { ok, data } = await api.get('/api/conversations/backup/history', { showToast: false });
    if (ok && Array.isArray(data)) {
      setConvBackupHistory(data);
    }
  };

  const loadStorageStats = async () => {
    const { ok, data } = await api.get('/api/conversations/storage-stats', { showToast: false });
    if (ok && data) setStorageStats(data);
  };

  // ── Lifecycle row saves: per-row inline "Saved" acknowledgement instead of
  // the page-wide toast. Number inputs debounce (600 ms) so typing "30" does
  // not fire a PUT for "3" first; blur commits immediately.
  const flashRowSaved = (key) => {
    setSavedLifecycleRows((prev) => ({ ...prev, [key]: true }));
    clearTimeout(lifecycleSavedTimers.current[key]);
    lifecycleSavedTimers.current[key] = setTimeout(
      () => setSavedLifecycleRows((prev) => ({ ...prev, [key]: false })),
      2200
    );
  };

  const saveLifecycle = async (key, updates) => {
    setError('');
    const { ok, error: err } = await api.put('/api/settings', updates);
    if (!ok) setError(err || 'Failed to save settings');
    else flashRowSaved(key);
    return ok;
  };

  const saveLifecycleDebounced = (key, updates) => {
    clearTimeout(lifecycleSaveTimers.current[key]?.timer);
    lifecycleSaveTimers.current[key] = {
      updates,
      timer: setTimeout(() => {
        delete lifecycleSaveTimers.current[key];
        saveLifecycle(key, updates);
      }, 600),
    };
  };

  const flushLifecycleSave = (key) => {
    const pending = lifecycleSaveTimers.current[key];
    if (!pending) return Promise.resolve();
    clearTimeout(pending.timer);
    delete lifecycleSaveTimers.current[key];
    return saveLifecycle(key, pending.updates);
  };

  const handleToggleAutoArchive = async (value) => {
    setConvAutoArchive(value);
    await saveLifecycle('autoArchive', { conversationAutoArchiveEnabled: value });
  };

  const handleRunAutoArchiveNow = async () => {
    // Commit any pending debounced edits so the run sees final values.
    await Promise.all(Object.keys(lifecycleSaveTimers.current).map(flushLifecycleSave));
    setArchiveRunLoading(true);
    const { ok, data, error: err } = await api.post('/api/settings/conversation-auto-archive-run', {});
    setArchiveRunLoading(false);
    setConfirmLifecycleRun(false);
    if (ok) {
      const archived = data?.archivedCount ?? 0;
      const purged = data?.purgedCount ?? 0;
      const archivePurged = data?.archivePurgedCount ?? 0;
      const parts = [
        `${archived} conversation${archived === 1 ? '' : 's'} archived`,
        `${purged} recycle-bin item${purged === 1 ? '' : 's'} purged`,
      ];
      if (archivePurged > 0) parts.push(`${archivePurged} archive${archivePurged === 1 ? '' : 's'} purged (retention)`);
      setSuccess(`Lifecycle run completed — ${parts.join(', ')}`);
      setTimeout(() => setSuccess(''), 4500);
      loadStorageStats();
    } else {
      setError(err || 'Lifecycle run failed');
    }
  };

  useEffect(() => () => {
    // Unmount: never setState from a late debounced save.
    Object.values(lifecycleSaveTimers.current).forEach((p) => clearTimeout(p?.timer));
    Object.values(lifecycleSavedTimers.current).forEach(clearTimeout);
  }, []);

  const saveSettings = async (updates) => {
    setError('');
    setSuccess('');
    const { ok, error: err } = await api.put('/api/settings', updates);
    if (!ok) {
      setError(err || 'Failed to save settings');
    } else {
      setSuccess('Settings saved');
      setTimeout(() => setSuccess(''), 2500);
    }
    return ok;
  };

  const handleSaveBackupPath = async () => {
    const ok = await saveSettings({ backupPath });
    if (ok) loadBackupHistory();
  };

  const handleBackup = async () => {
    setBackupLoading(true);
    setBackupProgress({ stage: 'starting', progress: 0 });
    setError('');
    setSuccess('');

    try {
      const { ok, data, error: err } = await api.post('/api/backup');
      if (ok) {
        setSuccess(`Backup completed: ${data.filename} (${formatBytes(data.sizeBytes)})`);
        setBackupProgress({ stage: 'complete', progress: 100, filename: data.filename });
        loadBackupHistory();
      } else {
        throw new Error(err || 'Backup failed');
      }
    } catch (err) {
      setError(err.message || 'Backup failed');
      setBackupProgress({ stage: 'failed', progress: 0, error: err.message });
    } finally {
      setBackupLoading(false);
      setTimeout(() => setBackupProgress(null), 5000);
    }
  };

  const handleToggleConvAutoBackup = async (value) => {
    setConvAutoBackup(value);
    await saveSettings({ conversationAutoBackup: value });
  };

  const handleConvBackupIntervalChange = async (value) => {
    const interval = parseInt(value, 10);
    if (interval > 0) {
      setConvBackupInterval(interval);
      await saveSettings({ conversationBackupInterval: interval });
    }
  };

  const handleConvBackup = async () => {
    setConvBackupLoading(true);
    setConvBackupProgress({ stage: 'starting', progress: 0 });
    setError('');
    setSuccess('');

    try {
      const { ok, data, error: err } = await api.post('/api/conversations/backup');
      if (ok) {
        setSuccess(`Conversation backup completed: ${data.filename} (${formatBytes(data.sizeBytes)})`);
        setConvBackupProgress({ stage: 'complete', progress: 100, filename: data.filename });
        loadConvBackupHistory();
      } else {
        throw new Error(err || 'Conversation backup failed');
      }
    } catch (err) {
      setError(err.message || 'Conversation backup failed');
      setConvBackupProgress({ stage: 'failed', progress: 0, error: err.message });
    } finally {
      setConvBackupLoading(false);
      setTimeout(() => setConvBackupProgress(null), 5000);
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStageLabel = (stage) => {
    const labels = {
      starting: 'Initializing...',
      'db-backup': 'Backing up database...',
      zip: 'Creating archive...',
      complete: 'Complete!',
      failed: 'Failed',
    };
    return labels[stage] || stage;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-center"
      >
        <div>
          <h1 className="text-2xl font-bold tt">Settings</h1>
          <p className="tt-sec">Configure backup, notifications, and preferences</p>
        </div>
        <GlassBadge variant={user.isRoot ? 'default' : 'warning'}>
          {user.isRoot ? 'Root Admin' : 'Admin'}
        </GlassBadge>
      </motion.div>

      {/* Appearance — per-user prefs via the preferences registry (PLAN.MD §13 P1) */}
      <AppearanceSection />

      {/* Layout/Density + Motion/Effects — P2 (PLAN.MD §13) */}
      <LayoutAndMotionSection />

      {/* Tables & Data defaults — P2 (PLAN.MD §13) */}
      <TablesAndDataSection />

      {/* Accessibility — P3 (PLAN.MD §13), per-user, every role */}
      {canSeeSection(user?.role, 'accessibility') && <AccessibilitySection />}

      {/* Notifications — P3: toggles moved out of the mixed sections below;
          scope labels are explicit (per user vs system) */}
      {canSeeSection(user?.role, 'notifications') && (
        <NotificationsSection role={user?.role} />
      )}

      {/* Branding & Defaults — P3, root-only (fail closed: registry roles
          AND isRoot — the server's requireRoot is the third layer) */}
      {user?.isRoot && canSeeSection(user?.role, 'branding') && <BrandingSection />}

      {/* Manage — P3: export/import/reset, per-user, every role */}
      <ManageSection />

      {/* Backup Section — Root Admin Only */}
      {user?.isRoot && (
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="space-y-4"
      >
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold tt flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-[color:var(--ui-indigo)]" />
              On-Demand Backup
            </h2>
            <GlassBadge variant="info">Root Admin Only</GlassBadge>
          </div>
          
          <p className="tt-sec mb-4">
            Create a complete snapshot of the database, uploads, and configuration files to a UNC path.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 mb-6">
            <GlassInput
              label="Backup Path"
              value={backupPath}
              onChange={(e) => setBackupPath(e.target.value)}
              placeholder="\\\\NAS\\studio\\backups"
              icon={<HardDrive className="w-4 h-4" />}
              disabled={backupLoading}
            />
            <div className="flex items-end gap-2">
              <GlassButton
                variant="secondary"
                onClick={handleSaveBackupPath}
                disabled={backupLoading || !backupPath}
                className="w-1/2"
              >
                Save Path
              </GlassButton>
              <GlassButton
                onClick={handleBackup}
                disabled={backupLoading || !backupPath}
                className="w-1/2"
              >
                {backupLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Start Backup
                  </>
                )}
              </GlassButton>
            </div>
          </div>

          {backupProgress && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-2 p-4 rounded-lg bg-white/5 border border-white/10"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium tt">{getStageLabel(backupProgress.stage)}</span>
                <span className="text-sm tt-sec">{backupProgress.progress}%</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-[color:var(--ui-indigo-strong)] transition-all duration-300"
                  animate={{ width: `${backupProgress.progress}%` }}
                />
              </div>
              {backupProgress.filename && (
                <p className="text-xs text-[color:var(--status-success)]">Saved as: {backupProgress.filename}</p>
              )}
              {backupProgress.error && (
                <p className="text-xs text-[color:var(--status-danger)]">Error: {backupProgress.error}</p>
              )}
            </motion.div>
          )}

          {error && (
            <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded bg-[color:var(--status-success-strong)]/20 border border-[color:var(--status-success-strong)]/50 text-[color:var(--status-success-hi)] text-sm flex items-center gap-2">
              <CheckCircle size={16} />
              {success}
            </div>
          )}

          {/* Backup History */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <h3 className="font-medium tt mb-3">Backup History</h3>
            {backupHistory.length === 0 ? (
              <p className="tt-label text-sm">No backups yet</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {backupHistory.map((backup) => (
                  <motion.div
                    key={backup.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <HardDrive className={`w-5 h-5 ${backup.status === 'success' ? 'text-[color:var(--status-success)]' : 'text-[color:var(--status-danger)]'}`} />
                      <div>
                        <p className="text-sm font-medium tt">{backup.filename}</p>
                        <p className="text-xs tt-label">
                          {new Date(backup.created_at).toLocaleString()} • {formatBytes(backup.size_bytes)}
                        </p>
                      </div>
                    </div>
                    <GlassBadge variant={backup.status === 'success' ? 'success' : 'danger'}>
                      {backup.status}
                    </GlassBadge>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </GlassCard>
      </motion.section>
      )}

      {/* Conversation Backup Section — Root Admin Only */}
      {user?.isRoot && (
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="space-y-4"
      >
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold tt flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-[color:var(--ui-violet)]" />
              Conversation Backups
            </h2>
            <GlassBadge variant="info">Root Admin Only</GlassBadge>
          </div>
          
          <p className="tt-sec mb-4">
            Backup conversation history, messages, and attachments to a UNC path.
          </p>

          <div className="space-y-4 mb-6">
            <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-[color:var(--ui-violet)]" />
                <div>
                  <p className="font-medium tt">Auto-Backup</p>
                  <p className="text-xs tt-label">Automatically backup conversations on schedule</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={convAutoBackup}
                  onChange={(e) => handleToggleConvAutoBackup(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[color:var(--ui-violet-strong)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[color:var(--ui-neutral-hi)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[color:var(--ui-violet-strong)]"></div>
              </label>
            </div>

            {convAutoBackup && (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-white/5">
                <Clock className="w-5 h-5 text-[color:var(--ui-violet)]" />
                <div className="flex-1">
                  <p className="font-medium tt text-sm">Backup Interval (hours)</p>
                </div>
                <input
                  type="number"
                  value={convBackupInterval}
                  onChange={(e) => handleConvBackupIntervalChange(e.target.value)}
                  min="1"
                  max="168"
                  className="w-20 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm text-center focus:outline-none focus:border-[color:var(--ui-violet)]/50"
                />
              </div>
            )}

            <div className="flex gap-2">
              <GlassButton
                onClick={handleConvBackup}
                disabled={convBackupLoading}
                className="flex-1"
              >
                {convBackupLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Backup Now
                  </>
                )}
              </GlassButton>
            </div>
          </div>

          {convBackupProgress && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-2 p-4 rounded-lg bg-white/5 border border-white/10"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium tt">{getStageLabel(convBackupProgress.stage)}</span>
                <span className="text-sm tt-sec">{convBackupProgress.progress}%</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-[color:var(--ui-violet-strong)] transition-all duration-300"
                  animate={{ width: `${convBackupProgress.progress}%` }}
                />
              </div>
              {convBackupProgress.filename && (
                <p className="text-xs text-[color:var(--status-success)]">Saved as: {convBackupProgress.filename}</p>
              )}
              {convBackupProgress.error && (
                <p className="text-xs text-[color:var(--status-danger)]">Error: {convBackupProgress.error}</p>
              )}
            </motion.div>
          )}

          {/* Conversation Backup History */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <h3 className="font-medium tt mb-3">Conversation Backup History</h3>
            {convBackupHistory.length === 0 ? (
              <p className="tt-label text-sm">No conversation backups yet</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {convBackupHistory.map((backup) => (
                  <motion.div
                    key={backup.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <MessageSquare className={`w-5 h-5 ${backup.status === 'success' ? 'text-[color:var(--status-success)]' : 'text-[color:var(--status-danger)]'}`} />
                      <div>
                        <p className="text-sm font-medium tt">{backup.filename}</p>
                        <p className="text-xs tt-label">
                          {new Date(backup.created_at).toLocaleString()} • {formatBytes(backup.size_bytes)}
                        </p>
                        {backup.manifest_hash_hex ? (
                          <p
                            className="mt-0.5 font-mono text-[10px] tt-label cursor-help"
                            title={`SHA256SUMS manifest hash — full value: ${backup.manifest_hash_hex}`}
                          >
                            sha256 {backup.manifest_hash_hex.slice(0, 12)}…
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[10px] tt-label opacity-70" title="Backup predates the manifest-hash feature — no out-of-band tamper-evidence recorded">
                            pre-feature backup
                          </p>
                        )}
                      </div>
                    </div>
                    <GlassBadge variant={backup.status === 'success' ? 'success' : 'danger'}>
                      {backup.status}
                    </GlassBadge>
                  </motion.div>
                ))}
              </div>
            )}
          </div>        </GlassCard>

        {/* Conversation Lifecycle & Storage (v2) */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold tt flex items-center gap-2">
              <Archive className="w-5 h-5 text-[color:var(--ui-violet)]" />
              Conversation Lifecycle & Storage
            </h2>
            <GlassBadge variant="info">Root Admin Only</GlassBadge>
          </div>

          <p className="tt-sec mb-4">
            Archiving moves a conversation out of the live database into the archive store, freeing space — archived
            conversations stay readable and can be restored. Deleted conversations rest in the recycle bin for the
            retention period, then are purged permanently.
          </p>

          {/* Storage stats */}
          {storageStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="p-3 rounded-lg bg-white/5">
                <p className="text-[10px] tt-label uppercase">Active DB</p>
                <p className="text-sm font-bold tt">{formatBytes(storageStats.main_db?.size_bytes || 0)}</p>
                <p className="text-[10px] tt-muted">{storageStats.main_db?.conversations} convs · {storageStats.main_db?.messages} msgs</p>
              </div>
              <div className="p-3 rounded-lg bg-white/5">
                <p className="text-[10px] tt-label uppercase">Archive DB</p>
                <p className="text-sm font-bold tt">{formatBytes(storageStats.archive_db?.size_bytes || 0)}</p>
                <p className="text-[10px] tt-muted">{storageStats.archive_db?.conversations} archived</p>
              </div>
              <div className="p-3 rounded-lg bg-white/5">
                <p className="text-[10px] tt-label uppercase">Active uploads</p>
                <p className="text-sm font-bold tt">{formatBytes(storageStats.uploads?.active_bytes || 0)}</p>
              </div>
              <div className="p-3 rounded-lg bg-white/5">
                <p className="text-[10px] tt-label uppercase">Archived uploads</p>
                <p className="text-sm font-bold tt">{formatBytes(storageStats.uploads?.archive_bytes || 0)}</p>
                {storageStats.quota && (
                  <>
                    <p className={`text-[10px] ${storageStats.quota.usage_ratio >= 0.8 ? 'text-[color:var(--status-warning)]' : 'tt-muted'}`}>
                      {Math.round(storageStats.quota.usage_ratio * 100)}% of quota
                    </p>
                    <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${storageStats.quota.usage_ratio >= 0.8 ? 'bg-[color:var(--status-warning)]' : 'bg-[color:var(--ui-violet)]/70'}`}
                        style={{ width: `${Math.min(100, Math.round(storageStats.quota.usage_ratio * 100))}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {/* Auto-archive */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-[color:var(--ui-violet)]" />
                <div>
                  <p className="font-medium tt">Auto-archive idle conversations</p>
                  <p className="text-xs tt-label flex items-center gap-2">
                    Move conversations idle past the threshold below into the archive — they leave the live list but stay restorable
                    <SavedTick show={savedLifecycleRows.autoArchive} />
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={convAutoArchive}
                  onChange={(e) => handleToggleAutoArchive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[color:var(--ui-violet-strong)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[color:var(--ui-violet-strong)]"></div>
              </label>
            </div>
            {convAutoArchive && (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-white/5">
                <Clock className="w-4 h-4 text-[color:var(--ui-violet)]" />
              <div className="flex-1">
                <p className="font-medium tt text-sm">Idle threshold (days)</p>
                <p className="text-xs tt-label">Days without a message before a conversation counts as idle · checked every 6 hours</p>
              </div>
              <input
                type="number" min="1" max="3650"
                value={convAutoArchiveDays}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1) { setConvAutoArchiveDays(v); saveLifecycleDebounced('autoArchiveDays', { conversationAutoArchiveDays: v }); } }}
                onBlur={() => flushLifecycleSave('autoArchiveDays')}
                  className="w-20 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm text-center focus:outline-none focus:border-[color:var(--ui-violet)]/50"
                />
              </div>
            )}

            {/* Recycle bin retention */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-white/5">
              <Clock className="w-4 h-4 text-[color:var(--status-warning)]" />
              <div className="flex-1">
                <p className="font-medium tt text-sm">Recycle bin retention (days)</p>
                <p className="text-xs tt-label flex items-center gap-2">
                  Deleted conversations stay restorable for this long, then are purged permanently
                  <SavedTick show={savedLifecycleRows.retention} />
                </p>
              </div>
              <input
                type="number" min="1" max="3650"
                value={convRetentionDays}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1) { setConvRetentionDays(v); saveLifecycleDebounced('retention', { conversationRetentionDays: v }); } }}
                onBlur={() => flushLifecycleSave('retention')}
                className="w-20 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm text-center focus:outline-none focus:border-[color:var(--ui-violet)]/50"
              />
            </div>

            {/* Archive retention (optional purge) */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-white/5">
              <Clock className="w-4 h-4 text-[color:var(--status-danger)]" />
              <div className="flex-1">
                <p className="font-medium tt text-sm">Archive retention (days)</p>
                <p className="text-xs tt-label flex items-center gap-2">
                  Archives older than this are deleted permanently at the next lifecycle run — 0 keeps them forever
                  <SavedTick show={savedLifecycleRows.archiveRetention} />
                </p>
              </div>
              <input
                type="number" min="0" max="3650"
                value={convArchiveRetentionDays}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 0) { setConvArchiveRetentionDays(v); saveLifecycleDebounced('archiveRetention', { conversationArchiveRetentionDays: v }); } }}
                onBlur={() => flushLifecycleSave('archiveRetention')}
                className="w-20 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm text-center focus:outline-none focus:border-[color:var(--ui-violet)]/50"
              />
            </div>

            {/* Quota */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-white/5">
              <Database className="w-4 h-4 text-[color:var(--ui-indigo)]" />
              <div className="flex-1">
                <p className="font-medium tt text-sm">Attachment storage quota (MB)</p>
                <p className="text-xs tt-label flex items-center gap-2">
                  Total attachment storage allowed before new uploads are blocked — 0 = unlimited, warns at 80%
                  <SavedTick show={savedLifecycleRows.quota} />
                </p>
              </div>
              <input
                type="number" min="0" max="1048576"
                value={convQuotaMb}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 0) { setConvQuotaMb(v); saveLifecycleDebounced('quota', { conversationStorageQuotaMb: v }); } }}
                onBlur={() => flushLifecycleSave('quota')}
                className="w-20 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 tt text-sm text-center focus:outline-none focus:border-[color:var(--ui-violet)]/50"
              />
            </div>

            {/* Run now — it permanently purges, so confirm before executing */}
            <GlassButton onClick={() => setConfirmLifecycleRun(true)} disabled={archiveRunLoading} className="w-full">
              {archiveRunLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
              Run lifecycle now
            </GlassButton>
            <p className="text-[11px] tt-muted -mt-2">
              Applies the settings above immediately — archives idle conversations, purges expired recycle-bin entries,
              {convArchiveRetentionDays > 0 ? ' purges archives past the archive retention,' : ''} re-checks the quota.
            </p>
            <GlassConfirmModal
              isOpen={confirmLifecycleRun}
              onClose={() => setConfirmLifecycleRun(false)}
              onConfirm={handleRunAutoArchiveNow}
              title="Run lifecycle now?"
              message={convArchiveRetentionDays > 0
                ? "Idle conversations will move to the archive, recycle-bin entries past the retention period will be permanently deleted, and archives past the archive retention will be purged. Purged items cannot be recovered."
                : "Idle conversations will move to the archive and recycle-bin entries past the retention period will be permanently deleted. Purged items cannot be recovered."}
              confirmText="Run lifecycle"
              cancelText="Cancel"
              variant="danger"
              isLoading={archiveRunLoading}
            />
          </div>
        </GlassCard>

      </motion.section>
      )}

    </div>
  );
}