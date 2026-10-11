import type { BaseNodeDefinition, ContentCatalog, ContentLayouts, ContentPackManifest, ContentPackTheme, TreeLayout, ValidationIssue } from './types.ts';
import { branchParentId, prerequisiteIds, nodeTreeId } from './dependencies.ts';
import { validateContentCatalog, validateContentLayouts } from './validation.ts';
import { isPackKey } from './asset-reference.ts';
import { validatePackManifest, validatePackTheme } from './content-pack.ts';

export interface AuthorDocument {
  manifest: ContentPackManifest;
  catalog: ContentCatalog;
  layouts: ContentLayouts;
  theme: ContentPackTheme;
  pendingBranchNodeIds: string[];
}
export type AuthorKind = 'chapter' | 'story' | 'person' | 'career' | 'owner' | 'skill' | 'monster' | 'domain' | 'topic';
export const authorKinds = {
  chapter: { module: 'adventure', collection: 'chapters', id: 'chapterId', name: 'chapterName', label: '剧情阶段' },
  story: { module: 'adventure', collection: 'storyTrees', id: 'storyTreeId', name: 'storyTreeName', parent: 'chapterId', layout: 'storyTrees', label: '剧情树' },
  person: { module: 'bonds', collection: 'people', id: 'personId', name: 'personName', layout: 'bondTrees', label: '人物' },
  career: { module: 'careers', collection: 'trees', id: 'careerTreeId', name: 'careerTreeName', layout: 'careerTrees', label: '职业' },
  owner: { module: 'abilities', collection: 'owners', id: 'skillOwnerId', name: 'skillOwnerName', label: '技能所属者' },
  skill: { module: 'abilities', collection: 'skillTrees', id: 'skillTreeId', name: 'skillTreeName', parent: 'skillOwnerId', layout: 'skillTrees', label: '技能树' },
  monster: { module: 'abilities', collection: 'combatTrees', id: 'combatTreeId', name: 'combatTreeName', layout: 'combatTrees', label: '怪物' },
  domain: { module: 'knowledge', collection: 'domains', id: 'knowledgeDomainId', name: 'knowledgeDomainName', label: '知识领域' },
  topic: { module: 'knowledge', collection: 'topics', id: 'knowledgeTopicId', name: 'knowledgeTopicName', parent: 'knowledgeDomainId', layout: 'knowledgeTrees', label: '知识主题' },
} as const;
export function entityAssetPath(kind: AuthorKind, id: string): string {
  const spec = authorKinds[kind];
  const sub = kind === 'monster' ? '/combat' : kind === 'skill' ? '/skills' : kind === 'owner' ? '/owners' : '';
  return `assets/${spec.module}${sub}/${id}/${kind === 'person' ? 'card' : 'cover'}.webp`;
}

export function authorEntities(document: AuthorDocument, kind: AuthorKind): Record<string, unknown>[] {
  const spec = authorKinds[kind];
  return (document.catalog.modules[spec.module] as unknown as Record<string, Record<string, unknown>[]>)[spec.collection]!;
}
export function authorNodes(document: AuthorDocument): BaseNodeDefinition[] {
  const m = document.catalog.modules;
  return [...m.adventure.nodes, ...m.bonds.nodes, ...m.careers.nodes, ...m.abilities.nodes, ...m.knowledge.nodes, ...m.travel.locations];
}
export function treeLayout(document: AuthorDocument, kind: AuthorKind, id: string): TreeLayout {
  const spec = authorKinds[kind];
  if (!('layout' in spec)) throw new Error('请选择一棵树。');
  return document.layouts[spec.layout][id]!;
}
export function authorDiagnostics(document: AuthorDocument): ValidationIssue[] {
  const catalog = validateContentCatalog(document.catalog);
  const layouts = validateContentLayouts(document.layouts, document.catalog);
  const nodes = authorNodes(document), known = new Set(nodes.map(node => node.nodeId));
  const indirect = Object.entries(invalidNodeReferences(document)).filter(([id, missing]) => {
    const node = nodes.find(node => node.nodeId === id)!;
    return missing.some(ref => known.has(ref) || !prerequisiteIds(node).includes(ref));
  }).map(([id, missing]) => ({ path: `nodes.${id}.dependencies`, code: 'UNKNOWN_REFERENCE' as const, message: `前置链含失效引用，后续不可达：${missing.join('、')}` }));
  return [...(!catalog.ok ? catalog.issues : []), ...(!layouts.ok ? layouts.issues : []), ...indirect,
    ...document.pendingBranchNodeIds.map(id => ({ path: `nodes.${id}`, code: 'INVALID_VALUE' as const, message: '请确认旧节点的强父节点或起点身份' }))];
}
export function invalidNodeReferences(document: AuthorDocument): Record<string, string[]> {
  const nodes = authorNodes(document), ids = new Set(nodes.map(node => node.nodeId)), invalid: Record<string, string[]> = {};
  for (const node of nodes) invalid[node.nodeId] = prerequisiteIds(node).filter(id => !ids.has(id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      const next = [...new Set([...invalid[node.nodeId]!, ...prerequisiteIds(node).flatMap(id => invalid[id] ?? [])])];
      if (next.length !== invalid[node.nodeId]!.length) { invalid[node.nodeId] = next; changed = true; }
    }
  }
  return Object.fromEntries(Object.entries(invalid).filter(([, missing]) => missing.length));
}
export function validateAuthorDocument(document: AuthorDocument): void {
  if (!document || !Array.isArray(document.pendingBranchNodeIds) || document.pendingBranchNodeIds.some(id => typeof id !== 'string')) throw new Error('草稿确认列表无效。');
  if (document.catalog?.schemaVersion !== 3) throw new Error('旧目录须通过复制发布版本入口转换，不能直接作为作者草稿。');
  const manifest = validatePackManifest(document.manifest); validatePackTheme(document.theme, manifest);
  const catalog = validateContentCatalog(document.catalog, { draft: true });
  if (!catalog.ok) throw new Error(catalog.issues.map(issue => `${issue.path}：${issue.message}`).join('；'));
  const layouts = validateContentLayouts(document.layouts, document.catalog);
  if (!layouts.ok) throw new Error(layouts.issues.map(issue => `${issue.path}：${issue.message}`).join('；'));
  const ids = new Set(authorNodes(document).map(node => node.nodeId));
  if (document.pendingBranchNodeIds.some(id => !ids.has(id))) throw new Error('确认列表引用未知节点。');
}
export function upgradeAuthorDocument(document: AuthorDocument): AuthorDocument {
  const next = structuredClone(document);
  if (next.catalog.schemaVersion === 2) {
    for (const node of authorNodes(next)) {
      if (prerequisiteIds(node).length) next.pendingBranchNodeIds.push(node.nodeId);
      node.dependencies = prerequisiteIds(node).map(nodeId => ({ nodeId, kind: 'prerequisite' }));
      delete node.prerequisiteNodeIds;
    }
    next.catalog.schemaVersion = 3;
  }
  for (const tree of next.catalog.modules.adventure.storyTrees) {
    tree.entryNodeId ??= `${tree.storyTreeId}.entry`;
    delete tree.rootNodeId;
    const layout = next.layouts.storyTrees[tree.storyTreeId];
    if (layout && !layout.positions[tree.entryNodeId]) {
      const occupied = Object.values(layout.positions);
      let position = { x: 0, y: 0 };
      placement: for (let y = 20; y + 80 <= layout.height; y += 100) for (let x = 20; x + 170 <= layout.width; x += 220) {
        if (occupied.every(point => x + 170 <= point.x || point.x + 170 <= x || y + 80 <= point.y || point.y + 80 <= y)) { position = { x, y }; break placement; }
      }
      layout.positions[tree.entryNodeId] = position;
    }
  }
  return next;
}
export function createAuthorDocument(packId: string, packName: string): AuthorDocument {
  if (!isPackKey(packId) || !packName.trim()) throw new Error('请输入安全的包 ID 和名称。');
  const catalog: ContentCatalog = { schemaVersion: 3, choiceGroups: [], modules: {
    adventure: { module: 'adventure', moduleName: '冒险与故事', chapters: [], storyTrees: [], storyLines: [], nodes: [] },
    bonds: { module: 'bonds', moduleName: '人物与羁绊', people: [], nodes: [] },
    careers: { module: 'careers', moduleName: '职业与成长', trees: [], nodes: [] },
    abilities: { module: 'abilities', moduleName: '战斗与技艺', owners: [], skillTrees: [], combatTrees: [], nodes: [] },
    knowledge: { module: 'knowledge', moduleName: '知识体系', domains: [], topics: [], nodes: [] },
    travel: { module: 'travel', moduleName: '旅行探索', maps: [], regions: [], locations: [] },
    journal: { module: 'journal', moduleName: '随手日记', maxEntryLength: 2000 },
  } };
  return { catalog, pendingBranchNodeIds: [], theme: { schemaVersion: 1 },
    layouts: { schemaVersion: 1, chapters: {}, storyTrees: {}, bondTrees: {}, careerTrees: {}, skillTrees: {}, combatTrees: {}, knowledgeTrees: {}, maps: {} },
    manifest: { schemaVersion: 1, packId, packName, packVersion: '0001', files: { catalog: '0'.repeat(64), layouts: '0'.repeat(64), theme: '0'.repeat(64) }, assets: {} } };
}

export type AuthorCommand =
  | { type: 'createEntity'; kind: AuthorKind; id: string; name: string; parentId?: string; patch?: Record<string, unknown>; initialNodeId?: string }
  | { type: 'editEntity'; kind: AuthorKind; id: string; patch: Record<string, unknown> }
  | { type: 'createNode'; kind: AuthorKind; treeId: string; nodeId: string; parentNodeId?: string }
  | { type: 'editNode'; nodeId: string; patch: Partial<BaseNodeDefinition>; confirmBranch?: boolean; clearChoiceGroup?: boolean }
  | { type: 'deleteBranch'; nodeId: string }
  | { type: 'deleteEntity'; kind: 'chapter' | 'story'; id: string }
  | { type: 'layout'; kind: AuthorKind; treeId: string; layout: TreeLayout }
  | { type: 'chapterLayout'; chapterId: string; width: number; height: number }
  | { type: 'choiceGroup'; kind: 'person' | 'story'; treeId: string; id: string; name: string }
  | { type: 'storyLine'; treeId: string; id: string; name: string; endingNodeIds: string[] }
  | { type: 'version'; version: string };

export function branchDeletion(document: AuthorDocument, nodeId: string): string[] {
  if (document.pendingBranchNodeIds.length) throw new Error('请先确认旧内容的分支关系，再删除分支。');
  const nodes = authorNodes(document);
  if (!nodes.some(node => node.nodeId === nodeId)) throw new Error('未知节点。');
  const removed = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (!removed.has(node.nodeId) && removed.has(branchParentId(node) ?? '')) { removed.add(node.nodeId); changed = true; }
  }
  return [...removed];
}

export function entityDeletion(document: AuthorDocument, kind: 'chapter' | 'story', id: string): { treeIds: string[]; nodeIds: string[] } {
  if (!authorEntities(document, kind).some(row => row[authorKinds[kind].id] === id)) throw new Error('未知阶段或剧情树。');
  const treeIds = document.catalog.modules.adventure.storyTrees.filter(tree => kind === 'story' ? tree.storyTreeId === id : tree.chapterId === id).map(tree => tree.storyTreeId);
  return { treeIds, nodeIds: document.catalog.modules.adventure.nodes.filter(node => treeIds.includes(node.storyTreeId)).map(node => node.nodeId) };
}

function removeNodes(document: AuthorDocument, ids: Set<string>): void {
  for (const [module, definition] of Object.entries(document.catalog.modules)) {
    if (module === 'journal') continue;
    const field = module === 'travel' ? 'locations' : 'nodes';
    const record = definition as unknown as Record<string, BaseNodeDefinition[]>;
    record[field] = record[field]!.filter(node => !ids.has(node.nodeId));
  }
  document.pendingBranchNodeIds = document.pendingBranchNodeIds.filter(id => !ids.has(id));
  for (const section of ['storyTrees', 'bondTrees', 'careerTrees', 'skillTrees', 'combatTrees', 'knowledgeTrees', 'maps'] as const) for (const layout of Object.values(document.layouts[section])) {
    for (const id of ids) delete layout.positions[id];
    if (layout.hiddenBranchNodeIds) layout.hiddenBranchNodeIds = layout.hiddenBranchNodeIds.filter(id => !ids.has(id));
    if (layout.visualEdges) layout.visualEdges = layout.visualEdges.filter(edge => !ids.has(edge.from) && !ids.has(edge.to));
  }
}

export function applyAuthorCommand(document: AuthorDocument, command: AuthorCommand): AuthorDocument {
  const next = structuredClone(document);
  if (command.type === 'version') {
    if (!isPackKey(command.version)) throw new Error('版本必须是不含路径的安全字符串。');
    next.manifest.packVersion = command.version;
  } else if (command.type === 'createEntity') {
    if (!isPackKey(command.id) || authorEntities(next, command.kind).some(row => row[authorKinds[command.kind].id] === command.id)) throw new Error('实体 ID 无效或重复。');
    const spec = authorKinds[command.kind];
    const row: Record<string, unknown> = { [spec.id]: command.id, [spec.name]: command.name };
    if ('parent' in spec) row[spec.parent] = command.parentId;
    if (command.kind === 'person') row.keywords = [];
    if (command.kind === 'story') row.entryNodeId = `${command.id}.entry`;
    if (command.kind === 'monster') row.rootNodeId = '';
    if (command.kind === 'chapter') {
      row.chapterNumber = authorEntities(next, 'chapter').length + 1;
      next.layouts.chapters[command.id] = { width: 2400, height: 1600 };
    }
    if (command.patch?.[spec.id] !== undefined) throw new Error('不能修改稳定 ID。');
    Object.assign(row, command.patch);
    authorEntities(next, command.kind).push(row);
    if ('layout' in spec) {
      next.layouts[spec.layout][command.id] = { width: 1200, height: 800, positions: {}, ...(command.kind === 'story' ? { chapterId: command.parentId!, x: 0, y: 0 } : {}) };
      if (command.kind === 'story') next.layouts.storyTrees[command.id]!.positions[String(row.entryNodeId)] = { x: 20, y: 20 };
    }
    if (command.initialNodeId) return applyAuthorCommand(next, { type: 'createNode', kind: command.kind, treeId: command.id, nodeId: command.initialNodeId });
  } else if (command.type === 'editEntity') {
    const spec = authorKinds[command.kind];
    const row = authorEntities(next, command.kind).find(row => row[spec.id] === command.id);
    if (!row || command.patch[spec.id] !== undefined) throw new Error('实体不存在或试图修改稳定 ID。');
    Object.assign(row, command.patch);
  } else if (command.type === 'createNode') {
    const spec = authorKinds[command.kind];
    if (!('layout' in spec)) throw new Error('该实体不能直接建节点。');
    const entity = authorEntities(next, command.kind).find(row => row[spec.id] === command.treeId);
    const nodes = authorNodes(next);
    if (!entity || !isPackKey(command.nodeId) || nodes.some(node => node.nodeId === command.nodeId)) throw new Error('归属或节点 ID 无效。');
    const parent = nodes.find(node => node.nodeId === command.parentNodeId);
    if (command.parentNodeId && (!parent || nodeTreeId(parent) !== command.treeId)) throw new Error('强父节点必须属于本树。');
    const row: BaseNodeDefinition = { nodeId: command.nodeId, nodeName: '', condition: '', dependencies: parent ? [{ nodeId: parent.nodeId, kind: 'branch' }] : [], description: '' };
    const fields = row as unknown as Record<string, unknown>;
    fields[spec.id] = command.treeId;
    if (command.kind === 'skill' || command.kind === 'monster') fields.nodeKind = command.kind === 'skill' ? 'skill' : 'combat';
    (next.catalog.modules[spec.module] as unknown as { nodes: BaseNodeDefinition[] }).nodes.push(row);
    if ('rootNodeId' in entity && !entity.rootNodeId) entity.rootNodeId = row.nodeId;
    const layout = treeLayout(next, command.kind, command.treeId);
    const point = parent ? layout.positions[parent.nodeId] : entity.entryNodeId ? layout.positions[String(entity.entryNodeId)] : undefined;
    layout.positions[row.nodeId] = { x: Math.min(layout.width - 140, (point?.x ?? 20) + (point ? 240 : 40)), y: Math.min(layout.height - 80, (point?.y ?? 40) + (point ? 120 : 0)) };
  } else if (command.type === 'editNode') {
    const row = authorNodes(next).find(node => node.nodeId === command.nodeId);
    if (!row || command.patch.nodeId !== undefined || command.patch.prerequisiteNodeIds !== undefined) throw new Error('节点不存在或试图修改稳定 ID/旧依赖。');
    if (command.patch.dependencies && branchParentId({ ...row, dependencies: command.patch.dependencies }) !== branchParentId(row) && !next.pendingBranchNodeIds.includes(row.nodeId)) throw new Error('强父节点由创建操作确定。');
    Object.assign(row, command.patch);
    if (command.clearChoiceGroup) delete row.choiceGroupId;
    if (command.confirmBranch) next.pendingBranchNodeIds = next.pendingBranchNodeIds.filter(id => id !== row.nodeId);
  } else if (command.type === 'choiceGroup') {
    if (!isPackKey(command.id) || next.catalog.choiceGroups.some(group => group.choiceGroupId === command.id)) throw new Error('互斥组 ID 无效或重复。');
    const base = { choiceGroupId: command.id, choiceGroupName: command.name };
    next.catalog.choiceGroups.push(command.kind === 'person' ? { ...base, module: 'bonds', personId: command.treeId } : { ...base, module: 'adventure', storyTreeId: command.treeId });
  } else if (command.type === 'storyLine') {
    const lines = next.catalog.modules.adventure.storyLines;
    const row = lines.find(line => line.storyLineId === command.id);
    if (row && row.storyTreeId !== command.treeId) throw new Error('剧情线归属不能改变。');
    const line = { storyLineId: command.id, storyLineName: command.name, storyTreeId: command.treeId, endingNodeIds: command.endingNodeIds };
    if (row) Object.assign(row, line); else lines.push(line);
  } else if (command.type === 'chapterLayout') {
    next.layouts.chapters[command.chapterId] = { width: command.width, height: command.height };
  } else if (command.type === 'layout') {
    Object.assign(treeLayout(next, command.kind, command.treeId), command.layout);
  } else if (command.type === 'deleteEntity') {
    const removed = entityDeletion(next, command.kind, command.id), adventure = next.catalog.modules.adventure;
    removeNodes(next, new Set(removed.nodeIds));
    adventure.storyTrees = adventure.storyTrees.filter(tree => !removed.treeIds.includes(tree.storyTreeId));
    adventure.storyLines = adventure.storyLines.filter(line => !removed.treeIds.includes(line.storyTreeId));
    next.catalog.choiceGroups = next.catalog.choiceGroups.filter(group => group.module !== 'adventure' || !removed.treeIds.includes(group.storyTreeId));
    for (const id of removed.treeIds) delete next.layouts.storyTrees[id];
    if (command.kind === 'chapter') {
      adventure.chapters = adventure.chapters.filter(chapter => chapter.chapterId !== command.id);
      adventure.chapters.sort((a, b) => a.chapterNumber - b.chapterNumber).forEach((chapter, index) => { chapter.chapterNumber = index + 1; });
      delete next.layouts.chapters[command.id];
    }
  } else {
    removeNodes(next, new Set(branchDeletion(next, command.nodeId)));
  }
  const known = new Set(authorNodes(next).map(node => node.nodeId));
  for (const migration of next.manifest.migrations ?? []) for (const [from, to] of Object.entries(migration.nodeIds)) {
    if (to !== null && !known.has(to)) migration.nodeIds[from] = null;
  }
  const chapters = new Set(next.catalog.modules.adventure.chapters.map(chapter => chapter.chapterId));
  for (const migration of next.manifest.migrations ?? []) for (const [from, to] of Object.entries(migration.chapterIds ?? {})) {
    if (to !== null && !chapters.has(to)) migration.chapterIds![from] = null;
  }
  validateAuthorDocument(next);
  return next;
}
