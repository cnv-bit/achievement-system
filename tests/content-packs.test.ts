import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyAchievementSave, loadAchievementSave, validateAchievementSave, validateContentCatalog } from '../src/domain/index.ts';
import { packTestCatalog, packTestLayouts } from './fixtures/pack-catalog.ts';
import { isAssetRef, validateContentPack } from '../src/domain/content-pack.ts';
import { attachSaveToPack, selectContentPack } from '../src/runtime/content-pack.ts';
import { createContentPackPort } from '../src/tavern-helper/content-pack-adapter.ts';
import { AchievementMetadataRepository } from '../src/runtime/metadata.ts';
import { AchievementPlayerController } from '../src/runtime/player-controller.ts';
import { buildJournalScene } from '../src/frontend/view-scene.ts';
import { buildPlayerView } from '../src/domain/player-state.ts';

const binding = { packId: 'demo-pack', packVersion: '0001' };
const ref = 'assets/bonds/person.demo/card.jpg';
const hash = 'a'.repeat(64);
function packagePayload() {
  const catalog = structuredClone(packTestCatalog);
  Object.assign(catalog.modules.bonds.people[0]!, {imageName:'person.demo--card--v01.jpg',imageAlt:'测试肖像'});
  return {
    manifest: { schemaVersion: 1 as const, ...binding, packName: '测试包', files: { catalog: hash, layouts: hash, theme: hash },
      assets: { 'person.demo.card': { assetRef: ref, sha256: hash } },
      legacyImageNames: { 'person.demo--card--v01.jpg': ref } },
    catalog, layouts: structuredClone(packTestLayouts), theme: { schemaVersion: 1 }, packHash: hash,
  };
}

test('saved identity wins; unbound history needs explicit mapping and version keeps leading zeros', () => {
  assert.deepEqual(selectContentPack({ ...emptyAchievementSave, ...binding }, { ...binding, packVersion: '0002' }), binding);
  assert.throws(() => selectContentPack(emptyAchievementSave, binding), /旧存档/);
  assert.deepEqual(selectContentPack(emptyAchievementSave, binding, binding), binding);
  assert.deepEqual(selectContentPack(undefined, binding), binding);
  assert.throws(() => selectContentPack(undefined, { ...binding, packVersion: '../draft' }), /不能含路径/);
  assert.throws(() => selectContentPack({ ...emptyAchievementSave, ...binding, schemaVersion: 6 }), /旧版本/);
});

test('pack images are explicit registered paths; old names normalize without touching author data', () => {
  const input = packagePayload();
  const pack = validateContentPack(input);
  assert.equal(pack.catalog.modules.bonds.people[0]!.assetRef, ref);
  assert.equal(pack.catalog.modules.bonds.people[0]!.imageName, undefined);
  assert.equal(input.catalog.modules.bonds.people[0]!.imageName, 'person.demo--card--v01.jpg');
  for (const path of ['../secret.png', '/assets/a.png', 'assets/../a.png', 'assets/a%2f.png', 'https://x/a.png', 'assets/con/a.png']) assert.equal(isAssetRef(path), false);
  const unregistered = packagePayload(); unregistered.manifest.legacyImageNames = {} as typeof unregistered.manifest.legacyImageNames;
  assert.throws(() => validateContentPack(unregistered), /未提供资源映射/);
  const invalid = structuredClone(pack.catalog);
  invalid.modules.bonds.people[0]!.assetRef = 'assets/../a.png';
  assert.equal(validateContentCatalog(invalid).ok, false);
});

test('loaded pack URLs use pinned identity/hash and node pictures flow through the existing scene adapter', async () => {
  const pack = await createContentPackPort(async (route, sent) => {
    assert.equal(route, 'packs/load'); assert.deepEqual(sent, binding); return packagePayload();
  }).load(binding);
  assert.match(pack.images[ref]!, /packVersion=0001/);
  assert.match(pack.images[ref]!, /packHash=/);
  const save = structuredClone(emptyAchievementSave);
  save.nodeProgress['bond.demo.reunion'] = { status: 'unlocked', unlockedAt: '2026-10-07T00:00:00.000Z', sourceRefs: [] };
  const scene = buildJournalScene(buildPlayerView(pack.catalog, save), pack.layouts, 'bonds', ref => pack.images[ref]);
  assert.equal(scene.groups![0]!.image!.url, pack.images[ref]);
  assert.equal(pack.images['person.demo--card--v01.jpg'], pack.images[ref]);
  await assert.rejects(createContentPackPort(async () => ({ ...packagePayload(), manifest: { ...packagePayload().manifest, packVersion: '0002' } })).load(binding), /身份/);
});

test('v6 migration preserves progress and original backup; pack binding is saved only after successful initialization', async () => {
  const old = { ...structuredClone(emptyAchievementSave), schemaVersion: 6, revision: 5 };
  old.journalEntries.push({ journalId: 'my-note', origin: 'player', playerText: '保留', createdAt: '2026-10-07T00:00:00.000Z', sourceRefs: [] });
  const migrated = loadAchievementSave(old);
  assert.ok(migrated.ok);
  assert.equal(migrated.value.schemaVersion, 7);
  assert.deepEqual(migrated.value.migrationBackup, old);
  assert.equal(migrated.value.packId, undefined);
  const pack = await createContentPackPort(async () => packagePayload()).load(binding);
  let stored: unknown = structuredClone(old), fail = true, published = 0;
  const metadata = new AchievementMetadataRepository({ read: () => structuredClone(stored), write: async value => {
    if (fail) throw new Error('disk'); stored = structuredClone(value);
  } }, pack.catalog, { contentPack: pack, currentChatId: () => 'chat-a', onCommitted: () => { published++; } });
  await assert.rejects(metadata.initializeContent(), /disk/);
  assert.deepEqual(stored, old); assert.equal(published, 0);
  fail = false; await metadata.initializeContent();
  assert.equal(metadata.load().packVersion, '0001');
  assert.equal(metadata.load().journalEntries[0]!.origin, 'player');
  assert.equal(metadata.load().revision, 6);
  await metadata.initializeContent(); assert.equal(published, 2, 'reload publishes latest state, without increasing revision');
  assert.equal(metadata.load().revision, 6);
  assert.equal(validateAchievementSave(metadata.load()).ok, true);
});

test('a pinned save cannot silently switch version, accept changed release bytes, or invent unknown nodes', async () => {
  const pack = await createContentPackPort(async () => packagePayload()).load(binding);
  const save = attachSaveToPack(structuredClone(emptyAchievementSave), pack);
  assert.throws(() => attachSaveToPack(save, { ...pack, manifest: { ...pack.manifest, packVersion: '0002' } }), /不能直接换包/);
  assert.throws(() => attachSaveToPack(save, { ...pack, packHash: 'b'.repeat(64) }), /内容已改变/);
  save.nodeProgress['unknown.node'] = { status: 'unlocked', unlockedAt: '2026-10-07T00:00:00.000Z', sourceRefs: [] };
  assert.throws(() => attachSaveToPack(save, pack), /不存在的节点/);
});

test('replacement repositories keep one queue, and retired instance commands never overwrite the bound save', async () => {
  const pack = await createContentPackPort(async () => packagePayload()).load(binding);
  const queue = { tail: Promise.resolve() as Promise<unknown> };
  let stored: unknown = undefined;
  const port = { read: () => structuredClone(stored), write: async (save: Record<string, unknown>) => { stored = structuredClone(save); } };
  const old = new AchievementMetadataRepository(port, packTestCatalog, { queue, currentChatId: () => 'chat-a' });
  const player = new AchievementPlayerController(packTestCatalog, old);
  const first = player.dispatch({ type: 'addPlayerJournal', journalId: 'before', text: '先保存', createdAt: '2026-10-07T00:00:00.000Z' });
  const next = new AchievementMetadataRepository(port, pack.catalog, { contentPack: pack, queue, currentChatId: () => 'chat-a', onCommitted: () => old.close() });
  const installing = next.initializeContent();
  const late = player.dispatch({ type: 'addPlayerJournal', journalId: 'after', text: '旧命令', createdAt: '2026-10-07T00:00:00.000Z' });
  const rejected = assert.rejects(late, /实例已更换/);
  await Promise.all([first, installing, rejected]);
  assert.deepEqual(next.load().journalEntries.map(entry => entry.journalId), ['before']);
  assert.equal(next.load().packId, binding.packId);
});

test('shared queue hides provisional bindings and a no-write reload publishes the latest confirmed edits', async () => {
  const pack = await createContentPackPort(async () => packagePayload()).load(binding);
  const queue = { tail: Promise.resolve() as Promise<unknown> };
  let stored: unknown = structuredClone(emptyAchievementSave);
  let startWrite!: () => void, finishWrite!: () => void;
  const started = new Promise<void>(resolve => { startWrite = resolve; });
  const release = new Promise<void>(resolve => { finishWrite = resolve; });
  let delay = true;
  const port = { read: () => structuredClone(stored), write: async (save: Record<string, unknown>) => {
    stored = structuredClone(save);
    if (delay) { startWrite(); await release; delay = false; }
  } };
  const inline = new AchievementMetadataRepository(port, packTestCatalog, { queue, currentChatId: () => 'chat-a' });
  const bound = new AchievementMetadataRepository(port, pack.catalog, { queue, contentPack: pack, currentChatId: () => 'chat-a' });
  const installing = bound.initializeContent();
  await started;
  assert.equal(inline.load().packId, undefined, 'unconfirmed binding must not leak to the old reader');
  finishWrite(); await installing;
  const player = new AchievementPlayerController(pack.catalog, bound);
  const writing = player.dispatch({ type: 'addPlayerJournal', journalId: 'latest', text: '加载期间保存', createdAt: '2026-10-07T00:00:00.000Z' });
  let published: string[] = [];
  const reload = new AchievementMetadataRepository(port, pack.catalog, { queue, contentPack: pack, currentChatId: () => 'chat-a',
    onCommitted: save => { published = save.journalEntries.map(entry => entry.journalId); bound.close(); } });
  const reloading = reload.initializeContent();
  await Promise.all([writing, reloading]);
  assert.deepEqual(published, ['latest']);
  assert.equal(reload.load().revision, 2, 'reload does not write a redundant revision');
});
