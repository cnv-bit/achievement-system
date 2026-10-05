import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const cssPath = path.join(root, 'src', 'frontend', 'journal.css');
const css = fs.readFileSync(cssPath, 'utf8').replace(/url\('\.\/assets\/([^']+)'\)/g, (_, file) => {
  const bytes = fs.readFileSync(path.join(path.dirname(cssPath), 'assets', file));
  const mime = file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
  return `url("data:${mime};base64,${bytes.toString('base64')}")`;
});

await build({
  entryPoints: [path.join(root, 'src', 'tavern-helper', 'index.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: path.join(root, 'dist', 'goblin-achievements.js'),
  loader: { '.png': 'dataurl', '.jpg': 'dataurl' },
  define: { __GOBLIN_JOURNAL_CSS__: JSON.stringify(css) },
});
