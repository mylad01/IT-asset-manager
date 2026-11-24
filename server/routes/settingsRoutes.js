import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { verifyToken, requireAdmin, requireAdminOrReadOnly, requireRoot } from '../middleware/authMiddleware.js';
import * as settingsModel from '../models/settingsModel.js';
import { testBackupPath } from '../services/backupService.js';
import { runAutoArchiveOnce } from '../services/conversationArchiveService.js';
import { readStoredBrand } from '../services/brandingService.js';
import { extForImageMime, validateImageFile, discardUploaded } from '../utils/uploadSafety.js';

const router = express.Router();

router.use(verifyToken);

// Reads: the Settings page is open to EVERY role (PLAN.MD §13 P3), so its
// batch GET must not 403 for Read-Only (PLAN.MD §16.5 F2) — IT Admin,
// Read-Only and root pass reads; Staff still fails closed (testAllApi), and
// every mutation stays admin-only behind requireAdmin below. Branding keeps
// its own requireRoot layer on top.
router.use((req, res, next) => (
  req.method === 'GET' || req.method === 'HEAD'
    ? requireAdminOrReadOnly(req, res, next)
    : requireAdmin(req, res, next)
));

// ── P3 — Branding (PLAN.MD §13): brand name + logo + per-role defaults.
// Stored in system_settings ('brand_name', 'brand_logo', 'ui_defaults');
// public read is served by /api/branding (see bottom of this file).

// Brand logo upload — same hardening pattern as the existing upload path:
// images only, 2 MB cap, stored under uploads/branding/. Stored extension is
// derived from the VALIDATED mimetype (never originalname), and content is
// magic-byte checked below — the stored-XSS family from security review
// 2026-10-12 #1 also applied to this upload path.
const BRAND_DIR = path.resolve('uploads', 'branding');
const brandUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdir(BRAND_DIR, { recursive: true }, (err) => cb(err, BRAND_DIR));
    },
    filename: (_req, file, cb) => {
      const ext = extForImageMime(file.mimetype) || '.bin';
      cb(null, `brand-logo-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|svg\+xml|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Logo must be an image (png, jpg, svg, webp, gif)'));
  },
});

router.get('/branding', requireRoot, async (_req, res, next) => {
  try {
    res.json(await readStoredBrand());
  } catch (err) {
    next(err);
  }
});

router.put('/branding', requireRoot, async (req, res, next) => {
  try {
    const { brandName, defaultTheme, defaultAccent, defaultDensity, defaultMotion, roleDefaults } = req.body || {};
    const updates = [];
    if (typeof brandName === 'string') {
      const name = brandName.trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: 'Brand name must not be empty' });
      updates.push({ key: 'brand_name', value: name });
    }
    // Defaults ride one JSON key (ui_defaults) — same blob logic as user
    // prefs; values are validated against the same enums client-side and
    // re-sanitized on read (readStoredBrand). The PUT MERGES into the
    // stored blob so per-role overrides and base keys can be edited
    // independently without clobbering each other.
    const defaults = {};
    if (defaultTheme !== undefined) defaults.theme = String(defaultTheme);
    if (defaultAccent !== undefined) defaults.accent = String(defaultAccent);
    if (defaultDensity !== undefined) defaults.density = String(defaultDensity);
    if (defaultMotion !== undefined) defaults.motion = String(defaultMotion);
    if (roleDefaults !== undefined) {
      // Per-role overrides: validate structurally here (role keys + value
      // whitelist); readStoredBrand re-sanitizes on read.
      if (roleDefaults === null || typeof roleDefaults !== 'object' || Array.isArray(roleDefaults)) {
        return res.status(400).json({ error: 'roleDefaults must be an object' });
      }
      defaults.roles = roleDefaults;
    }
    if (Object.keys(defaults).length > 0) {
      const stored = await settingsModel.get('ui_defaults');
      let merged = {};
      try {
        const parsed = JSON.parse(stored || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) merged = parsed;
      } catch { /* corrupt stored blob → start fresh */ }
      // Shallow-merge base keys, deep-merge roles entries.
      for (const [k, v] of Object.entries(defaults)) {
        if (k === 'roles') {
          merged.roles = { ...(merged.roles || {}), ...v };
        } else {
          merged[k] = v;
        }
      }
      updates.push({ key: 'ui_defaults', value: JSON.stringify(merged) });
    }
    if (updates.length > 0) await settingsModel.setMany(updates);
    res.json({ success: true, ...(await readStoredBrand()) });
  } catch (err) {
    next(err);
  }
});

router.post('/branding/logo', requireRoot, (req, res, next) => {
  brandUpload.single('logo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Logo upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No logo file provided' });
    // Content check: rasters must match their magic bytes; SVG (an
    // intentionally supported logo format) must contain actual <svg> markup
    // so an HTML polyglot claiming image/svg+xml is rejected here rather than
    // neutralized only at serve time.
    let contentOk = false;
    try {
      contentOk = await validateImageFile(req.file.path, req.file.mimetype, { allowSvg: true });
    } catch {
      contentOk = false;
    }
    if (!contentOk) {
      await discardUploaded(req.file.path);
      return res.status(400).json({ error: 'Logo content does not match its declared image type.' });
    }
    try {
      const previous = await settingsModel.get('brand_logo');
      await settingsModel.set('brand_logo', `/uploads/branding/${req.file.filename}`);
      // Best-effort cleanup of the replaced file (do not fail the request).
      if (previous && previous.startsWith('/uploads/branding/')) {
        const old = path.resolve(path.join('uploads', 'branding', path.basename(previous)));
        if (old.startsWith(BRAND_DIR) && old !== path.resolve(path.join('uploads', 'branding', req.file.filename))) {
          fs.unlink(old, () => {});
        }
      }
      res.json({ success: true, brandLogo: `/uploads/branding/${req.file.filename}` });
    } catch (e) {
      next(e);
    }
  });
});

// Batch read (PLAN.MD §13 P1): one GET returns every admin setting plus the
// calling admin's per-user prefs — the Settings page used to fire 11 parallel
// GETs on mount. system_settings values are raw strings ('1'/'0'); the
// per-user prefs object is registry-sanitized. Keys stay snake_case to match
// the per-key GETs this endpoint supersedes.
router.get('/', async (req, res, next) => {
  try {
    const rows = await settingsModel.getAll();
    const settings = {};
    for (const { key, value } of rows) settings[key] = value;
    const { getPreferences } = await import('../services/authService.js');
    const prefs = await getPreferences(req.user.id);
    settings.toastBannersEnabled = prefs.toastBannersEnabled;
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

router.get('/backup-path', async (req, res) => {
  const value = await settingsModel.get('backup_path');
  res.json({ value });
});

router.get('/ws-enabled', async (req, res) => {
  const value = await settingsModel.get('ws_enabled');
  res.json({ value });
});

router.get('/browser-popup-enabled', async (req, res) => {
  const value = await settingsModel.get('browser_popup_enabled');
  res.json({ value });
});

router.get('/conversation-auto-backup', async (req, res) => {
  const value = await settingsModel.get('conversation_auto_backup');
  res.json({ value });
});

router.get('/conversation-backup-interval', async (req, res) => {
  const value = await settingsModel.get('conversation_backup_interval');
  res.json({ value });
});

// Conversation lifecycle settings (auto-archive / retention / quota) — the
// Settings page reads each as { value } and saves them via PUT /.
const LIFECYCLE_SETTINGS = [
  ['conversation-auto-archive-enabled', 'conversation_auto_archive_enabled'],
  ['conversation-auto-archive-days', 'conversation_auto_archive_days'],
  ['conversation-retention-days', 'conversation_retention_days'],
  ['conversation-archive-retention-days', 'conversation_archive_retention_days'],
  ['conversation-storage-quota-mb', 'conversation_storage_quota_mb'],
];
for (const [route, key] of LIFECYCLE_SETTINGS) {
  router.get(`/${route}`, async (req, res) => {
    const value = await settingsModel.get(key);
    res.json({ value });
  });
}

// Manual lifecycle pass (auto-archive idle → purge expired → quota warn).
// Root-only: it moves conversations and permanently purges recycle-bin rows.
router.post('/conversation-auto-archive-run', requireRoot, async (req, res, next) => {
  try {
    const result = await runAutoArchiveOnce({ actorUser: req.user });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// Save settings. The backup path is write-probed before persisting so a
// misconfigured UNC target never silently breaks future backups.
router.put('/', async (req, res, next) => {
  try {
    const { backupPath, wsEnabled, browserPopupEnabled, conversationAutoBackup, conversationBackupInterval,
      conversationAutoArchiveEnabled, conversationAutoArchiveDays, conversationRetentionDays, conversationArchiveRetentionDays, conversationStorageQuotaMb } = req.body || {};
    const updates = [];

    if (typeof wsEnabled === 'boolean') {
      updates.push({ key: 'ws_enabled', value: wsEnabled ? '1' : '0' });
    }
    if (typeof browserPopupEnabled === 'boolean') {
      updates.push({ key: 'browser_popup_enabled', value: browserPopupEnabled ? '1' : '0' });
    }
    if (typeof backupPath === 'string' && backupPath) {
      const probe = await testBackupPath(backupPath);
      if (!probe.success) {
        return res.status(400).json({ error: `Backup path not writable: ${probe.error}` });
      }
      updates.push({ key: 'backup_path', value: backupPath });
    }
    if (typeof conversationAutoBackup === 'boolean') {
      updates.push({ key: 'conversation_auto_backup', value: conversationAutoBackup ? '1' : '0' });
    }
    if (typeof conversationBackupInterval === 'number' && conversationBackupInterval > 0) {
      updates.push({ key: 'conversation_backup_interval', value: String(conversationBackupInterval) });
    }
    if (typeof conversationAutoArchiveEnabled === 'boolean') {
      updates.push({ key: 'conversation_auto_archive_enabled', value: conversationAutoArchiveEnabled ? '1' : '0' });
    }
    if (typeof conversationAutoArchiveDays === 'number' && conversationAutoArchiveDays > 0) {
      updates.push({ key: 'conversation_auto_archive_days', value: String(conversationAutoArchiveDays) });
    }
    if (typeof conversationRetentionDays === 'number' && conversationRetentionDays > 0) {
      updates.push({ key: 'conversation_retention_days', value: String(conversationRetentionDays) });
    }
    if (typeof conversationArchiveRetentionDays === 'number' && conversationArchiveRetentionDays >= 0) {
      updates.push({ key: 'conversation_archive_retention_days', value: String(conversationArchiveRetentionDays) });
    }
    if (typeof conversationStorageQuotaMb === 'number' && conversationStorageQuotaMb >= 0) {
      updates.push({ key: 'conversation_storage_quota_mb', value: String(conversationStorageQuotaMb) });
    }

    if (updates.length > 0) {
      await settingsModel.setMany(updates);
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;