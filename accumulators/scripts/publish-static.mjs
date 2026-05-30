import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const outDir = path.join(rootDir, 'out');

if (!fs.existsSync(outDir)) {
  console.error('Build output not found at', outDir);
  process.exit(1);
}

for (const entry of fs.readdirSync(outDir)) {
  const from = path.join(outDir, entry);
  const to = path.join(rootDir, entry);
  fs.cpSync(from, to, { recursive: true, force: true });
}

console.log('Published static export from out/ to accumulators/');
