import fs from 'node:fs';
import path from 'node:path';

export function readJournalCss(root) {
  const cssPath = path.join(root, 'src', 'frontend', 'journal.css');
  return fs.readFileSync(cssPath, 'utf8').replace(/url\('\.\/assets\/([^']+)'\)/g, (_, file) => {
    const bytes = fs.readFileSync(path.join(path.dirname(cssPath), 'assets', file));
    const mime = file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    return `url("data:${mime};base64,${bytes.toString('base64')}")`;
  });
}
