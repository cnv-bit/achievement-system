import type { BaseNodeDefinition, ContentCatalog, ContentModule, JsonValue, NodeModule } from '../domain/index.ts';

/** Supplied by the data owner, not inferred from text or worldbook matches. Missing means denied. */
export interface ModelContext {
  canSend: Record<string, boolean>;
  variables: Record<string, JsonValue>;
  currentChapterId?: string;
}

export type ModelContextReader = (messageId: number, historicalVariables: Record<string, JsonValue>) => ModelContext;

interface CatalogModelGroup {
  module: NodeModule;
  id: string;
  label: string;
  parentIds: string[];
  keywords: string[];
  nodes: BaseNodeDefinition[];
}

export interface ModelGroupOption {
  module: NodeModule;
  id: string;
  label: string;
}

export function catalogModelGroups(catalog: ContentCatalog): CatalogModelGroup[] {
  const modules = catalog.modules;
  return [
    ...modules.adventure.storyTrees.map(group => ({ module: 'adventure' as const, id: group.storyTreeId, label: group.storyTreeName, keywords: group.keywords ?? [], parentIds: [group.chapterId], nodes: modules.adventure.nodes.filter(node => node.storyTreeId === group.storyTreeId) })),
    ...modules.bonds.people.map(group => ({ module: 'bonds' as const, id: group.personId, label: group.personName, keywords: group.keywords, parentIds: [], nodes: modules.bonds.nodes.filter(node => node.personId === group.personId) })),
    ...modules.careers.trees.map(group => ({ module: 'careers' as const, id: group.careerTreeId, label: group.careerTreeName, keywords: group.keywords ?? [], parentIds: [], nodes: modules.careers.nodes.filter(node => node.careerTreeId === group.careerTreeId) })),
    ...modules.abilities.skillTrees.map(group => ({ module: 'abilities' as const, id: group.skillTreeId, label: group.skillTreeName, keywords: group.keywords ?? [], parentIds: [group.skillOwnerId], nodes: modules.abilities.nodes.filter(node => node.nodeKind === 'skill' && node.skillTreeId === group.skillTreeId) })),
    ...modules.abilities.combatTrees.map(group => ({ module: 'abilities' as const, id: group.combatTreeId, label: group.combatTreeName, keywords: group.keywords ?? [], parentIds: [], nodes: modules.abilities.nodes.filter(node => node.nodeKind === 'combat' && node.combatTreeId === group.combatTreeId) })),
    ...modules.knowledge.topics.map(group => ({ module: 'knowledge' as const, id: group.knowledgeTopicId, label: group.knowledgeTopicName, keywords: group.keywords ?? [], parentIds: [group.knowledgeDomainId], nodes: modules.knowledge.nodes.filter(node => node.knowledgeTopicId === group.knowledgeTopicId) })),
    ...modules.travel.regions.map(group => ({ module: 'travel' as const, id: group.travelRegionId, label: group.travelRegionName, keywords: [], parentIds: [group.mapId], nodes: modules.travel.locations.filter(node => node.travelRegionId === group.travelRegionId) })),
  ];
}

export function admittedModelGroups(catalog: ContentCatalog, context: ModelContext): CatalogModelGroup[] {
  return catalogModelGroups(catalog).map(group => {
    if (group.module !== 'adventure') return group;
    const chapterId = context.currentChapterId;
    return { ...group, parentIds: chapterId ? [chapterId] : [], nodes: group.nodes.filter(node =>
      chapterId !== undefined && (('chapterId' in node ? node.chapterId : undefined) ?? group.parentIds[0]) === chapterId) };
  }).filter(group => group.nodes.length > 0 && [group.module, group.id, ...group.parentIds].every(id => context.canSend[id] === true));
}

/** Only for the explicitly labelled technical demo, never as the real catalogue fallback. */
export function skeletonModelContext(catalog: ContentCatalog): ModelContext {
  const ids: string[] = Object.keys(catalog.modules) as ContentModule[];
  ids.push(...catalog.modules.adventure.chapters.map(chapter => chapter.chapterId));
  for (const group of catalogModelGroups(catalog)) ids.push(group.id, ...group.parentIds, ...group.nodes.map(node => node.nodeId));
  ids.push(...catalog.choiceGroups.map(group => group.choiceGroupId));
  return { canSend: Object.fromEntries(ids.map(id => [id, true])), variables: {} };
}
