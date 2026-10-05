import { CONTENT_MODULES } from './types.ts';
import type { AchievementSave, AnnotationCard, BaseNodeDefinition, ContentCatalog, ContentModule, ImageReference, JournalEntry, MessageEvidenceRef, NodeModule, TaskNodeState } from './types.ts';

export type PlayerCommand =
  | { type: 'editNodeCard'; nodeId: string; patch: { nodeName?: string; text?: string } }
  | { type: 'lockNode'; nodeId: string }
  | { type: 'acceptNodeTask'; nodeId: string; acceptedAt: string }
  | { type: 'claimNodeTask'; nodeId: string; claimedAt: string }
  | { type: 'markAvailableTasksNotified'; nodeIds: string[] }
  | { type: 'markClaimableTasksNotified'; nodeIds: string[] }
  | { type: 'addPlayerJournal'; journalId: string; text: string; createdAt: string }
  | { type: 'editJournalEntry'; journalId: string; text: string }
  | { type: 'deleteJournalEntry'; journalId: string };

export interface PlayerCardView extends ImageReference { cardId: string; style: AnnotationCard['style']; text: string }
interface PlayerNodeBase extends ImageReference { nodeId: string; nodeName: string; unlocked: boolean; nodeState?: TaskNodeState; description?: string; card?: PlayerCardView }
export type PlayerNodeView = PlayerNodeBase & (
  | { module: 'adventure'; chapterId: string; storyTreeId: string }
  | { module: 'bonds'; personId: string }
  | { module: 'careers'; careerTreeId: string }
  | { module: 'abilities'; nodeKind: 'skill'; skillTreeId: string; skillOwnerId: string }
  | { module: 'abilities'; nodeKind: 'combat'; combatTreeId: string }
  | { module: 'knowledge'; knowledgeDomainId: string; knowledgeTopicId: string }
  | { module: 'travel'; mapId: string; travelRegionId: string }
);
export interface PlayerJournalView { journalId: string; origin: JournalEntry['origin']; text: string; createdAt: string }
export interface PlayerGroupView extends ImageReference {
  groupId: string; groupName: string; module: NodeModule;
  kind: 'storyTree' | 'person' | 'careerTree' | 'skillOwner' | 'skillTree' | 'combatTree' | 'knowledgeDomain' | 'knowledgeTopic' | 'map' | 'travelRegion';
  parentGroupId?: string; nodeIds: string[];
}
export interface AchievementPlayerView {
  revision: number; nodes: PlayerNodeView[]; journalEntries: PlayerJournalView[];
  groups: PlayerGroupView[]; edges: Array<{ module: NodeModule; from: string; to: string }>;
  chapters: Array<{ chapterId: string; chapterName: string; chapterNumber: number }>;
  moduleNames: Record<ContentModule, string>;
  availableTaskCount: number;
  claimableTaskCount: number;
  actionableTaskCount: number;
  newAvailableTaskIds: string[];
  newClaimableTaskIds: string[];
}

function requireText(input: string, label: string): string {
  const text = input.trim(); if (!text) throw new Error(`${label}不能为空。`); return text;
}
function requireBoundedText(input: string, label: string, maxLength: number): string {
  const text = requireText(input, label);
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符。`); return text;
}
function requireIsoDate(input: string): string {
  const timestamp = requireText(input, '创建时间');
  if (Number.isNaN(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) throw new Error('创建时间必须是 ISO 时间。');
  return timestamp;
}
function nodeDefinitions(catalog: ContentCatalog): Array<{ module: NodeModule; node: BaseNodeDefinition }> {
  return CONTENT_MODULES.flatMap(module => {
    if (module === 'journal') return [];
    const nodes = module === 'travel' ? catalog.modules.travel.locations : catalog.modules[module].nodes;
    return nodes.map(node => ({ module, node }));
  });
}
export function isTaskNode(module: NodeModule, node: BaseNodeDefinition): boolean {
  return module === 'careers' || module === 'knowledge' || (module === 'abilities' && 'nodeKind' in node && node.nodeKind === 'skill');
}
function nodeDefinition(catalog: ContentCatalog, nodeId: string): { module: NodeModule; node: BaseNodeDefinition } | undefined {
  return nodeDefinitions(catalog).find(entry => entry.node.nodeId === nodeId);
}
export function getTaskNodeState(catalog: ContentCatalog, save: AchievementSave, nodeId: string): TaskNodeState | undefined {
  const definition = nodeDefinition(catalog, nodeId);
  if (!definition || !isTaskNode(definition.module, definition.node)) return undefined;
  if (save.nodeProgress[nodeId]) return 'completed';
  if ((definition.node.prerequisiteNodeIds ?? []).some(id => !save.nodeProgress[id])) return 'blocked';
  const task = save.nodeTasks[nodeId];
  if (task?.claimableAt) return 'claimable';
  return task?.acceptedAt ? 'active' : 'available';
}
function skillOwnerVisible(catalog: ContentCatalog, save: AchievementSave, node: BaseNodeDefinition): boolean {
  if (!('skillTreeId' in node) || typeof node.skillTreeId !== 'string') return true;
  const tree = catalog.modules.abilities.skillTrees.find(candidate => candidate.skillTreeId === node.skillTreeId);
  const owner = catalog.modules.abilities.owners.find(candidate => candidate.skillOwnerId === tree?.skillOwnerId);
  return !owner?.revealNodeId || Boolean(save.nodeProgress[owner.revealNodeId]);
}
function taskVisible(catalog: ContentCatalog, save: AchievementSave, module: NodeModule, node: BaseNodeDefinition): boolean {
  return isTaskNode(module, node) && (module !== 'abilities' || skillOwnerVisible(catalog, save, node));
}
function cardView(card: AnnotationCard | undefined): PlayerCardView | undefined {
  if (!card) return undefined;
  return { cardId: card.cardId, style: card.style, text: card.textOverride ?? card.text,
    ...(card.imageName ? { imageName: card.imageName, imageAlt: card.imageAlt! } : {}) };
}
function playerNodeView(node: BaseNodeDefinition, save: AchievementSave, root = false, nodeState?: TaskNodeState): PlayerNodeBase | undefined {
  const progress = save.nodeProgress[node.nodeId];
  if (!progress && !root && nodeState === undefined) return undefined;
  const card = progress?.cardId ? cardView(save.annotationCards[progress.cardId]) : undefined;
  return { nodeId: node.nodeId, nodeName: progress?.nodeNameOverride ?? save.retractedNodeProgress[node.nodeId]?.nodeNameOverride ?? node.nodeName, unlocked: Boolean(progress),
    ...(nodeState ? { nodeState } : {}),
    ...(progress?.generatedCopy?.description ? { description: progress.generatedCopy.description } : {}),
    ...(card ? { card } : {}),
    ...(progress && node.imageName ? { imageName: node.imageName, imageAlt: node.imageAlt! } : {}) };
}
export function buildPlayerView(catalog: ContentCatalog, save: AchievementSave): AchievementPlayerView {
  const m = catalog.modules, nodes: PlayerNodeView[] = [];
  // Only the contiguous opened prefix is revealed. First chapter is the entry.
  const chapters: AchievementPlayerView['chapters'] = [];
  for (const chapter of [...m.adventure.chapters].sort((a,b) => a.chapterNumber - b.chapterNumber)) {
    if (chapter.chapterNumber !== 1 && !save.chapterProgress[chapter.chapterId]?.opened) break;
    chapters.push({ ...chapter });
  }
  const open = new Set(chapters.map(c => c.chapterId));
  for (const node of m.adventure.nodes) {
    const tree = m.adventure.storyTrees.find(t => t.storyTreeId === node.storyTreeId)!;
    if (!open.has(tree.chapterId)) continue;
    const view = playerNodeView(node, save, tree.rootNodeId === node.nodeId);
    if (view) nodes.push({ ...view, module: 'adventure', chapterId: tree.chapterId, storyTreeId: tree.storyTreeId });
  }
  for (const node of m.bonds.nodes) { const v = playerNodeView(node, save); if (v) nodes.push({ ...v, module: 'bonds', personId: node.personId }); }
  for (const node of m.careers.nodes) { const v = playerNodeView(node, save, false, getTaskNodeState(catalog, save, node.nodeId)); if (v) nodes.push({ ...v, module: 'careers', careerTreeId: node.careerTreeId }); }
  for (const node of m.abilities.nodes) {
    if (node.nodeKind === 'skill' && !skillOwnerVisible(catalog, save, node)) continue;
    const v = playerNodeView(node, save, false, node.nodeKind === 'skill' ? getTaskNodeState(catalog, save, node.nodeId) : undefined); if (!v) continue;
    if (node.nodeKind === 'combat') nodes.push({ ...v, module: 'abilities', nodeKind: 'combat', combatTreeId: node.combatTreeId });
    else nodes.push({ ...v, module: 'abilities', nodeKind: 'skill', skillTreeId: node.skillTreeId,
      skillOwnerId: m.abilities.skillTrees.find(t => t.skillTreeId === node.skillTreeId)!.skillOwnerId });
  }
  for (const node of m.knowledge.nodes) { const v = playerNodeView(node, save, false, getTaskNodeState(catalog, save, node.nodeId)); if (v) nodes.push({ ...v, module: 'knowledge',
    knowledgeTopicId: node.knowledgeTopicId, knowledgeDomainId: m.knowledge.topics.find(t => t.knowledgeTopicId === node.knowledgeTopicId)!.knowledgeDomainId }); }
  for (const node of m.travel.locations) { const v = playerNodeView(node, save); if (v) nodes.push({ ...v, module: 'travel',
    travelRegionId: node.travelRegionId, mapId: m.travel.regions.find(r => r.travelRegionId === node.travelRegionId)!.mapId }); }
  const groups: PlayerGroupView[] = [];
  function group(module: NodeModule, kind: PlayerGroupView['kind'], groupId: string, groupName: string, members: PlayerNodeView[], parentGroupId?: string, picture?: ImageReference) {
    if (!members.length) return;
    groups.push({ module, kind, groupId, groupName, nodeIds: members.map(n => n.nodeId),
      ...(parentGroupId ? { parentGroupId } : {}), ...(picture?.imageName ? { imageName: picture.imageName, imageAlt: picture.imageAlt! } : {}) });
  }
  for (const t of m.adventure.storyTrees) group('adventure','storyTree',t.storyTreeId,t.storyTreeName,nodes.filter(n=>n.module==='adventure'&&n.storyTreeId===t.storyTreeId),t.chapterId);
  for (const p of m.bonds.people) group('bonds','person',p.personId,p.personName,nodes.filter(n=>n.module==='bonds'&&n.personId===p.personId),undefined,p);
  for (const t of m.careers.trees) group('careers','careerTree',t.careerTreeId,t.careerTreeName,nodes.filter(n=>n.module==='careers'&&n.careerTreeId===t.careerTreeId));
  for (const o of m.abilities.owners) group('abilities','skillOwner',o.skillOwnerId,o.skillOwnerName,nodes.filter(n=>n.module==='abilities'&&n.nodeKind==='skill'&&n.skillOwnerId===o.skillOwnerId),undefined,o);
  for (const t of m.abilities.skillTrees) group('abilities','skillTree',t.skillTreeId,t.skillTreeName,nodes.filter(n=>n.module==='abilities'&&n.nodeKind==='skill'&&n.skillTreeId===t.skillTreeId),t.skillOwnerId);
  for (const t of m.abilities.combatTrees) group('abilities','combatTree',t.combatTreeId,t.combatTreeName,nodes.filter(n=>n.module==='abilities'&&n.nodeKind==='combat'&&n.combatTreeId===t.combatTreeId));
  for (const d of m.knowledge.domains) group('knowledge','knowledgeDomain',d.knowledgeDomainId,d.knowledgeDomainName,nodes.filter(n=>n.module==='knowledge'&&n.knowledgeDomainId===d.knowledgeDomainId));
  for (const t of m.knowledge.topics) group('knowledge','knowledgeTopic',t.knowledgeTopicId,t.knowledgeTopicName,nodes.filter(n=>n.module==='knowledge'&&n.knowledgeTopicId===t.knowledgeTopicId),t.knowledgeDomainId);
  for (const t of m.travel.maps) group('travel','map',t.mapId,t.mapName,nodes.filter(n=>n.module==='travel'&&n.mapId===t.mapId));
  for (const r of m.travel.regions) group('travel','travelRegion',r.travelRegionId,r.travelRegionName,nodes.filter(n=>n.module==='travel'&&n.travelRegionId===r.travelRegionId),r.mapId);
  const visible = new Map(nodes.map(node => [node.nodeId, node]));
  const scope = new Map<string, string>();
  for (const node of nodes) scope.set(node.nodeId, node.module === 'adventure' ? node.storyTreeId : node.module === 'bonds' ? node.personId :
    node.module === 'careers' ? node.careerTreeId : node.module === 'abilities' ? (node.nodeKind === 'skill' ? node.skillTreeId : node.combatTreeId) :
      node.module === 'knowledge' ? node.knowledgeTopicId : node.travelRegionId);
  const edges = nodeDefinitions(catalog).flatMap(({module,node}) => {
    const target = visible.get(node.nodeId);
    if (!target || (!target.nodeState && !target.unlocked)) return [];
    return (node.prerequisiteNodeIds ?? []).filter(id => {
      const source = visible.get(id);
      return source && source.module === module && scope.get(id) === scope.get(node.nodeId) && (target.nodeState ? true : source.unlocked);
    }).map(from => ({module, from, to: node.nodeId}));
  });
  const available = nodes.filter(node => node.nodeState === 'available');
  const claimable = nodes.filter(node => node.nodeState === 'claimable');
  return { revision: save.revision, nodes, groups, edges, chapters,
    availableTaskCount: available.length,
    claimableTaskCount: claimable.length,
    actionableTaskCount: available.length + claimable.length,
    newAvailableTaskIds: available.filter(node => !save.nodeTasks[node.nodeId]?.availabilityNotified).map(node => node.nodeId),
    newClaimableTaskIds: claimable.filter(node => !save.nodeTasks[node.nodeId]?.claimabilityNotified).map(node => node.nodeId),
    moduleNames: Object.fromEntries(CONTENT_MODULES.map(id=>[id,m[id].moduleName])) as Record<ContentModule,string>,
    journalEntries: save.journalEntries.map(e=>({journalId:e.journalId,origin:e.origin,text:e.origin==='player'?e.playerText:e.playerText??e.generatedText,createdAt:e.createdAt})) };
}

function acceptNodeTask(catalog: ContentCatalog, save: AchievementSave, command: Extract<PlayerCommand, { type: 'acceptNodeTask' }>): void {
  const definition = nodeDefinition(catalog, command.nodeId);
  if (!definition || !taskVisible(catalog, save, definition.module, definition.node)) throw new Error(`节点 ${command.nodeId} 不是当前可见的成长任务。`);
  if (getTaskNodeState(catalog, save, command.nodeId) !== 'available') throw new Error(`节点 ${command.nodeId} 当前不能接取。`);
  save.nodeTasks[command.nodeId] = { ...save.nodeTasks[command.nodeId], acceptedAt: requireIsoDate(command.acceptedAt) };
}

function markAvailableTasksNotified(catalog: ContentCatalog, save: AchievementSave, nodeIds: string[]): void {
  if (!nodeIds.length) throw new Error('没有需要标记的任务提醒。');
  for (const nodeId of new Set(nodeIds)) {
    const definition = nodeDefinition(catalog, nodeId);
    if (!definition || !taskVisible(catalog, save, definition.module, definition.node) || getTaskNodeState(catalog, save, nodeId) !== 'available') {
      throw new Error(`节点 ${nodeId} 当前不是可提醒的任务。`);
    }
    save.nodeTasks[nodeId] = { ...save.nodeTasks[nodeId], availabilityNotified: true };
  }
}

function markClaimableTasksNotified(catalog: ContentCatalog, save: AchievementSave, nodeIds: string[]): void {
  if (!nodeIds.length) throw new Error('没有需要标记的领取提醒。');
  for (const nodeId of new Set(nodeIds)) {
    const definition = nodeDefinition(catalog, nodeId);
    if (!definition || !taskVisible(catalog, save, definition.module, definition.node) || getTaskNodeState(catalog, save, nodeId) !== 'claimable') {
      throw new Error(`节点 ${nodeId} 当前不是可提醒的待领取成就。`);
    }
    save.nodeTasks[nodeId] = { ...save.nodeTasks[nodeId], claimabilityNotified: true };
  }
}

function claimNodeTask(catalog: ContentCatalog, save: AchievementSave, command: Extract<PlayerCommand, { type: 'claimNodeTask' }>): void {
  const definition = nodeDefinition(catalog, command.nodeId);
  if (!definition || !taskVisible(catalog, save, definition.module, definition.node)) throw new Error(`节点 ${command.nodeId} 不是当前可见的成长任务。`);
  if (getTaskNodeState(catalog, save, command.nodeId) !== 'claimable') throw new Error(`节点 ${command.nodeId} 当前不能领取。`);
  const task = save.nodeTasks[command.nodeId]!;
  const archived = save.retractedNodeProgress[command.nodeId];
  const cardId = archived?.cardId ?? `card.node.${command.nodeId}`;
  const previousCard = save.annotationCards[cardId];
  const style = definition.module === 'careers' ? 'career' : definition.module === 'knowledge' ? 'knowledge' : 'skill';
  save.nodeProgress[command.nodeId] = {
    status: 'unlocked',
    unlockedAt: requireIsoDate(command.claimedAt),
    sourceRefs: [],
    cardId,
    ...(archived?.nodeNameOverride ? { nodeNameOverride: archived.nodeNameOverride } : {}),
    ...(task.completionCopy ? { generatedCopy: structuredClone(task.completionCopy) } : {}),
  };
  save.annotationCards[cardId] = {
    cardId,
    nodeId: command.nodeId,
    style,
    text: task.completionCopy?.description ?? definition.node.condition,
    sourceRefs: [],
    ...((previousCard?.imageName ?? definition.node.imageName) ? {
      imageName: (previousCard?.imageName ?? definition.node.imageName)!,
      imageAlt: (previousCard?.imageAlt ?? definition.node.imageAlt)!,
    } : {}),
    ...(previousCard?.textOverride ? { textOverride: previousCard.textOverride } : {}),
  };
  delete save.nodeTasks[command.nodeId];
  delete save.retractedNodeProgress[command.nodeId];
}

function editNodeCard(save: AchievementSave, command: Extract<PlayerCommand, { type: 'editNodeCard' }>): void {
  const progress = save.nodeProgress[command.nodeId];
  const card = progress?.cardId ? save.annotationCards[progress.cardId] : undefined;
  if (!card) throw new Error(`节点 ${command.nodeId} 没有可编辑的附言卡。`);
  if (command.patch.nodeName === undefined && command.patch.text === undefined) throw new Error('没有需要保存的改动。');
  if (command.patch.nodeName !== undefined) progress!.nodeNameOverride = requireBoundedText(command.patch.nodeName, '节点名称', 200);
  if (command.patch.text !== undefined) card.textOverride = requireBoundedText(command.patch.text, '卡片正文', 4_000);
}

function addPlayerJournal(
  catalog: ContentCatalog,
  save: AchievementSave,
  command: Extract<PlayerCommand, { type: 'addPlayerJournal' }>,
): void {
  if (save.journalEntries.some(entry => entry.journalId === command.journalId)) throw new Error(`日记 ${command.journalId} 已存在。`);
  save.journalEntries.push({
    journalId: requireBoundedText(command.journalId, '日记 ID', 200),
    origin: 'player',
    playerText: requireBoundedText(command.text, '日记正文', catalog.modules.journal.maxEntryLength),
    createdAt: requireIsoDate(command.createdAt),
    sourceRefs: [],
  });
}

function editJournalEntry(
  catalog: ContentCatalog,
  save: AchievementSave,
  command: Extract<PlayerCommand, { type: 'editJournalEntry' }>,
): void {
  const entry = save.journalEntries.find(candidate => candidate.journalId === command.journalId);
  if (!entry) throw new Error(`找不到日记 ${command.journalId}。`);
  entry.playerText = requireBoundedText(command.text, '日记正文', catalog.modules.journal.maxEntryLength);
}

function deleteJournalEntry(save: AchievementSave, journalId: string): void {
  const index = save.journalEntries.findIndex(entry => entry.journalId === journalId);
  if (index < 0) throw new Error(`找不到日记 ${journalId}。`);
  save.journalEntries.splice(index, 1);
}

function sameSource(left: MessageEvidenceRef, right: MessageEvidenceRef): boolean {
  return left.messageId === right.messageId && left.contentVersion === right.contentVersion;
}

function lockNode(catalog: ContentCatalog, save: AchievementSave, nodeId: string): void {
  if (!save.nodeProgress[nodeId]) throw new Error(`节点 ${nodeId} 尚未解锁。`);
  const nodes = nodeDefinitions(catalog).map(entry => entry.node);
  const retracted = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (retracted.has(node.nodeId) || !save.nodeProgress[node.nodeId]) continue;
      if ((node.prerequisiteNodeIds ?? []).some(prerequisiteId => retracted.has(prerequisiteId))) {
        retracted.add(node.nodeId);
        changed = true;
      }
    }
  }
  for (const retractedNodeId of retracted) {
    const progress = save.nodeProgress[retractedNodeId];
    if (!progress) continue;
    const correction = save.manualCorrections[retractedNodeId] ?? { rejectedSourceRefs: [] };
    for (const sourceRef of progress.sourceRefs) {
      if (!correction.rejectedSourceRefs.some(existing => sameSource(existing, sourceRef))) {
        correction.rejectedSourceRefs.push(structuredClone(sourceRef));
      }
    }
    save.manualCorrections[retractedNodeId] = correction;
    save.retractedNodeProgress[retractedNodeId] = structuredClone(progress);
    delete save.nodeProgress[retractedNodeId];
  }
  const affected = new Set(retracted);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of nodes) {
      if (!affected.has(node.nodeId) && (node.prerequisiteNodeIds ?? []).some(id => affected.has(id))) {
        affected.add(node.nodeId);
        expanded = true;
      }
    }
  }
  for (const affectedNodeId of affected) delete save.nodeTasks[affectedNodeId];
}

export function applyPlayerCommand(catalog: ContentCatalog, save: AchievementSave, command: PlayerCommand): AchievementSave {
  const next = structuredClone(save);
  if (command.type === 'editNodeCard') editNodeCard(next, command);
  else if (command.type === 'lockNode') lockNode(catalog, next, command.nodeId);
  else if (command.type === 'acceptNodeTask') acceptNodeTask(catalog, next, command);
  else if (command.type === 'claimNodeTask') claimNodeTask(catalog, next, command);
  else if (command.type === 'markAvailableTasksNotified') markAvailableTasksNotified(catalog, next, command.nodeIds);
  else if (command.type === 'markClaimableTasksNotified') markClaimableTasksNotified(catalog, next, command.nodeIds);
  else if (command.type === 'addPlayerJournal') addPlayerJournal(catalog, next, command);
  else if (command.type === 'editJournalEntry') editJournalEntry(catalog, next, command);
  else if (command.type === 'deleteJournalEntry') deleteJournalEntry(next, command.journalId);
  else throw new Error('不支持的玩家操作。');
  next.revision += 1;
  return next;
}
