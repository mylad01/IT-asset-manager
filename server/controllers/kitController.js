import * as kitService from '../services/kitService.js';

export async function getAll(req, res) {
  const kits = await kitService.getAll();
  res.json(kits || []);
}

export async function getPreview(req, res) {
  const preview = await kitService.getPreview(req.params.id);
  if (!preview) return res.status(404).json({ error: 'Kit not found.' });
  res.json(preview);
}

export async function create(req, res) {
  const { id } = await kitService.create(req.validated, req);
  res.status(201).json({ message: 'Kit created successfully', id });
}

export async function deploy(req, res) {
  const { user_id, dept_id, asset_selections } = req.validated;
  const { count, deployed, missing } = await kitService.deploy(req.params.id, user_id, dept_id, req.log, asset_selections, req);
  const response = { message: `Successfully deployed ${count} assets to user.`, deployed };
  if (missing && missing.length > 0) {
    response.warning = 'Some assets were missing from storage room.';
    response.missing = missing;
  }
  res.json(response);
}

export async function remove(req, res) {
  await kitService.remove(req.params.id, req);
  res.json({ message: 'Kit deleted' });
}
