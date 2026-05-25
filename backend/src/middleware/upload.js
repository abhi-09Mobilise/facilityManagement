// Multer file-upload middleware. Files land in UPLOAD_DIR keyed by date so we don't
// pile everything into one folder. Mirrors how the old PHP code stored ticket
// attachments under a single 'docs' folder.

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const baseDir = path.resolve(config.uploads.dir);
fs.mkdirSync(baseDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sub = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dest = path.join(baseDir, sub);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, Date.now() + '_' + safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes },
});

module.exports = upload;
