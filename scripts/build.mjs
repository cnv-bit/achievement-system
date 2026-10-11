import path from 'node:path';
import { build } from 'esbuild';
import { readJournalCss } from './journal-css.mjs';

const root = path.resolve(import.meta.dirname, '..');
const css = readJournalCss(root);

await build({
  entryPoints: [path.join(root, 'src', 'server', 'index.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: path.join(root, 'dist', 'goblin-achievements-server.mjs'),
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
