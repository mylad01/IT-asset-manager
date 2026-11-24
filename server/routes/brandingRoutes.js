// Public branding read (PLAN.MD §13 P3). The LOGIN screen must show the
// brand name/logo before any token exists, so this one endpoint is
// deliberately unauthenticated and read-only — everything mutable stays
// behind requireRoot in settingsRoutes (/api/settings/branding*).
import express from 'express';
import { readStoredBrand } from '../services/brandingService.js';

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    res.json(await readStoredBrand());
  } catch (err) {
    next(err);
  }
});

export default router;
