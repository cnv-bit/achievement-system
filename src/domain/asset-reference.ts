import type { ImageReference } from './types.ts';

export const packHashPattern = /^[a-f0-9]{64}$/;
export function isPackKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(value) && !value.includes('..')
    && !['constructor', 'prototype'].includes(value) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}
export function isAssetRef(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 400 && /^assets\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.(png|jpe?g|webp|gif|avif)$/i.test(value)
    && value.split('/').every(part => !part.includes('..') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export function imageReference(ref?: ImageReference): ImageReference {
  if (!ref || (!ref.assetRef && !ref.imageName)) return {};
  return { ...(ref.assetRef ? { assetRef: ref.assetRef } : { imageName: ref.imageName! }), imageAlt: ref.imageAlt ?? '' };
}
