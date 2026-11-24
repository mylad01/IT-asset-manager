import * as assetModel from '../models/assetModel.js';
import { getDb } from '../database.js';

/**
 * GET /api/assets/:id/preview
 *
 * Returns an enriched asset payload for the Quick Preview Panel.
 * Includes: full asset data (with joined dept/user), latest transaction,
 * parsed custom_attributes, and open ticket count.
 */
export async function getPreview(req, res) {
  const { id } = req.params;

  // 1. Fetch asset with joined department and assigned user
  const asset = await assetModel.getById(id);
  if (!asset) {
    return res.status(404).json({ error: 'Asset not found.' });
  }

  // 2. Fetch the latest transaction (chain of custody entry)
  const history = await assetModel.getHistory(id);
  const latestTransaction = history.length > 0 ? history[0] : null;

  // 3. Count open tickets linked to this asset
  const db = await getDb();
  const row = await db.get(
    `SELECT COUNT(*) as count FROM tickets WHERE asset_id = ? AND status != 'Resolved'`,
    [id]
  );
  const ticketCount = row ? row.count : 0;

  // 4. Safely parse custom_attributes JSON
  let customAttributes = {};
  if (asset.custom_attributes) {
    try {
      customAttributes = JSON.parse(asset.custom_attributes);
    } catch {
      customAttributes = {};
    }
  }

  // 5. Build the enriched response
  res.json({
    id: asset.id,
    type: asset.type,
    model: asset.model,
    serial_number: asset.serial_number,
    purchase_date: asset.purchase_date,
    status: asset.status,
    image_url: asset.image_url,
    dept: asset.dept || null,
    assigned_to: asset.assigned_to || null,
    assigned_to_user_id: asset.assigned_to_user_id || null,
    custom_attributes: customAttributes,
    latestTransaction,
    ticketCount,
  });
}
