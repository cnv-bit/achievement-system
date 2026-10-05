import {
  getTaskNodeState,
  isTaskNode,
  validateChildApiResponse,
  type AnnotationCardStyle,
  type AppendJournalEntryProposal,
  type AchievementSave,
  type BaseNodeDefinition,
  type ChildApiResponse,
  type ContentCatalog,
  type ContentModule,
  type MessageCursor,
  type NodeModule,
  type NodeProgress,
  type ResponseValidationContext,
  type UnlockNodeProposal,
} from '../domain/index.ts';

interface ApplyResponseInput {
  catalog: ContentCatalog;
  save: AchievementSave;
  response: unknown;
  requestContext: ResponseValidationContext;
  processedThrough: MessageCursor;
  now: string;
}

type ValidatedApplyResponseInput = Omit<ApplyResponseInput, 'response'> & { response: ChildApiResponse };

function moduleNodes(catalog: ContentCatalog, module: NodeModule): BaseNodeDefinition[] {
  if (module === 'travel') return catalog.modules.travel.locations;
  return catalog.modules[module].nodes;
}

function responseError(message: string): never {
  throw new Error(`子 API 响应被拒绝：${message}`);
}

function validateUnlock(
  proposal: UnlockNodeProposal,
  catalog: ContentCatalog,
  save: AchievementSave,
  proposedNodeIds: Set<string>,
  proposedExclusiveGroups: Set<string>,
): void {
  const nodes = moduleNodes(catalog, proposal.module);
  const node = nodes.find(candidate => candidate.nodeId === proposal.nodeId);
  if (!node) responseError(`未知节点 ${proposal.nodeId}。`);
  if (save.nodeProgress[node.nodeId] || proposedNodeIds.has(node.nodeId)) responseError(`节点 ${node.nodeId} 已经解锁。`);
  if (isTaskNode(proposal.module, node) && getTaskNodeState(catalog, save, node.nodeId) !== 'active') {
    responseError(`任务节点 ${node.nodeId} 尚未接取或已失效。`);
  }
  if ((node.prerequisiteNodeIds ?? []).some(id => !save.nodeProgress[id])) responseError(`节点 ${node.nodeId} 的前置条件未满足。`);
  if (node.choiceGroupId && nodes.some(peer => peer.choiceGroupId === node.choiceGroupId && save.nodeProgress[peer.nodeId])) {
    responseError(`节点 ${node.nodeId} 的互斥分支已经确定。`);
  }
  if (node.choiceGroupId && proposedExclusiveGroups.has(node.choiceGroupId)) {
    responseError(`节点 ${node.nodeId} 的互斥分支已经在本次响应中确定。`);
  }
  if (proposal.copy?.memento && proposal.module !== 'bonds') responseError('只有羁绊节点可以保存纪念卡。');
  if (proposal.module === 'bonds') {
    const personId = catalog.modules.bonds.nodes.find(candidate => candidate.nodeId === node.nodeId)?.personId;
    if (proposal.personId !== personId) responseError(`羁绊节点 ${node.nodeId} 的人物 ID 不匹配。`);
  }
  if (proposal.copy?.memento && !catalog.modules.bonds.nodes.find(candidate => candidate.nodeId === node.nodeId)?.allowsMemento) {
    responseError(`节点 ${node.nodeId} 不允许纪念卡。`);
  }
  proposedNodeIds.add(node.nodeId);
  if (node.choiceGroupId) proposedExclusiveGroups.add(node.choiceGroupId);
}

function validateDomainRules(input: ValidatedApplyResponseInput): void {
  if (input.save.revision !== input.requestContext.stateRevision) responseError('存档版本已变化。');
  if (input.save.appliedRequestIds.includes(input.response.requestId)) responseError('该请求已经应用。');
  const proposedNodeIds = new Set<string>();
  const proposedExclusiveGroups = new Set<string>();
  for (const update of input.response.updates) {
    if (update.type === 'unlockNode') {
      validateUnlock(update, input.catalog, input.save, proposedNodeIds, proposedExclusiveGroups);
    }
    if (update.type === 'appendJournalEntry' && update.text.length > input.catalog.modules.journal.maxEntryLength) {
      responseError('日记长度超过目录限制。');
    }
  }
}

function cardStyle(module: NodeModule): AnnotationCardStyle {
  const styles: Record<NodeModule, AnnotationCardStyle> = {
    adventure: 'story',
    bonds: 'friend',
    careers: 'career',
    abilities: 'skill',
    knowledge: 'knowledge',
    travel: 'place',
  };
  return styles[module];
}

function unlockedProgress(proposal: UnlockNodeProposal, now: string): NodeProgress {
  return {
    status: 'unlocked',
    unlockedAt: now,
    sourceRefs: [], // 保留旧存档结构；新结果不记录正文来源。
    cardId: `card.node.${proposal.nodeId}`,
    ...(proposal.copy ? { generatedCopy: structuredClone(proposal.copy) } : {}),
  };
}

function applyUnlockUpdate(
  input: ValidatedApplyResponseInput,
  next: AchievementSave,
  update: UnlockNodeProposal,
): void {
  const node = moduleNodes(input.catalog, update.module).find(candidate => candidate.nodeId === update.nodeId)!;
  if (isTaskNode(update.module, node)) {
    next.nodeTasks[update.nodeId] = {
      ...next.nodeTasks[update.nodeId],
      claimableAt: input.now,
      ...(update.copy ? { completionCopy: structuredClone(update.copy) } : {}),
    };
    delete next.nodeTasks[update.nodeId]!.claimabilityNotified;
    return;
  }
  const progress = unlockedProgress(update, input.now);
  const archived = next.retractedNodeProgress[update.nodeId];
  const cardId = archived?.cardId ?? progress.cardId!;
  progress.cardId = cardId;
  const previousCard = next.annotationCards[cardId];
  if (archived?.nodeNameOverride) progress.nodeNameOverride = archived.nodeNameOverride;
  next.nodeProgress[update.nodeId] = progress;
  delete next.nodeTasks[update.nodeId];
  delete next.retractedNodeProgress[update.nodeId];
  next.annotationCards[cardId] = {
    cardId,
    nodeId: update.nodeId,
    style: update.module === 'abilities' && input.catalog.modules.abilities.nodes.find(n => n.nodeId === update.nodeId)?.nodeKind === 'combat' ? 'combat' : cardStyle(update.module),
    text: update.copy?.memento ?? update.copy?.description ?? node.condition,
    sourceRefs: structuredClone(progress.sourceRefs),
    ...((previousCard?.imageName ?? node.imageName) ? { imageName: (previousCard?.imageName ?? node.imageName)!, imageAlt: (previousCard?.imageAlt ?? node.imageAlt)! } : {}),
    ...(previousCard?.textOverride ? { textOverride: previousCard.textOverride } : {}),
  };
}

function applyJournalUpdate(
  input: ValidatedApplyResponseInput,
  next: AchievementSave,
  update: AppendJournalEntryProposal,
): void {
  next.journalEntries.push({
    journalId: `journal.${input.response.requestId}.${update.proposalId}`,
    origin: 'generated',
    generatedText: update.text,
    createdAt: input.now,
    sourceRefs: [],
  });
}

function applyUpdates(input: ValidatedApplyResponseInput, next: AchievementSave): void {
  for (const update of input.response.updates) {
    if (update.type === 'unlockNode') applyUnlockUpdate(input, next, update);
    if (update.type === 'appendJournalEntry') applyJournalUpdate(input, next, update);
  }
}

function advanceCursors(next: AchievementSave, modules: ContentModule[], cursor: MessageCursor): void {
  for (const module of modules) next.processedThrough[module] = { ...cursor };
}

export function applyChildApiResponse(input: ApplyResponseInput): AchievementSave {
  const validated = validateChildApiResponse(input.response, input.requestContext);
  if (!validated.ok) responseError(validated.issues.map(issue => issue.message).join('；'));
  const validatedInput: ValidatedApplyResponseInput = { ...input, response: validated.value };
  validateDomainRules(validatedInput);
  const next = structuredClone(input.save);
  applyUpdates(validatedInput, next);
  advanceCursors(next, input.requestContext.allowedModules, input.processedThrough);
  next.appliedRequestIds.push(validated.value.requestId);
  next.revision += 1;
  return next;
}
