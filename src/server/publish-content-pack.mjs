import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePackBinding, validatePackManifest, isAssetRef } from '../domain/content-pack.ts';
import { containedFile, readReleaseDirectory, sha256 } from './content-packs.mjs';

async function draftManifest(draft) {
    const manifest = JSON.parse(await fs.readFile(await containedFile(draft, 'manifest.json'), 'utf8'));
    manifest.files = {};
    for (const name of ['catalog', 'layouts', 'theme']) manifest.files[name] = sha256(await fs.readFile(await containedFile(draft, `${name}.json`)));
    for (const asset of Object.values(manifest.assets ?? {})) {
        if (!isAssetRef(asset.assetRef)) throw new Error('草稿资源路径无效。');
        asset.sha256 = sha256(await fs.readFile(await containedFile(draft, asset.assetRef)));
    }
    return validatePackManifest(manifest);
}

async function releasesDirectory(packsDirectory, packId) {
    await fs.mkdir(packsDirectory, { recursive: true });
    const safeRoot = await fs.realpath(packsDirectory);
    const packDirectory = path.join(safeRoot, packId);
    try { await fs.mkdir(packDirectory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const safePack = await containedFile(safeRoot, packId);
    try { await fs.mkdir(path.join(safePack, 'releases')); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    return containedFile(safeRoot, `${packId}/releases`);
}

async function copyDraftRelease(draft, stage, manifest) {
    const refs = [...new Set(['catalog.json', 'layouts.json', 'theme.json', ...Object.values(manifest.assets).map(asset => asset.assetRef)])];
    for (const ref of refs) {
        const target = path.join(stage, ref);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(await containedFile(draft, ref), target);
    }
    await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
}

/** Shared author publication: stage, validate completely, never overwrite a release. */
export async function publishContentPack(draftDirectory, packsDirectory, assertCurrent) {
    const draft = await fs.realpath(draftDirectory);
    const manifest = await draftManifest(draft);
    const binding = validatePackBinding({ packId: manifest.packId, packVersion: manifest.packVersion });
    const safeReleases = await releasesDirectory(packsDirectory, binding.packId);
    const destination = path.join(safeReleases, binding.packVersion);
    // mkdir is the exclusive reservation; failed staging never becomes a visible release.
    const reservation = path.join(safeReleases, `.publishing-${binding.packVersion}`);
    // ponytail: a crashed publisher leaves its reservation; manually clear only after confirming no publisher is running.
    await fs.mkdir(reservation);
    let stage;
    try {
        try { await fs.lstat(destination); throw new Error('发布版本已存在，不得覆盖；请使用新 packVersion。'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        stage = await fs.mkdtemp(path.join(safeReleases, '.staging-'));
        await copyDraftRelease(draft, stage, manifest);
        await readReleaseDirectory(stage, binding);
        await assertCurrent?.();
        await fs.rename(stage, destination);
        stage = undefined;
        return destination;
    } finally {
        // Only directories created by this call are removed, never a release or author draft.
        if (stage) await fs.rm(stage, { recursive: true, force: true });
        await fs.rmdir(reservation);
    }
}
