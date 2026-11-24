import multer from 'multer';
import { resolve } from 'path';
import crypto from 'crypto';
import { extForImageMime } from '../utils/uploadSafety.js';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, resolve('uploads/'));
  },
  filename: function (req, file, cb) {
    // The stored extension is derived from the VALIDATED Content-Type, never
    // from originalname — client filename is attacker-controlled and its
    // extension decides the Content-Type express.static sends (stored-XSS
    // vector: `xss.html` + image/png claim → served as text/html).
    const ext = extForImageMime(file.mimetype) || '.bin';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

export default upload;
