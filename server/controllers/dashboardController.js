import * as dashboardService from '../services/dashboardService.js';

export async function getStats(req, res) {
  const stats = await dashboardService.getStats();
  res.json(stats);
}
