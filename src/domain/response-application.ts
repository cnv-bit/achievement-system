import { prerequisiteIds } from './dependencies.ts';
import type {
  AchievementSave, AnnotationCardStyle, BaseNodeDefinition, ChildApiResponse,
  ContentCatalog, ContentModule, MessageCursor, NodeModule, ResponseValidationContext, UnlockNodeProposal, ChildApiProposal,
  NodeProgress,
} from './types.ts';
import { isTaskNode, nodeCompletionIssue } from './player-state.ts';
import { validateChildApiResponse } from './validation.ts';
import { imageReference } from './asset-reference.ts';
import { isCombatNode } from './response-policy.ts';

interface ApplyResponseInput {
  catalog: ContentCatalog;
  save: AchievementSave;
  response: unknown;
  requestContext: ResponseValidationContext;
  /** Only automatic runs supply this cursor. */
  processedThrough?: MessageCursor;
  now: string;
}

export interface ResponseApplicationResult {
  save: AchievementSave;
  acceptedProposalIds: string[];
  rejectedProposals: Array<{ proposalId: string; reason: string }>;
  changed: boolean;
  duplicate: boolean;
}

function moduleNodes(catalog: ContentCatalog, module: NodeModule): BaseNodeDefinition[] {
  return module === 'travel' ? catalog.modules.travel.locations : catalog.modules[module].nodes;
}

function unlockIssue(update: UnlockNodeProposal, catalog: ContentCatalog, save: AchievementSave): string | undefined {
  const node = moduleNodes(catalog, update.module).find(node => node.nodeId === update.nodeId);
  if (!node) return `未知节点 ${update.nodeId}。`;
  const issue = nodeCompletionIssue(catalog, save, update.nodeId);
  if (issue) return issue;
  if (update.module === 'bonds') {
    const bond = catalog.modules.bonds.nodes.find(node => node.nodeId === update.nodeId)!;
    if (update.personId !== bond.personId) return `羁绊节点 ${update.nodeId} 的人物 ID 不匹配。`;
    if (update.copy?.memento && !bond.allowsMemento) return `节点 ${update.nodeId} 不允许纪念卡。`;
  }
  if ((save.nodeProgress[update.nodeId] || save.nodeTasks[update.nodeId]?.claimableAt) && !Object.keys(update.copy ?? {}).length) {
    return `节点 ${update.nodeId} 已经达成，没有需要更新的文案。`;
  }
  return undefined;
}

const cardStyles: Record<NodeModule, AnnotationCardStyle> = {
  adventure: 'story', bonds: 'friend', careers: 'career', abilities: 'skill', knowledge: 'knowledge', travel: 'place',
};

function writeAnnotationCard(next: AchievementSave, node: BaseNodeDefinition, update: UnlockNodeProposal): void {
  const cardId = next.nodeProgress[update.nodeId]!.cardId!;
  const previousCard = next.annotationCards[cardId];
  const text = update.copy?.memento ?? update.copy?.description;
  next.annotationCards[cardId] = {
    cardId, nodeId: update.nodeId,
    style: update.module === 'abilities' && 'nodeKind' in node && node.nodeKind === 'combat' ? 'combat' : cardStyles[update.module],
    text: text ?? previousCard?.text ?? node.condition,
    sourceRefs: [],
    ...imageReference(previousCard?.assetRef || previousCard?.imageName ? previousCard : node),
    // A later model write replaces its displayed field, preserving unrelated player edits.
    ...(text === undefined && previousCard?.textOverride ? { textOverride: previousCard.textOverride } : {}),
  };
}

function completeNode(next: AchievementSave, node: BaseNodeDefinition, update: UnlockNodeProposal, now: string): void {
  const existing = next.nodeProgress[update.nodeId];
  const archived = next.retractedNodeProgress[update.nodeId];
  const progress: NodeProgress = existing ?? {
    status: 'unlocked' as const, unlockedAt: now, sourceRefs: [],
    ...(archived?.nodeNameOverride ? { nodeNameOverride: archived.nodeNameOverride } : {}),
  };
  const cardId = existing?.cardId ?? archived?.cardId ?? `card.node.${update.nodeId}`;
  progress.cardId = cardId;
  if (update.copy) progress.generatedCopy = { ...progress.generatedCopy, ...structuredClone(update.copy) };
  next.nodeProgress[update.nodeId] = progress;
  delete next.nodeTasks[update.nodeId];
  delete next.retractedNodeProgress[update.nodeId];
  if (isCombatNode(node)) {
    // Monster text and artwork remain in the read-only content pack.
    delete progress.cardId;
    delete progress.generatedCopy;
    return;
  }
  writeAnnotationCard(next, node, update);
}

function applyUnlock(catalog: ContentCatalog, next: AchievementSave, update: UnlockNodeProposal, now: string): void {
  const node = moduleNodes(catalog, update.module).find(node => node.nodeId === update.nodeId)!;
  if (!isTaskNode(update.module, node) || next.nodeProgress[update.nodeId]) return completeNode(next, node, update, now);
  const task = next.nodeTasks[update.nodeId];
  next.nodeTasks[update.nodeId] = {
    ...task,
    claimableAt: task?.claimableAt ?? now,
    ...(update.copy ? { completionCopy: structuredClone(update.copy) } : {}),
  };
  if (!task?.claimableAt) delete next.nodeTasks[update.nodeId]!.claimabilityNotified;
}

function advanceCursors(next: AchievementSave, modules: ContentModule[], cursor: MessageCursor): void {
  for (const module of modules) {
    if ((next.processedThrough[module]?.turnIndex ?? -1) < cursor.turnIndex) next.processedThrough[module] = { ...cursor };
  }
}

function playerFacts(save: AchievementSave): string {
  return JSON.stringify([save.nodeProgress, save.nodeTasks, save.annotationCards, save.journalEntries]);
}

function checkedResponse(input: ApplyResponseInput): ChildApiResponse {
  const candidates = new Set(input.requestContext.candidateNodeIds.abilities ?? []);
  const validated = validateChildApiResponse(input.response, {
    ...input.requestContext,
    combatCandidateNodeIds: input.catalog.modules.abilities.nodes.filter(n => isCombatNode(n) && candidates.has(n.nodeId)).map(n => n.nodeId),
  });
  if (!validated.ok) throw new Error(`子 API 响应被拒绝：${validated.issues.map(issue => issue.message).join('；')}`);
  return validated.value;
}

function proposalIssue(update: ChildApiProposal, input: ApplyResponseInput, next: AchievementSave): string | undefined {
  if (update.type === 'appendJournalEntry') return update.text.length > input.catalog.modules.journal.maxEntryLength ? '日记长度超过目录限制。' : undefined;
  const node = moduleNodes(input.catalog, update.module).find(node => node.nodeId === update.nodeId)!;
  if (!node) return `未知节点 ${update.nodeId}。`;
  // Only monster achievements can consume explicitly accepted parents in this batch.
  const issue = unlockIssue(update, input.catalog, isCombatNode(node) && !node.dependencies ? next : input.save);
  if (issue) return issue;
  if (next.nodeProgress[node.nodeId] && !input.save.nodeProgress[node.nodeId]) return `节点 ${node.nodeId} 已在本轮达成。`;
  if (node.choiceGroupId && moduleNodes(input.catalog, update.module).some(peer => peer.nodeId !== node.nodeId && peer.choiceGroupId === node.choiceGroupId && next.nodeProgress[peer.nodeId])) {
    return `节点 ${node.nodeId} 的互斥分支已经确定。`;
  }
  return undefined;
}

function orderedUpdates(catalog: ContentCatalog, updates: ChildApiProposal[]): ChildApiProposal[] {
  const combat = new Map(catalog.modules.abilities.nodes.filter(isCombatNode).map(n => [n.nodeId, n]));
  const submitted = new Map(updates.filter((u): u is UnlockNodeProposal => u.type === 'unlockNode' && u.module === 'abilities' && combat.has(u.nodeId)).map(u => [u.nodeId, u]));
  const result: ChildApiProposal[] = [];
  const visited = new Set<string>();
  function append(update: ChildApiProposal): void {
    if (visited.has(update.proposalId)) return;
    visited.add(update.proposalId);
    if (update.type === 'unlockNode' && submitted.has(update.nodeId)) {
      for (const id of prerequisiteIds(combat.get(update.nodeId)!)) {
        const parent = submitted.get(id);
        if (parent && combat.get(id)?.combatTreeId === combat.get(update.nodeId)!.combatTreeId) append(parent);
      }
    }
    result.push(update);
  }
  updates.forEach(append);
  return result;
}

function applyUpdates(input: ApplyResponseInput, next: AchievementSave, response: ChildApiResponse) {
  const acceptedProposalIds: string[] = [];
  const rejectedProposals: ResponseApplicationResult['rejectedProposals'] = [];
  for (const update of orderedUpdates(input.catalog, response.updates)) {
    const issue = proposalIssue(update, input, next);
    if (issue) { rejectedProposals.push({ proposalId: update.proposalId, reason: issue }); continue; }
    if (update.type === 'unlockNode') applyUnlock(input.catalog, next, update, input.now);
    else next.journalEntries.push({
      journalId: `journal.${response.requestId}.${update.proposalId}`, origin: 'generated',
      generatedText: update.text, createdAt: input.now, sourceRefs: [],
      ...(update.title !== undefined ? { title: update.title } : {}),
    });
    acceptedProposalIds.push(update.proposalId);
  }
  return { acceptedProposalIds, rejectedProposals };
}

function assertCompletedNodes(catalog: ContentCatalog, save: AchievementSave, modules: ContentModule[]): void {
  for (const module of modules) {
    if (module === 'journal') continue;
    for (const node of moduleNodes(catalog, module)) {
      if (!save.nodeProgress[node.nodeId]) continue;
      const issue = nodeCompletionIssue(catalog, save, node.nodeId);
      if (issue) throw new Error(`拒绝保存非法节点状态：${issue}`);
    }
  }
}

export function applyChildApiResponseWithOutcome(input: ApplyResponseInput): ResponseApplicationResult {
  const response = checkedResponse(input);
  if (input.save.appliedRequestIds.includes(response.requestId)) {
    return { save: input.save, acceptedProposalIds: [], rejectedProposals: [], changed: false, duplicate: true };
  }
  const next = structuredClone(input.save);
  const { acceptedProposalIds, rejectedProposals } = applyUpdates(input, next, response);
  assertCompletedNodes(input.catalog, next, input.requestContext.allowedModules);
  if (input.processedThrough) advanceCursors(next, input.requestContext.allowedModules, input.processedThrough);
  next.appliedRequestIds.push(response.requestId);
  (next.requestOutcomes ??= {})[response.requestId] = { acceptedProposalIds, rejectedProposals };
  next.revision += 1;
  return { save: next, acceptedProposalIds, rejectedProposals, changed: playerFacts(next) !== playerFacts(input.save), duplicate: false };
}

export function applyChildApiResponse(input: ApplyResponseInput): AchievementSave {
  return applyChildApiResponseWithOutcome(input).save;
}
