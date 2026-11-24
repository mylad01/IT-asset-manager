import * as ticketService from '../services/ticketService.js';

export async function getMyTickets(req, res) {
  const tickets = await ticketService.getMyTickets(req.user.id);
  res.json(tickets);
}

export async function getAll(req, res) {
  const tickets = await ticketService.getAllTickets(req.user.id, req.user.isRoot);
  res.json(tickets);
}

export async function create(req, res) {
  const { id } = await ticketService.create({
    ...req.validated,
    user_id: req.user.id,
  }, req.log, req);
  res.status(201).json({ message: 'Success', id });
}

export async function assignAdmin(req, res) {
  await ticketService.assignAdmin(req.params.id, req.validated.assigned_admin_id, req.log, req);
  res.json({ message: 'Task reassigned.' });
}

export async function updateStatus(req, res) {
  await ticketService.updateStatus(req.params.id, req.validated.status, req.log, req);
  res.json({ message: 'Updated.' });
}

export async function getComments(req, res) {
  const isITAdmin = req.user.role === 'IT Admin' || req.user.isRoot;
  const comments = await ticketService.getComments(req.params.id, isITAdmin);
  res.json(comments);
}

export async function addComment(req, res) {
  const { text, is_internal } = req.validated;
  await ticketService.addComment(req.params.id, req.user.id, text, is_internal, req.log, req);
  res.status(201).json({ message: 'Comment added' });
}
