import * as ticketAnalyticsService from '../services/ticketAnalyticsService.js';

export async function getAnalytics(req, res) {
  const analytics = await ticketAnalyticsService.getAnalytics(req.user.id, req.user.isRoot);
  res.json(analytics);
}
