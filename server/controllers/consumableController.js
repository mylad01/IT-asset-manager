import * as consumableService from '../services/consumableService.js';

export async function getAll(req, res) {
  const items = await consumableService.getAll();
  res.json(items || []);
}

export async function create(req, res) {
  const { id } = await consumableService.create(req.validated, req);
  res.status(201).json({ message: 'Supply added successfully', id });
}

export async function adjustStock(req, res) {
  const { amount } = req.validated;
  const newQuantity = await consumableService.adjustStock(req.params.id, amount, req);
  res.json({ message: 'Stock updated', newQuantity });
}

export async function remove(req, res) {
  await consumableService.remove(req.params.id, req);
  res.json({ message: 'Item deleted' });
}
