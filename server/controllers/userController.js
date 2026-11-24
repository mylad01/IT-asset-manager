import * as userService from '../services/userService.js';

export async function getAll(req, res) {
  const users = await userService.getAll(req);
  res.json(users);
}

export async function getAdmins(req, res) {
  const admins = await userService.getAdmins();
  res.json(admins);
}

export async function getAssetsByUser(req, res) {
  const assets = await userService.getAssetsByUser(req.params.id);
  res.json(assets);
}

export async function create(req, res) {
  const { id } = await userService.create(req.validated, req);
  res.status(201).json({ message: 'User added successfully', id });
}

export async function update(req, res) {
  await userService.update(req.params.id, req.validated, req);
  res.json({ message: 'User profile updated successfully' });
}

export async function remove(req, res) {
  await userService.remove(req.params.id, req);
  res.status(200).json({ message: 'User deleted' });
}
