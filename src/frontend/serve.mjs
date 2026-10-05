import { context } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const build = await context({
  absWorkingDir: root, entryPoints: ['demo.ts'], bundle: true, format: 'esm', platform: 'browser',
  target: 'es2022', outdir: '.preview', sourcemap: true, loader: { '.png': 'dataurl', '.jpg': 'dataurl' },
});
await build.watch();
const server = await build.serve({ servedir: root, host: '127.0.0.1', port: 4178 });
console.log(`Journal preview: http://127.0.0.1:${server.port}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await build.dispose(); process.exit(0); });
