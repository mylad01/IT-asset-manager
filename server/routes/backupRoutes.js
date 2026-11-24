import express from 'express';
import { verifyToken, requireRoot } from '../middleware/authMiddleware.js';
import { runBackup, testBackupPath } from '../services/backupService.js';
import * as backupModel from '../models/backupModel.js';

const router = express.Router();

// All backup routes require root admin
router.use(verifyToken, requireRoot);

router.post('/', async (req, res) => {
  try {
    const result = await runBackup(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 20;
  const history = await backupModel.getBackupHistory(limit);
  res.json(history);
});

router.post('/test-path', async (req, res) => {
  const { path } = req.body;
  if (!path) {
    return res.status(400).json({ error: 'Path is required' });
  }
  const result = await testBackupPath(path);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

export default router;