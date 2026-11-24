import * as setupService from '../services/setupService.js';

// Paths that are always allowed (not blocked by setup gate).
// Note: this middleware lives inside the /api router, so req.path has the
// /api prefix stripped (e.g. '/auth/login', '/setup/status').
const ALLOWED_PATHS = [
  '/auth/login',
  '/auth/logout',
  '/setup/status',
];

export default async function setupGate(req, res, next) {
  // Check if path is allowed
  const isAllowed = ALLOWED_PATHS.some(path => req.path.startsWith(path));
  if (isAllowed) {
    return next();
  }

  // Allow all setup routes during SETUP_PENDING
  if (req.path.startsWith('/setup/')) {
    return next();
  }

  // Check setup status
  const status = await setupService.getStatus();

  if (status === 'SETUP_PENDING') {
    return res.status(409).json({ error: 'in_setup' });
  }

  next();
}