import * as departmentModel from '../models/departmentModel.js';

export async function getAll(req, res) {
  const depts = await departmentModel.getAll();
  res.json(depts);
}

export async function getUsersByDept(req, res) {
  const users = await departmentModel.getUsersByDept(req.params.id);
  res.json(users);
}

export async function create(req, res) {
  const { name } = req.validated;
  await departmentModel.create(name);
  res.status(201).json({ message: 'Department added' });
}

export async function remove(req, res) {
  await departmentModel.remove(req.params.id);
  res.status(200).json({ message: 'Department deleted' });
}
