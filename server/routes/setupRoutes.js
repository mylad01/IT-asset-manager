import express from 'express';
import * as setupService from '../services/setupService.js';

const router = express.Router();

// Status is always accessible
router.get('/status', async (req, res) => {
  const status = await setupService.getStatus();
  res.json({ status });
});

// All other setup routes only accessible during SETUP_PENDING
// The setupGate middleware will enforce this, but we add a check here too
router.use(async (req, res, next) => {
  const status = await setupService.getStatus();
  if (status !== 'SETUP_PENDING') {
    return res.status(409).json({ error: 'Setup already completed' });
  }
  next();
});

router.post('/root-admin', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    await setupService.createRootAdmin({ name, email, password });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/backup', async (req, res) => {
  try {
    const { path } = req.body;
    if (!path) {
      return res.status(400).json({ error: 'Backup path is required' });
    }
    await setupService.saveBackupPath(path);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/backup/test', async (req, res) => {
  try {
    const { path } = req.body;
    if (!path) {
      return res.status(400).json({ error: 'Backup path is required' });
    }
    const result = await setupService.saveBackupPath(path);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/preferences', async (req, res) => {
  try {
    const { wsEnabled, browserPopupEnabled } = req.body;
    await setupService.savePreferences({ wsEnabled, browserPopupEnabled });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/complete', async (req, res) => {
  try {
    await setupService.completeSetup();
    // Auto-login after setup completion
    // Note: In practice, the frontend would call /api/auth/login separately
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;