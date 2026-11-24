import jwt from 'jsonwebtoken';
import env from '../config/env.js';

export const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];

  if (!token) return res.status(401).json({ error: 'Access Denied: No token provided.' });

  try {
    const decoded = jwt.verify(token.split(' ')[1], env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Access Denied: Invalid or expired token.' });
  }
};

export const requireAdmin = (req, res, next) => {
  if (!req.user || (req.user.role !== 'IT Admin' && !req.user.isRoot)) {
    return res.status(403).json({ error: 'Forbidden: IT Admin privileges strictly required to perform this action.' });
  }

  next();
};

// Read-Only is a read-everything role (PLAN.MD §16.5 F1/F2): it may pass
// the read GETs behind the Dashboard and the Settings batch load. Staff and
// any other role still fails closed; writes must never route through this
// guard — keep them on requireAdmin.
export const requireAdminOrReadOnly = (req, res, next) => {
  if (!req.user || (req.user.role !== 'IT Admin' && req.user.role !== 'Read-Only' && !req.user.isRoot)) {
    return res.status(403).json({ error: 'Forbidden: IT Admin or Read-Only privileges required to read this resource.' });
  }

  next();
};

export const requireRoot = (req, res, next) => {
  if (!req.user || !req.user.isRoot) {
    return res.status(403).json({ error: 'Forbidden: Root privileges strictly required to perform this action.' });
  }

  next();
};

// ── Leave-requests guards (spec: 2026-10-13 design §2/§7) ──
// Submit: Staff + IT Admin/root only; Department Manager and Read-Only 403
// (managers don't file their own leave — admins use POST /on-behalf).
export const requireLeaveSubmitter = (req, res, next) => {
  if (!req.user || (req.user.role !== 'Staff' && req.user.role !== 'IT Admin' && !req.user.isRoot)) {
    return res.status(403).json({ error: 'Forbidden: only Staff and IT Admin can submit leave requests.' });
  }
  next();
};

// Decide / approve-inbox write gate: manager, IT Admin or root.
export const requireLeaveApprover = (req, res, next) => {
  if (!req.user || (req.user.role !== 'Department Manager' && req.user.role !== 'IT Admin' && !req.user.isRoot)) {
    return res.status(403).json({ error: 'Forbidden: leave approvals require Department Manager or IT Admin privileges.' });
  }
  next();
};

// Inbox/coverage READ gate: approvers plus Read-Only (read-everything role).
export const requireLeaveReader = (req, res, next) => {
  if (!req.user || (req.user.role !== 'Department Manager' && req.user.role !== 'IT Admin' && req.user.role !== 'Read-Only' && !req.user.isRoot)) {
    return res.status(403).json({ error: 'Forbidden: leave inbox access requires an approver or Read-Only role.' });
  }
  next();
};
