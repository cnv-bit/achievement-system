import { CONTENT_MODULES, type AchievementSave, type ContentPackBinding } from '../domain/index.ts';
import { type validateContentPack, validatePackBinding, normalizeSavedCardImages } from '../domain/content-pack.ts';
import { nodeCompletionIssue, nodePrerequisitesSatisfied, isTaskNode } from '../domain/player-state.ts';

export type LoadedContentPack = ReturnType<typeof validateContentPack> & { packHash: string; images: Record<string, string> };

/** A saved binding wins over the card's default; unbound history requires an explicit author mapping. */
export function selectContentPack(stored: unknown, cardDefault?: ContentPackBinding, legacy?: ContentPackBinding): ContentPackBinding {
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const save = stored as Record<string, unknown>;
    if (save.packId !== undefined || save.packVersion !== undefined) {
      if (save.schemaVersion !== 7) throw new Error('旧版本存档不能冒用新绑定字段，请通过明确的旧包映射迁移。');
      return validatePackBinding({ packId: save.packId, packVersion: save.packVersion });
    }
    if (Object.keys(save).length) {
      if (!legacy) throw new Error('旧存档尚未绑定内容包，请明确填写 GOBLIN_ACHIEVEMENTS_LEGACY_PACK，不会猜测版本。');
      return validatePackBinding(legacy);
    }
  } else if (stored !== undefined && stored !== null) throw new Error('成就存档格式无效。');
  if (!cardDefault) throw new Error('当前角色未指定内容包。');
  return validatePackBinding(cardDefault);
}

function assertSaveFitsPack(save: AchievementSave, pack: LoadedContentPack): void {
  const nodes = [
    ...pack.catalog.modules.adventure.nodes,
    ...pack.catalog.modules.bonds.nodes,
    ...pack.catalog.modules.careers.nodes,
    ...pack.catalog.modules.abilities.nodes,
    ...pack.catalog.modules.knowledge.nodes,
    ...pack.catalog.modules.travel.locations,
  ];
  const ids = new Set(nodes.map(node => node.nodeId));
  const savedIds = [...Object.keys(save.nodeProgress), ...Object.keys(save.retractedNodeProgress), ...Object.keys(save.nodeTasks), ...Object.keys(save.manualCorrections), ...Object.values(save.annotationCards).map(card => card.nodeId)];
  if (savedIds.some(id => !ids.has(id))) throw new Error('旧存档含包内不存在的节点，不能自动绑定；节点迁移属于阶段 C。');
  for (const node of nodes) if (save.nodeProgress[node.nodeId]) {
    const issue = nodeCompletionIssue(pack.catalog, save, node.nodeId);
    if (issue) throw new Error(issue);
  }
  for (const module of CONTENT_MODULES) {
    if (module === 'journal' || module === 'travel') continue;
    for (const node of pack.catalog.modules[module].nodes) if (save.nodeTasks[node.nodeId] && (!isTaskNode(module, node) || !nodePrerequisitesSatisfied(node, save))) throw new Error('存档任务与内容包的前置或任务类型不符。');
  }
  const chapters = new Set(pack.catalog.modules.adventure.chapters.map(chapter => chapter.chapterId));
  if ([...Object.keys(save.chapterProgress), ...(save.currentChapterId ? [save.currentChapterId] : [])].some(id => !chapters.has(id))) throw new Error('存档章节不属于当前内容包。');
}

export function attachSaveToPack(save: AchievementSave, pack: LoadedContentPack): AchievementSave {
  const { packId, packVersion } = pack.manifest;
  if (save.packId !== undefined && (save.packId !== packId || save.packVersion !== packVersion)) throw new Error('存档已绑定其他内容包版本，不能直接换包；请保留旧版本。');
  if (save.packHash !== undefined && save.packHash !== pack.packHash) throw new Error('同一发布版本内容已改变，拒绝载入；请恢复原版本或发布新版本。');
  assertSaveFitsPack(save, pack);
  return { ...save, packId, packVersion, packHash: pack.packHash,
    annotationCards: normalizeSavedCardImages(save.annotationCards, pack.manifest) };
}
