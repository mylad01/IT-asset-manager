import path from 'path';
import fsSync from 'fs';
import { createReadStream } from 'fs';
import * as leaveRequestService from '../services/leaveRequestService.js';
import { leaveRequestsDir } from '../utils/uploadPaths.js';

export async function submit(req, res) {
  const { id } = await leaveRequestService.submit({
    actor: req.user,
    targetUserId: req.user.id,
    body: req.validated,
    files: req.files,
    logger: req.log,
    req,
  });
  res.status(201).json({ message: 'Leave request submitted.', id });
}

export async function submitOnBehalf(req, res) {
  const { user_id: targetUserId, ...body } = req.validated;
  const { id } = await leaveRequestService.submit({
    actor: req.user,
    targetUserId,
    body,
    files: req.files,
    logger: req.log,
    req,
  });
  res.status(201).json({ message: 'Leave request filed on behalf of the selected user.', id });
}

export async function mine(req, res) {
  res.json(await leaveRequestService.listMine(req.user.id));
}

export async function pending(req, res) {
  res.json(await leaveRequestService.listPending(req.user, req.validated.view));
}

export async function pendingCount(req, res) {
  res.json({ count: await leaveRequestService.pendingCount(req.user) });
}

export async function coverage(req, res) {
  const { from, to } = req.validated;
  res.json(await leaveRequestService.listCoverage(req.user, from, to));
}

export async function decide(req, res) {
  const { decision, decision_note } = req.validated;
  const { message } = await leaveRequestService.decide(
    Number(req.params.id), decision, decision_note ?? null, req.user, req.log, req);
  res.json({ message });
}

export async function getById(req, res) {
  res.json(await leaveRequestService.getVisible(Number(req.params.id), req.user));
}

// Spec §4 #9: the ONLY path that serves leave attachment bytes.
export async function downloadAttachment(req, res) {
  const id = Number(req.params.id);
  const idx = Number(req.params.idx);
  const row = await leaveRequestService.getVisible(id, req.user); // 404/403 via AppError
  const attachments = Array.isArray(row.attachments) ? row.attachments : [];
  if (!Number.isInteger(idx) || idx < 0 || idx >= attachments.length) {
    return res.status(404).json({ error: 'Attachment not found.' });
  }
  const att = attachments[idx];
  // Containment: basename only, resolved inside leave-requests/ — a tampered
  // attachments JSON can never climb out of the directory.
  const dir = leaveRequestsDir();
  const abs = path.join(dir, path.basename(String(att.path || '')));
  if (!abs.startsWith(dir + path.sep) || !fsSync.existsSync(abs)) {
    return res.status(404).json({ error: 'Attachment file missing on disk.' });
  }
  res.setHeader('Content-Type', String(att.mime || 'application/octet-stream'));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(String(att.name || 'attachment'))}"`);
  createReadStream(abs).pipe(res);
}
