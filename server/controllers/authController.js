import * as authService from '../services/authService.js';

export async function login(req, res) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const result = await authService.login(req.validated.email, req.validated.password, ip);
  res.json(result);
}

export async function changePassword(req, res) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  await authService.changePassword(req.user.id, req.validated.newPassword, ip);
  res.json({ message: 'Password updated securely.' });
}

export async function getPreferences(req, res) {
  const prefs = await authService.getPreferences(req.user.id);
  res.json(prefs);
}

export async function updatePreferences(req, res) {
  const prefs = await authService.updatePreferences(req.user.id, req.validated);
  res.json(prefs);
}