import type { AnnotationCard, ContentPackBinding, ContentPackManifest, ContentPackTheme } from './types.ts';
import { rankBadgeKeys } from './types.ts';
import { validateContentCatalog, validateContentLayouts } from './validation.ts';
import { isPackKey, isAssetRef, packHashPattern } from './asset-reference.ts';
export { isPackKey, isAssetRef, packHashPattern } from './asset-reference.ts';

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 须为对象。`);
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label} 含未知字段。`);
}
export function validatePackBinding(value: unknown): ContentPackBinding {
  const binding = record(value, '内容包绑定');
  fields(binding, ['packId', 'packVersion'], '内容包绑定');
  if (!isPackKey(binding.packId) || !isPackKey(binding.packVersion)) throw new Error('内容包 ID 和版本须为安全的非空字符串，不能含路径；版本不转成数字。');
  return { packId: binding.packId, packVersion: binding.packVersion };
}

export function validatePackManifest(value: unknown): ContentPackManifest {
  const manifest = record(value, 'manifest');
  fields(manifest, ['schemaVersion', 'packId', 'packVersion', 'packName', 'files', 'assets', 'legacyImageNames', 'migrations'], 'manifest');
  validatePackBinding({ packId: manifest.packId, packVersion: manifest.packVersion });
  if (manifest.schemaVersion !== 1 || typeof manifest.packName !== 'string' || !manifest.packName.trim() || manifest.packName.length > 200) throw new Error('manifest 版本或名称无效。');
  const hashes = record(manifest.files, 'manifest.files');
  fields(hashes, ['catalog', 'layouts', 'theme'], 'manifest.files');
  if (['catalog', 'layouts', 'theme'].some(key => typeof hashes[key] !== 'string' || !packHashPattern.test(hashes[key] as string))) throw new Error('内容 JSON 缺少 SHA-256 校验值。');
  const assets = record(manifest.assets, 'manifest.assets');
  if (Object.keys(assets).length > 10_000) throw new Error('资源登记过多。');
  for (const [id, entry] of Object.entries(assets)) {
    const asset = record(entry, `资源 ${id}`);
    fields(asset, ['assetRef', 'sha256'], `资源 ${id}`);
    if (!isPackKey(id) || !isAssetRef(asset.assetRef) || typeof asset.sha256 !== 'string' || !packHashPattern.test(asset.sha256)) throw new Error(`资源 ${id} 登记无效。`);
  }
  const registered = new Set(Object.values(assets).map(entry => (entry as { assetRef: string }).assetRef));
  if (manifest.legacyImageNames !== undefined) for (const [name, ref] of Object.entries(record(manifest.legacyImageNames, '旧图片映射'))) {
    if (!/^[a-zA-Z0-9._-]+\.(png|jpe?g|webp|gif|avif)$/i.test(name) || name.includes('..') || !registered.has(ref as string)) throw new Error('旧图片映射必须指向登记过的包内资源。');
  }
  if (manifest.migrations !== undefined) validateMigrations(manifest.migrations, manifest.packVersion as string, registered);
  return structuredClone(manifest) as unknown as ContentPackManifest;
}

function validateMigrations(input: unknown, version: string, assets: Set<unknown>): void {
  if (!Array.isArray(input) || input.length > 100) throw new Error('迁移表须为最多 100 项的数组。');
  const sources = new Set<string>();
  for (const entry of input) {
    const migration = record(entry, '迁移');
    fields(migration, ['fromVersion', 'fromHash', 'nodeIds', 'chapterIds', 'assetRefs'], '迁移');
    if (!isPackKey(migration.fromVersion) || migration.fromVersion === version || typeof migration.fromHash !== 'string' || !packHashPattern.test(migration.fromHash)) throw new Error('迁移来源版本或指纹无效。');
    const key = `${migration.fromVersion}:${migration.fromHash}`;
    if (sources.has(key)) throw new Error('迁移来源重复。');
    sources.add(key);
    validateMigrationMap(migration.nodeIds, isMigrationId);
    if (migration.chapterIds !== undefined) validateMigrationMap(migration.chapterIds, isMigrationId);
    if (migration.assetRefs !== undefined) {
      const mapping = validateMigrationMap(migration.assetRefs, isAssetRef);
      if (Object.values(mapping).some(ref => ref !== null && !assets.has(ref))) throw new Error('迁移图片目标未登记。');
    }
  }
}
function isMigrationId(value: unknown): boolean {
  return typeof value === 'string' && !!value.trim() && value.trim() === value && value.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(value);
}

function validateMigrationMap(input: unknown, valid: (id: unknown) => boolean): Record<string, unknown> {
  const mapping = record(input, '迁移映射');
  if (Object.keys(mapping).length > 10_000) throw new Error('迁移映射过多。');
  const targets = new Set<unknown>();
  for (const [from, to] of Object.entries(mapping)) {
    if (!valid(from) || (to !== null && !valid(to))) throw new Error('迁移映射标识无效。');
    if (to !== null && targets.has(to)) throw new Error('迁移映射不能合并，目标冲突。');
    if (to !== null) targets.add(to);
  }
  return mapping;
}

export function validatePackTheme(value: unknown, manifest: ContentPackManifest): ContentPackTheme {
  const theme = record(value, 'theme');
  fields(theme, ['schemaVersion', 'colors', 'assets', 'rankBadges'], 'theme');
  if (theme.schemaVersion !== 1) throw new Error('theme 须为版本 1。');
  if (theme.colors !== undefined) {
    const colors = record(theme.colors, 'theme.colors');
    fields(colors, ['paper', 'ink', 'accent'], 'theme.colors');
    if (Object.values(colors).some(color => typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color))) throw new Error('主题颜色须为六位十六进制颜色。');
  }
  if (theme.assets !== undefined) {
    const assets = record(theme.assets, 'theme.assets');
    fields(assets, ['paper', 'seal', 'corner', 'bestiaryBookCover'], 'theme.assets');
    const refs = new Set(Object.values(manifest.assets).map(asset => asset.assetRef));
    if (Object.values(assets).some(ref => !refs.has(ref as string))) throw new Error('主题图片未在 manifest 登记。');
  }
  if (theme.rankBadges !== undefined) {
    const badges = record(theme.rankBadges, 'theme.rankBadges');
    fields(badges, [...rankBadgeKeys], 'theme.rankBadges');
    const refs = new Set(Object.values(manifest.assets).map(asset => asset.assetRef));
    if (Object.values(badges).some(ref => !refs.has(ref as string))) throw new Error('评级图片未在 manifest 登记。');
  }
  return structuredClone(theme) as unknown as ContentPackTheme;
}

/** Normalize only explicitly registered legacy names; never guess a path. */
export function normalizePackImages<T>(value: T, manifest: ContentPackManifest): T {
  const copy = structuredClone(value);
  const registered = new Set(Object.values(manifest.assets).map(asset => asset.assetRef));
  function visit(item: unknown): void {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    const row = item as Record<string, unknown>;
    if (typeof row.imageName === 'string' && row.assetRef === undefined) {
      const ref = manifest.legacyImageNames?.[row.imageName];
      if (ref) { row.assetRef = ref; delete row.imageName; }
      else throw new Error(`旧图片 ${row.imageName} 未提供资源映射。`);
    }
    if (row.assetRef !== undefined && !registered.has(row.assetRef as string)) throw new Error('图片引用未在 manifest 登记。');
    Object.values(row).forEach(visit);
  }
  visit(copy);
  return copy;
}

/** Old generated cards may refer to unavailable private images; keep their names, never guess public replacements. */
export function normalizeSavedCardImages(cards: Record<string, AnnotationCard>, manifest: ContentPackManifest): Record<string, AnnotationCard> {
  const copy = structuredClone(cards);
  const registered = new Set(Object.values(manifest.assets).map(asset => asset.assetRef));
  for (const card of Object.values(copy)) {
    const ref = card.imageName ? manifest.legacyImageNames?.[card.imageName] : undefined;
    if (ref && !card.assetRef) { card.assetRef = ref; delete card.imageName; }
    if (card.assetRef && !registered.has(card.assetRef)) throw new Error('存档卡片的公有图片未在 manifest 登记。');
  }
  return copy;
}

export function validateContentPack(input: { manifest: unknown; catalog: unknown; layouts: unknown; theme: unknown }) {
  const manifest = validatePackManifest(input.manifest);
  const catalog = validateContentCatalog(normalizePackImages(input.catalog, manifest));
  if (!catalog.ok) throw new Error('包内目录无效：' + catalog.issues.map(issue => `${issue.path}: ${issue.message}`).join('；'));
  const layouts = validateContentLayouts(normalizePackImages(input.layouts, manifest), catalog.value);
  if (!layouts.ok) throw new Error('包内布局无效：' + layouts.issues.map(issue => `${issue.path}: ${issue.message}`).join('；'));
  return { manifest, catalog: catalog.value, layouts: layouts.value, theme: validatePackTheme(input.theme, manifest) };
}
