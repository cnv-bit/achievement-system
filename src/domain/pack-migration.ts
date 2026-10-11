import { prerequisiteIds } from './dependencies.ts';
import type { AchievementSave, ContentCatalog, ContentPackIdentity, ContentPackManifest, OrphanedProgress } from './types.ts';
import { nodeDefinitions, nodeCompletionIssue, nodePrerequisitesSatisfied, isTaskNode } from './player-state.ts';
import { validateAchievementSave } from './validation.ts';

export interface MigrationPack { manifest: ContentPackManifest; packHash: string; catalog: ContentCatalog }
export interface PackMigrationResult {
  save: AchievementSave;
  renamed: Array<{ from: string; to: string }>;
  archived: Array<{ nodeId: string; nodeName: string; reason: string }>;
  archivedChapters: string[];
  resetChapterIds: string[];
}
interface MigrationWorkspace {
  original: AchievementSave;
  next: AchievementSave;
  source: MigrationPack;
  target: MigrationPack;
  now: string;
  mapping: Map<string, string | null>;
  inverse: Map<string, string>;
  archived: PackMigrationResult['archived'];
  archivedChapters: string[];
}

function identity(pack: MigrationPack): ContentPackIdentity {
  return { packId: pack.manifest.packId, packVersion: pack.manifest.packVersion, packHash: pack.packHash };
}
function assertIdentity(save: AchievementSave, pack: MigrationPack): void {
  if (save.packId !== pack.manifest.packId || save.packVersion !== pack.manifest.packVersion || save.packHash !== pack.packHash) throw new Error('迁移来源与存档绑定身份或指纹不符。');
}
function checkedSave(save: AchievementSave): AchievementSave {
  const validated = validateAchievementSave(save);
  if (!validated.ok) throw new Error('迁移工作副本校验失败：' + validated.issues.map(issue => `${issue.path}: ${issue.message}`).join('；'));
  return validated.value;
}
function snapshot(save: AchievementSave): Omit<AchievementSave, 'packRollback'> {
  // ponytail: one undo/redo snapshot avoids recursive backup growth; multi-version history belongs to external chat backups.
  const copy = structuredClone(save);
  delete copy.packRollback;
  return copy;
}

function resetIncompleteChapters(catalog: ContentCatalog, save: AchievementSave): string[] {
  const nodes = nodeDefinitions(catalog).map(entry => entry.node);
  const closed = new Set(nodes.filter(node => node.choiceGroupId && nodes.some(peer => peer.nodeId !== node.nodeId && peer.choiceGroupId === node.choiceGroupId && save.nodeProgress[peer.nodeId])).map(node => node.nodeId));
  let before: number;
  do {
    before = closed.size;
    for (const node of nodes) if (prerequisiteIds(node).some(id => closed.has(id))) closed.add(node.nodeId);
  } while (closed.size !== before);
  const treeChapters = new Map(catalog.modules.adventure.storyTrees.map(tree => [tree.storyTreeId, tree.chapterId]));
  return Object.entries(save.chapterProgress).flatMap(([id, state]) => {
    if (!state.completed || catalog.modules.adventure.nodes.filter(node => treeChapters.get(node.storyTreeId) === id && !closed.has(node.nodeId)).every(node => save.nodeProgress[node.nodeId])) return [];
    state.completed = false;
    return [id];
  });
}

/** Simultaneous one-to-one mapping, including collisions with unchanged identities. */
function resolvedMap(oldIds: string[], newIds: string[], mapping: Record<string, string | null>, label: string): Map<string, string | null> {
  const targets = new Set<string>(), available = new Set(newIds), originals = new Set(oldIds);
  const issues = Object.keys(mapping).filter(id => !originals.has(id)).map(id => `${label}来源不存在：${id}`);
  const resolved = new Map<string, string | null>();
  for (const id of oldIds) {
    const target = Object.hasOwn(mapping, id) ? mapping[id]! : id;
    if (target !== null && !available.has(target)) issues.push(`${label} ${id} 缺少目标；请明确删除或改名。`);
    if (target !== null && targets.has(target)) issues.push(`${label}目标冲突：${target}`);
    if (target !== null) targets.add(target);
    resolved.set(id, target);
  }
  if (issues.length) throw new Error('迁移冲突：' + issues.join('；'));
  return resolved;
}
function remapRecord<T>(rows: Record<string, T>, mapping: Map<string, string | null>): Record<string, T> {
  return Object.fromEntries(Object.entries(rows).flatMap(([id, row]) => {
    if (!mapping.has(id)) throw new Error(`存档引用 ${id} 不属于来源内容包。`);
    const target = mapping.get(id);
    return target ? [[target, structuredClone(row)]] : [];
  }));
}

function archiveNode(source: MigrationPack, original: AchievementSave, id: string, stamp: { reason: string; now: string }): OrphanedProgress {
  const definition = nodeDefinitions(source.catalog).find(entry => entry.node.nodeId === id)!;
  return { source: identity(source), archivedAt: stamp.now, reason: stamp.reason, nodeId: id, nodeName: definition.node.nodeName, module: definition.module,
    ...(original.nodeProgress[id] ? { progress: structuredClone(original.nodeProgress[id]) } : {}),
    ...(original.retractedNodeProgress[id] ? { retractedProgress: structuredClone(original.retractedNodeProgress[id]) } : {}),
    ...(original.nodeTasks[id] ? { task: structuredClone(original.nodeTasks[id]) } : {}),
    ...(original.manualCorrections[id] ? { correction: structuredClone(original.manualCorrections[id]) } : {}),
    cards: Object.values(original.annotationCards).filter(card => card.nodeId === id).map(card => structuredClone(card)) };
}
function removeNode(save: AchievementSave, id: string): void {
  delete save.nodeProgress[id]; delete save.retractedNodeProgress[id]; delete save.nodeTasks[id]; delete save.manualCorrections[id];
  for (const [cardId, card] of Object.entries(save.annotationCards)) if (card.nodeId === id) delete save.annotationCards[cardId];
}
function recordedIds(save: AchievementSave): Set<string> {
  return new Set([...Object.keys(save.nodeProgress), ...Object.keys(save.retractedNodeProgress), ...Object.keys(save.nodeTasks), ...Object.keys(save.manualCorrections), ...Object.values(save.annotationCards).map(card => card.nodeId)]);
}

function migrateChapters(work: MigrationWorkspace, mapping: Map<string, string | null>): void {
  const { original: save, next, source, target, now } = work;
  next.chapterProgress = remapRecord(save.chapterProgress, mapping);
  delete next.currentChapterId;
  for (const chapter of source.catalog.modules.adventure.chapters) {
    if (mapping.get(chapter.chapterId) !== null || (!save.chapterProgress[chapter.chapterId] && save.currentChapterId !== chapter.chapterId)) continue;
    (next.orphanedChapters ??= []).push({ source: identity(source), archivedAt: now, chapterId: chapter.chapterId, chapterName: chapter.chapterName,
      ...(save.chapterProgress[chapter.chapterId] ? { progress: structuredClone(save.chapterProgress[chapter.chapterId]!) } : {}), wasCurrent: save.currentChapterId === chapter.chapterId });
    work.archivedChapters.push(chapter.chapterId);
  }
  if (save.currentChapterId) {
    const mapped = mapping.get(save.currentChapterId);
    if (mapped === undefined) throw new Error('当前章节不属于来源内容包。');
    next.currentChapterId = mapped ?? target.catalog.modules.adventure.chapters.find(c => c.chapterNumber === 1)!.chapterId;
  }
}

function migrateImages(work: MigrationWorkspace, mapping: Record<string, string | null>): void {
  const { next, original, source, target, now } = work;
  const registered = new Set(Object.values(target.manifest.assets).map(asset => asset.assetRef));
  const oldRefs = new Set(Object.values(source.manifest.assets).map(asset => asset.assetRef));
  for (const [from, to] of Object.entries(mapping)) if (!oldRefs.has(from) || (to !== null && !registered.has(to))) throw new Error('图片迁移来源或目标未登记。');
  const archived: OrphanedProgress[] = [];
  for (const card of Object.values(next.annotationCards)) {
    if (!card.assetRef) continue;
    const ref = Object.hasOwn(mapping, card.assetRef) ? mapping[card.assetRef]! : card.assetRef;
    if (ref !== null && !registered.has(ref)) throw new Error(`图片 ${card.assetRef} 缺少迁移映射，请明确删除或改名。`);
    if (ref) card.assetRef = ref;
    else {
      const oldCard = original.annotationCards[card.cardId]!;
      const entry = archiveNode(source, original, oldCard.nodeId, { reason: '公有图片被明确删除；当前文案仍保留', now });
      delete entry.progress; delete entry.retractedProgress; delete entry.task; delete entry.correction;
      entry.cards = [structuredClone(oldCard)];
      archived.push(entry);
      delete card.assetRef;
      delete card.imageAlt;
    }
  }
  if (archived.length) {
    (next.orphanedProgress ??= []).push(...archived);
    work.archived.push(...archived.map(entry => ({ nodeId: entry.nodeId, nodeName: entry.nodeName, reason: entry.reason })));
  }
}

function archiveNodeRecord(work: MigrationWorkspace, from: string, to: string | null, reason: string): void {
  const entry = archiveNode(work.source, work.original, from, { reason, now: work.now });
  (work.next.orphanedProgress ??= []).push(entry);
  work.archived.push({ nodeId: from, nodeName: entry.nodeName, reason });
  if (to) removeNode(work.next, to);
}
function projectNodeFacts(work: MigrationWorkspace): void {
  const { original: save, next, mapping } = work;
  for (const id of recordedIds(save)) {
    if (!mapping.has(id)) throw new Error(`存档引用 ${id} 不属于来源内容包。`);
    if (mapping.get(id) === null) archiveNodeRecord(work, id, null, '节点被明确删除');
  }
  next.nodeProgress = remapRecord(save.nodeProgress, mapping);
  next.retractedNodeProgress = remapRecord(save.retractedNodeProgress, mapping);
  next.nodeTasks = remapRecord(save.nodeTasks, mapping);
  next.manualCorrections = remapRecord(save.manualCorrections, mapping);
  next.annotationCards = Object.fromEntries(Object.entries(save.annotationCards).flatMap(([id, card]) => {
    const mapped = mapping.get(card.nodeId);
    return mapped ? [[id, { ...structuredClone(card), nodeId: mapped }]] : [];
  }));
}
function removeInvalidFacts(work: MigrationWorkspace): void {
  const { next, target } = work;
  const nodes = nodeDefinitions(target.catalog);
  // A removed prerequisite can invalidate arbitrary descendants, not just immediate children.
  let invalid: Array<{ id: string; reason: string }>;
  do {
    invalid = nodes.flatMap(({ node, module }) => {
      const reason = next.nodeProgress[node.nodeId] ? nodeCompletionIssue(target.catalog, next, node.nodeId)
        : next.nodeTasks[node.nodeId] && (!isTaskNode(module, node) || !nodePrerequisitesSatisfied(node, next)) ? '任务前置失效，接取与待领取记录退出新版本' : undefined;
      return reason ? [{ id: node.nodeId, reason }] : [];
    });
    for (const row of invalid) archiveNodeRecord(work, work.inverse.get(row.id)!, row.id, row.reason);
  } while (invalid.length);
}

/** Preview is a pure working copy. No release files, chat state or model rules are changed. */
export function migratePackSave(save: AchievementSave, source: MigrationPack, target: MigrationPack, now: string): PackMigrationResult {
  checkedSave(save); assertIdentity(save, source);
  if (source.manifest.packId !== target.manifest.packId || source.manifest.packVersion === target.manifest.packVersion) throw new Error('只能明确迁移同一内容包的不同发布版本。');
  const migration = target.manifest.migrations?.find(row => row.fromVersion === source.manifest.packVersion && row.fromHash === source.packHash);
  if (!migration) throw new Error('目标版本缺少匹配来源版本与指纹的迁移映射。');
  const oldNodes = nodeDefinitions(source.catalog), newNodes = nodeDefinitions(target.catalog);
  const mapping = resolvedMap(oldNodes.map(n => n.node.nodeId), newNodes.map(n => n.node.nodeId), migration.nodeIds, '节点');
  const chapters = resolvedMap(source.catalog.modules.adventure.chapters.map(c => c.chapterId), target.catalog.modules.adventure.chapters.map(c => c.chapterId), migration.chapterIds ?? {}, '章节');
  for (const old of oldNodes) {
    const id = mapping.get(old.node.nodeId), current = newNodes.find(n => n.node.nodeId === id);
    const lifecycleUpgrade = source.catalog.schemaVersion === 2 && target.catalog.schemaVersion === 3;
    const kindChanged = current && 'nodeKind' in old.node && (!('nodeKind' in current.node) || old.node.nodeKind !== current.node.nodeKind);
    if (current && (current.module !== old.module || kindChanged || (!lifecycleUpgrade && isTaskNode(current.module, current.node) !== isTaskNode(old.module, old.node)))) throw new Error(`节点 ${old.node.nodeId} 不能跨模块或改变任务类型；请删除旧节点并新增。`);
  }
  const next = structuredClone(save);
  const work: MigrationWorkspace = { original: save, next, source, target, now, mapping,
    inverse: new Map([...mapping].flatMap(([from, to]) => to ? [[to, from]] : [])), archived: [], archivedChapters: [] };
  projectNodeFacts(work);
  removeInvalidFacts(work);
  migrateChapters(work, chapters);
  const resetChapterIds = resetIncompleteChapters(target.catalog, next);
  migrateImages(work, migration.assetRefs ?? {});
  Object.assign(next, identity(target));
  next.packRollback = { savedAt: now, snapshot: snapshot(save) };
  next.revision = save.revision + 1;
  return { save: checkedSave(next), renamed: [...mapping].flatMap(([from, to]) => to && from !== to ? [{ from, to }] : []), archived: work.archived, archivedChapters: work.archivedChapters, resetChapterIds };
}

/** Restoring replaces progress deliberately, but also preserves the version being left. */
export function restorePackSave(save: AchievementSave, original: MigrationPack, now: string): AchievementSave {
  checkedSave(save);
  if (!save.packRollback) throw new Error('没有可恢复的原版本快照。');
  const next = structuredClone(save.packRollback.snapshot);
  assertIdentity(next, original);
  next.revision = save.revision + 1;
  const restored: AchievementSave = { ...next, packRollback: { savedAt: now, snapshot: snapshot(save) } };
  return checkedSave(restored);
}
