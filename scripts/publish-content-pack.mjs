import { publishContentPack } from '../src/server/publish-content-pack.mjs';
export { publishContentPack } from '../src/server/publish-content-pack.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [draft, packs] = process.argv.slice(2);
    if (!draft || !packs) throw new Error('用法：node --experimental-strip-types scripts/publish-content-pack.mjs <draft目录> <packs根目录>');
    console.log(await publishContentPack(draft, packs));
}
