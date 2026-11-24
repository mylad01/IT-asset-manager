import * as assetService from '../services/assetService.js';

export async function getAll(req, res) {
  const assets = await assetService.getAll();
  res.json(assets);
}

export async function getUnassigned(req, res) {
  const assets = await assetService.getUnassigned();
  res.json(assets);
}

export async function getById(req, res) {
  const asset = await assetService.getById(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  res.json(asset);
}

export async function getHistory(req, res) {
  const history = await assetService.getHistory(req.params.id);
  res.json(history);
}

export async function getLifecycle(req, res) {
  const lifecycle = await assetService.getLifecycle(req.params.id);
  if (!lifecycle) return res.status(404).json({ error: 'Asset not found.' });
  res.json(lifecycle);
}

export async function create(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Image required.' });
  await assetService.create(req.body, req.file, req);
  // Assets carry a client-supplied business id (asset.id), echoed back so
  // clients can navigate/attach immediately without re-listing.
  res.status(201).json({ message: 'Asset added', id: req.body.id });
}

export async function transfer(req, res) {
  const { new_user_id, new_dept_id, transfer_notes } = req.body;
  await assetService.transfer(req.params.id, new_user_id, new_dept_id, transfer_notes, req.log, req);
  res.json({ message: 'Chain of custody updated successfully.' });
}

export async function addLogEntry(req, res) {
  const { notes, action_type } = req.body;
  await assetService.addLogEntry(req.params.id, notes, action_type, req);
  res.status(201).json({ message: 'Log successfully added to timeline.' });
}

export async function remove(req, res) {
  await assetService.remove(req.params.id, req);
  res.status(200).json({ message: 'Asset deleted' });
}
