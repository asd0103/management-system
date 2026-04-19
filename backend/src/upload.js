import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const uploadDir = process.env.SHIYI_UPLOAD_DIR
  ? path.resolve(process.env.SHIYI_UPLOAD_DIR)
  : path.join(backendRoot, 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const stamp = Date.now();
    cb(null, `${stamp}-${file.originalname}`);
  }
});

export const upload = multer({ storage });
