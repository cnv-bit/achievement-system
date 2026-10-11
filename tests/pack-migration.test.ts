import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyAchievementSave, validateAchievementSave, buildPlayerView } from '../src/domain/index.ts';
import { packTestCatalog } from './fixtures/pack-catalog.ts';
import { migratePackSave, restorePackSave } from '../src/domain/pack-migration.ts';
import { validatePackManifest } from '../src/domain/content-pack.ts';
import type { AchievementSave, ContentPackManifest } from '../src/domain/types.ts';
import { AchievementMetadataRepository } from '../src/runtime/metadata.ts';
import { attachSaveToPack, type LoadedContentPack } from '../src/runtime/content-pack.ts';
import { AchievementPlayerController } from '../src/runtime/player-controller.ts';
import { PackVersions } from '../src/runtime/pack-versions.ts';

const now = '2026-10-07T00:00:00.000Z';
const hash = 'a'.repeat(64);
function fixture() {
  const manifest: ContentPackManifest = { schemaVersion: 1, packId: 'world', packVersion: '0001', packName: '测试', files: { catalog: hash, layouts: hash, theme: hash }, assets: {} };
  const source = { manifest, packHash: hash, catalog: structuredClone(packTestCatalog) };
  const target = { ...structuredClone(source), packHash: 'b'.repeat(64) };
  target.manifest.packVersion = '0002';
  target.manifest.migrations = [{ fromVersion: '0001', fromHash: hash, nodeIds: {} }];
  const save: AchievementSave = { ...structuredClone(emptyAchievementSave), packId: 'world', packVersion: '0001', packHash: hash };
  save.nodeProgress['bond.demo.reunion'] = { status: 'unlocked', unlockedAt: now, sourceRefs: [], cardId: 'my-card', nodeNameOverride: '玩家名字' };
  save.annotationCards['my-card'] = { cardId: 'my-card', nodeId: 'bond.demo.reunion', style: 'friend', text: '模型文案', textOverride: '玩家文案', sourceRefs: [] };
  save.manualCorrections['bond.demo.reunion'] = { rejectedSourceRefs: [] };
  save.journalEntries.push({ origin: 'player', journalId: 'diary', playerText: '日记保留', sourceRefs: [], createdAt: now });
  save.processedThrough.journal = { messageId: 'message-3', turnIndex: 3 };
  return { source, target, save };
}

test('pack rename migrates all node references, leaves opaque card IDs and journals unchanged, and restores the source snapshot', () => {
  const { source, target, save } = fixture();
  target.catalog = JSON.parse(JSON.stringify(target.catalog).replaceAll('bond.demo.reunion', 'bond.demo.meeting'));
  target.manifest.migrations![0]!.nodeIds = { 'bond.demo.reunion': 'bond.demo.meeting' };
  const before = structuredClone(save);
  const result = migratePackSave(save, source, target, now);
  assert.equal(result.save.packVersion, '0002');
  assert.equal(result.save.nodeProgress['bond.demo.meeting']!.nodeNameOverride, '玩家名字');
  assert.equal(result.save.annotationCards['my-card']!.nodeId, 'bond.demo.meeting');
  assert.equal(result.save.annotationCards['my-card']!.textOverride, '玩家文案');
  assert.ok(result.save.manualCorrections['bond.demo.meeting']);
  assert.equal(result.save.nodeProgress['bond.demo.reunion'], undefined);
  assert.deepEqual(result.save.journalEntries, before.journalEntries);
  assert.deepEqual(result.save.processedThrough, before.processedThrough);
  assert.deepEqual(save, before, 'preview cannot mutate the source');
  assert.equal(validateAchievementSave(result.save).ok, true);
  const restored = restorePackSave(result.save, source, now);
  const { packRollback: _rollback, revision: _revision, ...rest } = restored;
  const { revision: _oldRevision, ...original } = before;
  assert.deepEqual(rest, original);
  assert.equal(restored.packRollback!.snapshot.packVersion, '0002', 'restore also preserves the version being left');
});

test('explicit deletion archives descendants and pending tasks without granting progress; orphan text is viewable but excluded from nodes', () => {
  const { source, target, save } = fixture();
  save.nodeProgress['bond.demo.workshop-visit'] = { status: 'unlocked', unlockedAt: now, sourceRefs: [] };
  target.catalog.modules.bonds.nodes = target.catalog.modules.bonds.nodes.filter(node => node.nodeId !== 'bond.demo.reunion');
  for (const node of target.catalog.modules.bonds.nodes) if (node.prerequisiteNodeIds) node.prerequisiteNodeIds = node.prerequisiteNodeIds.filter(id => id !== 'bond.demo.reunion');
  // A replacement prerequisite is not completed: removing a parent must not invent it.
  target.catalog.modules.bonds.nodes.find(n => n.nodeId === 'bond.demo.workshop-visit')!.prerequisiteNodeIds = ['story.departure'];
  target.manifest.migrations![0]!.nodeIds['bond.demo.reunion'] = null;
  const result = migratePackSave(save, source, target, now);
  assert.deepEqual(Object.keys(result.save.nodeProgress), []);
  assert.equal(result.save.orphanedProgress!.length, 2);
  assert.equal(result.save.orphanedProgress![0]!.cards[0]!.textOverride, '玩家文案');
  assert.equal(result.save.orphanedProgress![0]!.source.packVersion, '0001');
  assert.equal(result.save.annotationCards['my-card'], undefined);
  const view = buildPlayerView(target.catalog, result.save);
  assert.ok(view.orphanedProgress?.length);
  assert.equal(view.nodes.some(n => n.unlocked), false);
  assert.equal(validateAchievementSave(result.save).ok, true);
});

test('version transition uses the shared queue latest state, saves once and restores the source after failure', async () => {
  const { source, target, save } = fixture();
  const emptyLayouts = { schemaVersion: 1 as const, chapters: {}, storyTrees: {}, bondTrees: {}, careerTrees: {}, skillTrees: {}, combatTrees: {}, knowledgeTrees: {}, maps: {} };
  const oldPack: LoadedContentPack = { ...source, layouts: emptyLayouts, theme: { schemaVersion: 1 }, images: {} };
  const newPack: LoadedContentPack = { ...target, layouts: emptyLayouts, theme: { schemaVersion: 1 }, images: {} };
  let stored: unknown = structuredClone(save), fail = true, writes = 0, published = 0;
  const queue = { tail: Promise.resolve() as Promise<unknown> };
  const port = { read: () => structuredClone(stored), write: async (next: Record<string, unknown>) => {
    writes++;
    if (fail) throw new Error('disk');
    stored = structuredClone(next);
  } };
  const old = new AchievementMetadataRepository(port, source.catalog, { contentPack: oldPack, queue, currentChatId: () => 'a' });
  const next = new AchievementMetadataRepository(port, target.catalog, { contentPack: newPack, queue, currentChatId: () => 'a',
    transition: { source: oldPack, convert: current => migratePackSave(current, oldPack, newPack, now).save },
    onCommitted: () => { published++; old.close(); } });
  await assert.rejects(next.initializeContent(), /disk/);
  assert.deepEqual(stored, save); assert.equal(old.load().packVersion, '0001'); assert.equal(published, 0);
  fail = false;
  const edited = new AchievementPlayerController(source.catalog, old).dispatch({ type: 'editJournalEntry', journalId: 'diary', text: '排队后的新文案' });
  const installing = next.initializeContent();
  await Promise.all([edited, installing]);
  assert.equal(next.load().journalEntries[0]!.origin === 'player' && next.load().journalEntries[0]!.playerText, '排队后的新文案');
  assert.equal(next.load().revision, save.revision + 2);
  assert.equal(published, 1); assert.equal(writes, 3);
  assert.equal(attachSaveToPack(next.load(), newPack).packVersion, '0002');
  await next.initializeContent();
  assert.equal(writes, 3, 'new version reload must not migrate again');
});

test('archives and rollback snapshots reject malformed records and recursive snapshots', () => {
  const { source, target, save } = fixture();
  const migrated = migratePackSave(save, source, target, now).save;
  const forged = structuredClone(migrated) as unknown as Record<string, any>;
  forged.packRollback.snapshot.packRollback = structuredClone(forged.packRollback);
  assert.equal(validateAchievementSave(forged).ok, false);
  forged.packRollback = migrated.packRollback;
  forged.orphanedProgress = [{ source: { packId: 'world', packVersion: '../x', packHash: hash }, cards: [], module: 'journal' }];
  assert.equal(validateAchievementSave(forged).ok, false);
});

test('pending completion, retracted edits, chapter and registered image references migrate together', () => {
  const { source, target, save } = fixture();
  save.nodeProgress['career.mage.level-1'] = { status: 'unlocked', unlockedAt: now, sourceRefs: [] };
  save.nodeTasks['career.mage.level-2'] = { acceptedAt: now, claimableAt: now, completionCopy: { description: '待领取文案' }, availabilityNotified: true };
  save.retractedNodeProgress['bond.demo.workshop-visit'] = { status: 'unlocked', unlockedAt: now, sourceRefs: [], nodeNameOverride: '暂存改名' };
  save.currentChapterId = 'chapter.2'; save.chapterProgress['chapter.2'] = { opened: true, completed: false };
  const oldRef = 'assets/bonds/person.demo/nodes/reunion.jpg', newRef = 'assets/bonds/person.demo/nodes/meeting.jpg';
  source.manifest.assets['card.old'] = { assetRef: oldRef, sha256: hash };
  target.manifest.assets['card.new'] = { assetRef: newRef, sha256: hash };
  save.annotationCards['my-card']!.assetRef = oldRef;
  save.annotationCards['my-card']!.imageAlt = '旧纪念图';
  const mapping = { 'career.mage.level-2': 'career.mage.apprentice', 'bond.demo.workshop-visit': 'bond.demo.workshop' };
  for (const [from, to] of Object.entries(mapping)) target.catalog = JSON.parse(JSON.stringify(target.catalog).replaceAll(from, to));
  target.catalog = JSON.parse(JSON.stringify(target.catalog).replaceAll('chapter.2', 'chapter.exploration'));
  Object.assign(target.manifest.migrations![0]!, { nodeIds: mapping, chapterIds: { 'chapter.2': 'chapter.exploration' }, assetRefs: { [oldRef]: newRef } });
  const result = migratePackSave(save, source, target, now).save;
  assert.equal(result.nodeTasks['career.mage.apprentice']!.completionCopy!.description, '待领取文案');
  assert.equal(result.retractedNodeProgress['bond.demo.workshop']!.nodeNameOverride, '暂存改名');
  assert.equal(result.currentChapterId, 'chapter.exploration');
  assert.ok(result.chapterProgress['chapter.exploration']!.opened);
  assert.equal(result.annotationCards['my-card']!.assetRef, newRef);
  assert.equal(validateAchievementSave(result).ok, true);
  target.catalog.modules.careers.nodes.find(node => node.nodeId === 'career.mage.apprentice')!.prerequisiteNodeIds = ['story.departure'];
  const invalidated = migratePackSave(save, source, target, now).save;
  assert.equal(invalidated.nodeTasks['career.mage.apprentice'], undefined);
  assert.equal(invalidated.orphanedProgress![0]!.task!.completionCopy!.description, '待领取文案');
});

test('removing a public picture keeps achievement and copy, while archiving the old picture reference', () => {
  const { source, target, save } = fixture();
  const ref = 'assets/bonds/person.demo/card.jpg';
  source.manifest.assets.card = { assetRef: ref, sha256: hash };
  save.annotationCards['my-card']!.assetRef = ref;
  save.annotationCards['my-card']!.imageAlt = '纪念图';
  assert.throws(() => migratePackSave(save, source, target, now), /图片.*映射/);
  target.manifest.migrations![0]!.assetRefs = { [ref]: null };
  const result = migratePackSave(save, source, target, now).save;
  assert.ok(result.nodeProgress['bond.demo.reunion']);
  assert.equal(result.annotationCards['my-card']!.assetRef, undefined);
  assert.equal(result.annotationCards['my-card']!.textOverride, '玩家文案');
  assert.equal(result.orphanedProgress![0]!.cards[0]!.assetRef, ref);
});

test('version review is read-only; stale previews fail, successful application switches once, and original version can be restored', async () => {
  const { source, target, save } = fixture();
  const layouts = { schemaVersion: 1 as const, chapters: {}, storyTrees: {}, bondTrees: {}, careerTrees: {}, skillTrees: {}, combatTrees: {}, knowledgeTrees: {}, maps: {} };
  const oldPack: LoadedContentPack = { ...source, layouts, theme: { schemaVersion: 1 }, images: {} };
  const newPack: LoadedContentPack = { ...target, layouts, theme: { schemaVersion: 1 }, images: {} };
  let currentPack = oldPack, stored: unknown = structuredClone(save), writes = 0, chatId = 'chat-a';
  const queue = { tail: Promise.resolve() as Promise<unknown> };
  const port = { read: () => structuredClone(stored), write: async (next: Record<string, unknown>) => { writes++; stored = structuredClone(next); } };
  let current = new AchievementMetadataRepository(port, source.catalog, { contentPack: oldPack, queue, currentChatId: () => chatId });
  const versions = new PackVersions({ currentChatId: () => chatId, readCurrent: () => ({ pack: currentPack, save: current.load() }),
    contentPacks: { load: async binding => binding.packVersion === '0001' ? oldPack : newPack },
    activate: async (pack, transition) => {
      const previous = current;
      const next = new AchievementMetadataRepository(port, pack.catalog, { contentPack: pack, transition, queue, currentChatId: () => chatId,
        onCommitted: () => { current = next; currentPack = pack; previous.close(); } });
      await next.initializeContent();
    } });
  const first = await versions.previewUpgrade('0002');
  assert.equal(writes, 0); assert.equal(current.load().packVersion, '0001');
  await new AchievementPlayerController(source.catalog, current).dispatch({ type: 'editJournalEntry', journalId: 'diary', text: '新进度' });
  await assert.rejects(versions.applyPreview(first.token), /重新预览/);
  const preview = await versions.previewUpgrade('0002');
  await versions.applyPreview(preview.token);
  assert.equal(writes, 2); assert.equal(current.load().packVersion, '0002');
  await assert.rejects(versions.applyPreview(preview.token), /失效/);
  const restore = await versions.previewRestore();
  await versions.applyPreview(restore.token);
  assert.equal(current.load().packVersion, '0001'); assert.equal(writes, 3);
  const changing = await versions.previewUpgrade('0002');
  chatId = 'chat-b';
  await assert.rejects(versions.applyPreview(changing.token), /聊天/);
  assert.equal(writes, 3);
});

test('migration rejects merge collisions, missing deletion declarations, wrong fingerprints and unsafe manifest maps', () => {
  const { source, target, save } = fixture();
  target.manifest.migrations![0]!.nodeIds['bond.demo.reunion'] = 'bond.demo.workshop-visit';
  assert.throws(() => migratePackSave(save, source, target, now), /冲突/);
  target.manifest.migrations![0]!.nodeIds = {};
  target.catalog.modules.bonds.nodes.shift();
  assert.throws(() => migratePackSave(save, source, target, now), /明确删除/);
  target.manifest.migrations![0]!.fromHash = 'c'.repeat(64);
  assert.throws(() => migratePackSave(save, source, target, now), /映射/);
  const bad = structuredClone(target.manifest);
  bad.migrations![0]!.nodeIds = JSON.parse('{"__proto__":"x"}');
  assert.throws(() => validatePackManifest(bad), /迁移/);
});

test('version confirmation reloads target and source through the port and rejects changed releases before activation', async () => {
  for (const changed of ['0001', '0002']) {
    const { source, target, save } = fixture();
    const oldPack: LoadedContentPack = { ...source, layouts: {schemaVersion:1,chapters:{},storyTrees:{},bondTrees:{},careerTrees:{},skillTrees:{},combatTrees:{},knowledgeTrees:{},maps:{}}, theme: {schemaVersion:1}, images: {} };
    const newPack = { ...oldPack, ...target };
    const reads: string[] = [];
    let confirmed = false, activated = false;
    const versions = new PackVersions({
      currentChatId: () => 'chat-a', readCurrent: () => ({ pack: oldPack, save }),
      contentPacks: { load: async binding => {
        reads.push(binding.packVersion);
        const pack = binding.packVersion === '0001' ? oldPack : newPack;
        return confirmed && binding.packVersion === changed ? { ...pack, packHash: 'c'.repeat(64) } : pack;
      } },
      activate: async () => { activated = true; },
    });
    const preview = await versions.previewUpgrade('0002');
    confirmed = true;
    await assert.rejects(versions.applyPreview(preview.token), changed === '0001' ? /来源发布版本/ : /目标发布版本/);
    assert.deepEqual(reads, changed === '0001' ? ['0002', '0002', '0001'] : ['0002', '0002']);
    assert.equal(activated, false);
    assert.equal(save.packVersion, '0001');
  }
});

test('chapter completion checks only the chapter story; unrelated archives do not revoke it', () => {
  const { source, target, save } = fixture();
  save.nodeProgress['story.departure'] = { status: 'unlocked', unlockedAt: now, sourceRefs: [] };
  save.chapterProgress['chapter.1'] = { opened: true, completed: true };
  target.catalog.modules.bonds.nodes = [];
  target.manifest.migrations![0]!.nodeIds = Object.fromEntries(source.catalog.modules.bonds.nodes.map(node => [node.nodeId, null]));
  const unchanged = migratePackSave(save, source, target, now);
  assert.equal(unchanged.save.chapterProgress['chapter.1']!.completed, true);
  assert.deepEqual(unchanged.resetChapterIds, []);
  target.catalog.modules.adventure.nodes.push({ ...target.catalog.modules.adventure.nodes[0]!, nodeId: 'story.new-public-node', nodeName: '新公共节点' });
  const changed = migratePackSave(save, source, target, now);
  assert.equal(changed.save.chapterProgress['chapter.1']!.completed, false);
  assert.deepEqual(changed.resetChapterIds, ['chapter.1']);
  assert.equal(changed.save.chapterProgress['chapter.1']!.opened, true);
});
