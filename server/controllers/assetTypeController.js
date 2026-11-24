import * as assetTypeModel from '../models/assetTypeModel.js';

export async function getAll(req, res) {
  const types = await assetTypeModel.getAll();
  res.json(types);
}

export async function create(req, res) {
  const { name } = req.validated;
  await assetTypeModel.create(name);
  res.status(201).json({ message: 'Asset type created successfully' });
}

export async function remove(req, res) {
  await assetTypeModel.remove(req.params.id);
  res.json({ message: 'Asset type deleted successfully' });
}
