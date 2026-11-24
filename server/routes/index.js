import express from 'express';
import assetRoutes from './assetRoutes.js';
import assetTypeRoutes from './assetTypeRoutes.js';
import authRoutes from './authRoutes.js';
import departmentRoutes from './departmentRoutes.js';
import userRoutes from './userRoutes.js';
import ticketRoutes from './ticketRoutes.js';
import ticketAnalyticsRoutes from './ticketAnalyticsRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import consumableRoutes from './consumableRoutes.js';
import kitRoutes from './kitRoutes.js';
import backupRoutes from './backupRoutes.js';
import setupRoutes from './setupRoutes.js';
import settingsRoutes from './settingsRoutes.js';
import brandingRoutes from './brandingRoutes.js';
import activityLogRoutes from './activityLogRoutes.js';
import conversationRoutes from './conversationRoutes.js';
import leaveRequestRoutes from './leaveRequestRoutes.js';
import setupGate from '../middleware/setupGate.js';
import connectionManager from '../db/connection.js';
import { getStatusFresh, walBytes } from '../services/diskSpaceService.js';
import { watchdogState } from '../services/watchdogState.js';

const router = express.Router();

router.get('/health', async (_req, res) => {
  const health = await connectionManager.healthCheck();
  // Disk status + WAL size surface here so monitoring can alert on 'low'
  // long before writes start failing. 'critical' marks the whole probe 503:
  // the instance is up, but it is no longer accepting writes.
  const disk = await getStatusFresh().catch(() => null);
  const payload = {
    ...health,
    disk: disk ? { status: disk.status, free_bytes: disk.freeBytes, total_bytes: disk.totalBytes } : { status: 'unknown' },
    wal_bytes: walBytes(),
    // Single-instance invariant, live: who claims the lock, and what the
    // last image-validated watchdog check actually saw. Cross-checking
    // holder_pid against the lock file / netstat / the OTHER instance's
    // health answer is how a split-brain is proven from the outside.
    lock: {
      holder_pid: process.pid,
      enabled: watchdogState.enabled,
      period_ms: watchdogState.periodMs,
      started_at: watchdogState.startedAt,
      last_check_at: watchdogState.lastCheckAt,
      last_check_ms: watchdogState.lastCheckMs,
      ticks: watchdogState.ticks,
      re_stamps: watchdogState.reStamps,
      last_re_stamp_at: watchdogState.lastReStampAt,
      last_re_stamp_reason: watchdogState.lastReStampReason,
      last_verdict: watchdogState.lastVerdict,
      last_error: watchdogState.lastError,
      // Durable events (newest first) — includes the previous run's fatal
      // events, so a port theft / lock conflict stays visible here after
      // the process that detected it has exited.
      recent_events: watchdogState.recentEvents,
    },
  };
  const ok = health.healthy && (!disk || disk.status !== 'critical');
  if (!ok) {
    // A health 503 used to be diagnosable only by cross-referencing the log
    // timestamp. Log the full payload (state, queue depth, integrity, disk)
    // so the probe that failed carries its own explanation.
    const { default: logger } = await import('../utils/logger.js');
    logger.warn({ healthPayload: payload }, 'Health probe answering 503');
  }
  res.status(ok ? 200 : 503).json(payload);
});

router.use(setupGate);

router.use('/auth', authRoutes);
router.use('/assets', assetRoutes);
router.use('/asset-types', assetTypeRoutes);
router.use('/departments', departmentRoutes);
router.use('/users', userRoutes);
router.use('/tickets', ticketRoutes);
router.use('/analytics/tickets', ticketAnalyticsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/activity-logs', activityLogRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/consumables', consumableRoutes);
router.use('/kits', kitRoutes);
router.use('/backup', backupRoutes);
router.use('/conversations', conversationRoutes);
router.use('/leave-requests', leaveRequestRoutes);
router.use('/setup', setupRoutes);
router.use('/settings', settingsRoutes);
router.use('/branding', brandingRoutes);

// ── Leave-requests (spec: 2026-10-13 design) ──
// Mounted under /api/leave-requests. The router's own file declares the literal
// routes (POST /, POST /on-behalf, GET /mine, GET /pending, GET /pending-count,
// GET /coverage, PUT /:id/decide, GET /:id, GET /:id/attachments/:idx) before
// the /:id catch-all so Express 5 order-matches correctly (Task 4).
// (Already mounted above via `router.use('/leave-requests', leaveRequestRoutes)`;
// this comment anchors the cross-reference so a future mount slip is obvious.)


export default router;