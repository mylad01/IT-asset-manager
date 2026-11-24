import { getDb } from '../database.js';

export async function getStats() {
  const db = await getDb();

  const totalAssets = await db.get('SELECT COUNT(*) as count FROM assets');
  const deployedAssets = await db.get('SELECT COUNT(*) as count FROM assets WHERE status = "Deployed"');
  const storageAssets = await db.get('SELECT COUNT(*) as count FROM assets WHERE status = "In Storage"');
  const totalUsers = await db.get('SELECT COUNT(*) as count FROM users');

  const assetsByType = await db.all(`
    SELECT type as name, COUNT(*) as value
    FROM assets
    GROUP BY type
    ORDER BY value DESC
  `);

  const assetsByDept = await db.all(`
    SELECT d.name, COUNT(a.id) as count
    FROM departments d
    LEFT JOIN assets a ON d.id = a.dept_id
    GROUP BY d.id
    ORDER BY count DESC
  `);

  const recentActivity = await db.all(`
    SELECT id, action as action_type, created_at as timestamp, user_name, entity_id
    FROM activity_logs
    ORDER BY created_at DESC
    LIMIT 5
  `);

  return {
    kpis: {
      totalAssets: totalAssets.count,
      deployed: deployedAssets.count,
      storage: storageAssets.count,
      users: totalUsers.count,
    },
    charts: {
      byType: assetsByType,
      byDept: assetsByDept,
    },
    recentActivity,
  };
}
