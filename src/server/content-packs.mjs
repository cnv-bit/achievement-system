import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateContentPack, validatePackBinding, validatePackManifest, isAssetRef, packHashPattern } from '../domain/content-pack.ts';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Resolve symlinks before checking containment, including the release directory itself. */
export async function containedFile(root, relative) {
    const base = await fs.realpath(root);
    const file = await fs.realpath(path.resolve(base, relative));
    const within = path.relative(base, file);
    if (!within || within.startsWith(`..${path.sep}`) || within === '..' || path.isAbsolute(within)) throw new Error('文件越界');
    return file;
}

async function readChecked(root, relative, limit, expectedHash) {
    try {
        const file = await containedFile(root, relative);
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > limit) throw new Error('文件无效或过大');
        const bytes = await fs.readFile(file);
        if (expectedHash && sha256(bytes) !== expectedHash) throw new Error('发布文件已改变');
        return bytes;
    } catch (error) {
        throw new Error(`${relative}：${error.code ?? error.message}`, { cause: error });
    }
}

async function readManifest(root, expected) {
    const manifestBytes = await readChecked(root, 'manifest.json', 2_000_000);
    const manifest = validatePackManifest(JSON.parse(manifestBytes.toString('utf8')));
    if (manifest.packId !== expected.packId || manifest.packVersion !== expected.packVersion) throw new Error('包身份不符');
    return { manifest, packHash: sha256(manifestBytes) };
}

/** Runtime loading checks content and references; image bytes are checked when requested. */
export async function readReleaseMetadata(root, expected) {
    const { manifest, packHash } = await readManifest(root, expected);
    const content = {};
    for (const name of ['catalog', 'layouts', 'theme']) {
        content[name] = JSON.parse((await readChecked(root, `${name}.json`, 8_000_000, manifest.files[name])).toString('utf8'));
    }
    const pack = validateContentPack({ manifest, ...content });
    return { ...pack, packHash };
}

/** Publication and author deployment retain complete file verification. */
export async function readReleaseDirectory(root, expected) {
    const pack = await readReleaseMetadata(root, expected);
    for (const asset of Object.values(pack.manifest.assets)) await readChecked(root, asset.assetRef, 20_000_000, asset.sha256);
    return pack;
}

async function releaseRoot(accountRoot, binding) {
    validatePackBinding(binding);
    return containedFile(accountRoot, `goblin-achievements/packs/${binding.packId}/releases/${binding.packVersion}`);
}

export function registerContentPackRoutes(router) {
    function route(method, name, action) {
        router[method](name, async (req, res) => {
            if (!req.user?.directories?.root) return res.status(401).json({ error: '请先登录酒馆。' });
            res.set('Cache-Control', 'no-store');
            res.set('X-Content-Type-Options', 'nosniff');
            try { return await action(req, res); }
            catch (error) {
                console.error(`[goblin-achievements] ${name}`, error);
                res.set('Cache-Control', 'no-store');
                return res.status(400).json({ error: `内容包载入失败：${error.code ?? error.message ?? '未知错误'}；未切换内容或改写存档。` });
            }
        });
    }
    route('post', '/packs/load', async (req, res) => {
        const binding = validatePackBinding(req.body);
        const root = await releaseRoot(req.user.directories.root, binding);
        return res.json(await readReleaseMetadata(root, binding));
    });
    route('get', '/packs/asset', async (req, res) => {
        const binding = validatePackBinding({ packId: req.query?.packId, packVersion: req.query?.packVersion });
        const ref = req.query?.assetRef;
        if (!isAssetRef(ref)) throw new Error('资源路径无效');
        const root = await releaseRoot(req.user.directories.root, binding);
        const pack = await readManifest(root, binding);
        if (typeof req.query?.packHash !== 'string' || !packHashPattern.test(req.query.packHash) || req.query.packHash !== pack.packHash) throw new Error('图片内容版本已改变');
        const asset = Object.values(pack.manifest.assets).find(asset => asset.assetRef === ref);
        if (!asset) throw new Error('资源未登记');
        const bytes = await readChecked(root, ref, 20_000_000, asset.sha256);
        const ext = path.extname(ref).toLowerCase();
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }[ext];
        res.set('Cache-Control', 'private, max-age=31536000, immutable');
        res.set('Vary', 'Cookie');
        return res.type(mime).send(bytes);
    });
}
