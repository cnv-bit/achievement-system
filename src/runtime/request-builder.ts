import { prerequisiteIds } from '../domain/dependencies.ts';
import type {
  AchievementSave,
  CandidateNode,
  ChildApiRequest,
  ContentCatalog,
  ContentModule,
  NodeModule,
} from '../domain/index.ts';
import { getTaskNodeState, isTaskNode } from '../domain/index.ts';
import { matchesWorldbookKey, type KeywordMatchOptions, type SelectedAssistantBody } from '../prompting/message-selection.ts';
import type { RuntimeChatMessage } from './ports.ts';
import { admittedModelGroups, type ModelContext } from './model-context.ts';

export interface ModelRequest extends ChildApiRequest {
  moduleContext: Array<{
    module: NodeModule;
    groupId: string;
    label: string;
    parentIds: string[];
    nodes: Array<{ nodeId: string; nodeName: string; condition: string; prerequisiteNodeIds: string[]; externalPrerequisitesSatisfied?: true; choiceGroupId?: string; allowsMemento?: boolean; status: 'locked' | 'unlocked' | 'active' }>;
  }>;
}

interface RequestBuildInput {
  requestId: string;
  chatId: string;
  catalog: ContentCatalog;
  save: AchievementSave;
  allowedModules: ContentModule[];
  bodies: SelectedAssistantBody[];
  userMessages?: RuntimeChatMessage[];
  includeUserInput?: boolean;
  matchOptions?: KeywordMatchOptions;
  selectedGroupIds: string[];
  context: ModelContext;
  worldContext: string[];
}

function storyMessages(bodies: SelectedAssistantBody[]): ChildApiRequest['storyMessages'] {
  return bodies.map(body => ({
    id: `message-${body.assistant.id}`,
    role: 'assistant' as const,
    turnIndex: body.turnIndex,
    text: body.assistant.text,
  }));
}

type ModelGroup = ReturnType<typeof admittedModelGroups>[number];

function scopedNodeIds(groups: ModelGroup[], context: ModelContext, input: RequestBuildInput): Set<string> {
  const nodes = groups.flatMap(group => group.nodes);
  const ids = new Set(nodes.filter(node => context.canSend[node.nodeId] === true && (!node.choiceGroupId || context.canSend[node.choiceGroupId] === true)).map(node => node.nodeId));
  for (const group of groups) for (const node of group.nodes) {
    if (ids.has(node.nodeId) && isTaskNode(group.module, node) && getTaskNodeState(input.catalog, input.save, node.nodeId) !== 'active') ids.delete(node.nodeId);
  }
  // Do not disclose a hidden prerequisite ID, or silently delete part of its rule.
  let removed: boolean;
  do {
    removed = false;
    for (const group of groups) for (const node of group.nodes) {
      if (input.catalog.schemaVersion === 3 && group.module === 'adventure') continue;
      if (ids.has(node.nodeId) && !isTaskNode(group.module, node) && prerequisiteIds(node).some(id => !ids.has(id) && !completedOtherChapter(id, node.nodeId, input))) {
        ids.delete(node.nodeId);
        removed = true;
      }
    }
  } while (removed);
  return ids;
}

// Previous-chapter dependencies remain enforced by the data layer, without disclosing their IDs.
function completedOtherChapter(id: string, nodeId: string, input: RequestBuildInput): boolean {
  const nodes = input.catalog.modules.adventure.nodes;
  const node = nodes.find(node => node.nodeId === nodeId);
  const prerequisite = nodes.find(node => node.nodeId === id);
  if (!node || !prerequisite || node.storyTreeId !== prerequisite.storyTreeId || !input.save.nodeProgress[id]) return false;
  const tree = input.catalog.modules.adventure.storyTrees.find(tree => tree.storyTreeId === node.storyTreeId)!;
  return (prerequisite.chapterId ?? tree.chapterId) !== input.context.currentChapterId;
}

function groupMaterial(group: ModelGroup, input: RequestBuildInput, nodeIds: Set<string>): ModelRequest['moduleContext'][number] {
  const save = input.save, wholeStory = input.catalog.schemaVersion === 3 && group.module === 'adventure';
  return {
    module: group.module, groupId: group.id, label: group.label, parentIds: [...group.parentIds],
    nodes: group.nodes.filter(node => nodeIds.has(node.nodeId)).map(node => ({
      nodeId: node.nodeId, nodeName: node.nodeName, condition: node.condition,
      prerequisiteNodeIds: wholeStory ? prerequisiteIds(node) : prerequisiteIds(node).filter(id => nodeIds.has(id)),
      ...(prerequisiteIds(node).some(id => !nodeIds.has(id)) && (!wholeStory || prerequisiteIds(node).filter(id => !nodeIds.has(id)).every(id => save.nodeProgress[id])) ? { externalPrerequisitesSatisfied: true as const } : {}),
      ...(node.choiceGroupId ? { choiceGroupId: node.choiceGroupId } : {}),
      ...(group.module === 'bonds' ? { allowsMemento: 'allowsMemento' in node && node.allowsMemento === true } : {}),
      status: isTaskNode(group.module, node) ? 'active' : save.nodeProgress[node.nodeId] ? 'unlocked' : 'locked',
    })),
  };
}

export function buildChildApiRequest(input: RequestBuildInput): ModelRequest {
  const chapterId = input.context.currentChapterId ?? input.save.currentChapterId;
  const context: ModelContext = { ...input.context, ...(chapterId !== undefined ? { currentChapterId: chapterId } : {}) };
  input = { ...input, context };
  const enabled = [...new Set(input.allowedModules)].filter(module => context.canSend[module] === true);
  const texts = [...(input.userMessages ?? []).filter(message => message.role === 'user').map(message => message.text), ...input.bodies.map(body => body.assistant.text)];
  const keywordHit = (group: ModelGroup) => group.keywords.some(key => texts.some(text => matchesWorldbookKey(text, key, input.matchOptions ?? { caseSensitive: false, matchWholeWords: false })));
  const groups = admittedModelGroups(input.catalog, context).filter(group => enabled.includes(group.module) && (
    group.module === 'careers' || group.module === 'knowledge' ||
    (group.module === 'abilities' && group.nodes.some(node => 'nodeKind' in node && node.nodeKind === 'skill')) ||
    (group.module === 'travel' ? input.selectedGroupIds.includes(group.id) : keywordHit(group))
  ));
  const admittedNodeIds = scopedNodeIds(groups, context, input);
  const moduleContext = groups.map(group => groupMaterial(group, input, admittedNodeIds)).filter(group => group.nodes.length > 0);
  const allowedModules = enabled.filter(module => module === 'journal' || moduleContext.some(group => group.module === module));
  const candidates: CandidateNode[] = moduleContext.flatMap(group => group.nodes.filter(node => node.status !== 'unlocked').map(node => ({
    module: group.module, nodeId: node.nodeId, condition: node.condition, prerequisiteIds: [...node.prerequisiteNodeIds],
    ...(group.module === 'bonds' ? { personId: group.groupId } : {}),
    ...(group.module === 'abilities' ? { nodeKind: input.catalog.modules.abilities.nodes.find(n => n.nodeId === node.nodeId)!.nodeKind } : {}),
  })));
  return {
    schemaVersion: 1,
    requestId: input.requestId,
    chatId: input.chatId,
    baseRevision: input.save.revision,
    allowedModules,
    storyMessages: [
      ...(input.includeUserInput ? (input.userMessages ?? []).filter(message => message.role === 'user').map(message => ({
        id: `message-${message.id}`, role: 'user' as const, text: message.text,
        turnIndex: input.bodies.find(body => body.assistant.id > message.id)?.turnIndex ?? input.bodies.at(-1)?.turnIndex ?? 0,
      })) : []),
      ...storyMessages(input.bodies),
    ].sort((left, right) => Number(left.id.slice(8)) - Number(right.id.slice(8))),
    worldContext: [...input.worldContext],
    variables: structuredClone(input.context.variables),
    candidates,
    unlockedNodeIds: Object.keys(input.save.nodeProgress).filter(id => admittedNodeIds.has(id)),
    moduleContext,
  };
}
