import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const source = new URL('../dist/goblin-achievements-server.mjs', import.meta.url);
if (!fs.existsSync(source)) throw new Error('Run npm run build before deploying the server plugin.');
const [tavernArgument] = process.argv.slice(2);
if (!tavernArgument) throw new Error('Usage: node scripts/deploy-server.mjs <SillyTavern-root>');
const targetDir = path.join(path.resolve(tavernArgument), 'plugins', 'goblin-achievements');
const target = path.join(targetDir, 'index.mjs');
if (fs.existsSync(target)) {
    const backups = new URL('../backups/', import.meta.url);
    fs.mkdirSync(backups, { recursive: true });
    fs.copyFileSync(target, new URL(`server-before-${Date.now()}.mjs`, backups));
}
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
assert.equal(fs.readFileSync(target, 'utf8'), fs.readFileSync(source, 'utf8'));
console.log('Backend installed at ' + target + '; restart SillyTavern to load it.');
