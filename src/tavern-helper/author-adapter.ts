import type { AuthorDraft, AuthorPreflight, AuthorStoragePort } from '../runtime/authoring.ts';
import { validateAuthorDocument } from '../domain/authoring.ts';
import { validatePackBinding } from '../domain/content-pack.ts';
import type { BackendRequest } from '../settings/backend.ts';

function draft(value: unknown): AuthorDraft {
  const doc = value as AuthorDraft;
  if (!doc || typeof doc.revision !== 'string' || !/^[a-f0-9]{64}$/.test(doc.revision)) throw new Error('后端草稿修订无效。');
  validateAuthorDocument(doc);
  return doc;
}
export function createAuthorStoragePort(request: BackendRequest): AuthorStoragePort {
  return {
    list: async () => {
      const list = await request('author/list');
      if (!Array.isArray(list) || list.some(row => !row || typeof row.packId !== 'string' || typeof row.packName !== 'string')) throw new Error('草稿列表无效。');
      return list;
    },
    load: async packId => draft(await request('author/load', { packId })),
    create: async (packId, packName) => draft(await request('author/create', { packId, packName })),
    importRelease: async binding => draft(await request('author/import', binding)),
    save: async value => draft(await request('author/save', value)),
    refreshAssets: async (packId, revision) => draft(await request('author/assets', { packId, revision })),
    preflight: async (packId, revision) => {
      const result = await request('author/preflight', { packId, revision }) as AuthorPreflight;
      if (!result || result.revision !== revision || typeof result.fingerprint !== 'string' || !Array.isArray(result.issues)) throw new Error('预检结果无效。');
      return result;
    },
    publish: async (packId, preflight) => validatePackBinding(await request('author/publish', { packId, preflight })),
  };
}
export function authorAssetUrl(packId: string, assetRef: string, revision: string): string {
  return `/api/plugins/goblin-achievements/author/asset?${new URLSearchParams({ packId, assetRef, revision })}`;
}
