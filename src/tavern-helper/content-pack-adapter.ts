import { validateContentPack, validatePackBinding, packHashPattern } from '../domain/content-pack.ts';
import type { ContentPackPort } from '../runtime/ports.ts';
import type { BackendRequest } from '../settings/backend.ts';

export function createContentPackPort(request: BackendRequest): ContentPackPort {
  return { async load(binding) {
    const identity = validatePackBinding(binding);
    const payload = await request('packs/load', identity) as Record<string, unknown> | null;
    if (!payload || typeof payload !== 'object' || typeof payload.packHash !== 'string' || !packHashPattern.test(payload.packHash)) throw new Error('内容包响应无效。');
    const pack = validateContentPack({ manifest: payload.manifest, catalog: payload.catalog, layouts: payload.layouts, theme: payload.theme });
    if (pack.manifest.packId !== identity.packId || pack.manifest.packVersion !== identity.packVersion) throw new Error('载入内容包身份与请求不符。');
    const images: Record<string, string> = {};
    for (const asset of Object.values(pack.manifest.assets)) {
      images[asset.assetRef] = `/api/plugins/goblin-achievements/packs/asset?${new URLSearchParams({ ...identity, packHash: payload.packHash, assetRef: asset.assetRef })}`;
    }
    for (const [name, ref] of Object.entries(pack.manifest.legacyImageNames ?? {})) images[name] = images[ref]!;
    return { ...pack, packHash: payload.packHash, images };
  } };
}
