import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const target of ['dist', path.join('public', 'js')]) {
  await rm(path.join(root, target), { recursive: true, force: true });
}
console.log('Cleaned dist/ and public/js/');
