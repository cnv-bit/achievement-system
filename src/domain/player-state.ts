/**
 * ============================================================================
 * 【聚合根 (Aggregate Root) 核心文件：成就存档的“独家总管家”】
 * ============================================================================
 *
 * 为什么说“业务规则唯一定义在聚合根”？大白话解释：
 *
 * 1. 以前的坏做法（意大利面）：
 *    前端界面、AI 响应回调、设置页面，谁都可以直接写代码篡改 `save.nodeProgress['xxx'] = true`。
 *    就像银行金库谁都能随便进去拿钱，最后数据全乱套了：
 *    - 有人没做前置任务直接解锁了后续成就；
 *    - 还有人把父成就撤回了，结果子成就还孤零零悬空亮着；
 *    - 业务逻辑散落在三四个文件里，改一个地方另外几个地方全漏掉。
 *
 * 2. 现在的聚合根做法（守门人原则）：
 *    - 本文件管辖的 `AchievementSave` 就是那个“金库”。
 *    - 任何外部模块（前端 UI 界面、按键事件、甚至 AI），【绝对不准】直接修改 `save` 内部的任何字段！
 *    - 玩家在界面上点任何按钮，只能封装成一条【命令】（PlayerCommand），老老实实交由本文件处理。
 *    - 前端要展示数据，不能直接读底层脏数据，必须由本文件提供一个【只读投影】（buildPlayerView）。
 *    - “能不能接取？”、“能不能解锁？”、“前置满不满足？”、“撤回时连带影响谁？”，全由此文件唯一判定！
 * ============================================================================
 */

import type {
  AchievementSave,
  AnnotationCard,
  BaseNodeDefinition,
  ContentCatalog,
  ContentModule,
  ImageReference,
  JournalEntry,
  MessageEvidenceRef,
  NodeModule,
  TaskNodeState,
  OrphanedProgress,
  OrphanedChapter,
} from "./types.ts";
import { CONTENT_MODULES } from "./types.ts";
import { prerequisiteIds, branchParentId } from './dependencies.ts';
import { imageReference } from "./asset-reference.ts";
import { isCombatNode } from "./response-policy.ts";

/**
 * 玩家所有允许的操作清单（命令模式 Command Pattern）
 * 所有的 UI 点击，都必须先打包成以下某种指令，再通过 applyPlayerCommand 递交审核：
 */
export type PlayerCommand =
  | {
      type: "editNodeCard";
      nodeId: string;
      patch: { nodeName?: string; text?: string };
    }
  | { type: "lockNode"; nodeId: string }
  | { type: "acceptNodeTask"; nodeId: string; acceptedAt: string }
  | { type: "claimNodeTask"; nodeId: string; claimedAt: string }
  | { type: "markAvailableTasksNotified"; nodeIds: string[] }
  | { type: "markClaimableTasksNotified"; nodeIds: string[] }
  | {
      type: "addPlayerJournal";
      journalId: string;
      text: string;
      title?: string;
      createdAt: string;
    }
  | { type: "editJournalEntry"; journalId: string; text: string; title?: string }
  | { type: "deleteJournalEntry"; journalId: string };

export interface PlayerCardView extends ImageReference {
  cardId: string;
  style: AnnotationCard["style"];
  text: string;
}
interface PlayerNodeBase extends ImageReference {
  nodeId: string;
  nodeName: string;
  unlocked: boolean;
  nodeState?: TaskNodeState;
  description?: string;
  authorDescription?: string;
  card?: PlayerCardView;
}
export type PlayerNodeView = PlayerNodeBase &
  (
    | { module: "adventure"; chapterId: string; storyTreeId: string }
    | { module: "bonds"; personId: string }
    | { module: "careers"; careerTreeId: string }
    | {
        module: "abilities";
        nodeKind: "skill";
        skillTreeId: string;
        skillOwnerId: string;
      }
    | { module: "abilities"; nodeKind: "combat"; combatTreeId: string }
    | {
        module: "knowledge";
        knowledgeDomainId: string;
        knowledgeTopicId: string;
      }
    | { module: "travel"; mapId: string; travelRegionId: string }
  );
export interface PlayerJournalView {
  journalId: string;
  origin: JournalEntry["origin"];
  text: string;
  title?: string;
  createdAt: string;
}
export interface PlayerGroupView extends ImageReference {
  groupId: string;
  groupName: string;
  module: NodeModule;
  kind:
    | "storyTree"
    | "person"
    | "careerTree"
    | "skillOwner"
    | "skillTree"
    | "combatTree"
    | "knowledgeDomain"
    | "knowledgeTopic"
    | "map"
    | "travelRegion";
  parentGroupId?: string;
  nodeIds: string[];
  /** Only combat entries expose this derived state, including empty unseen entries. */
  unlocked?: boolean;
  /** Static dossier fields are revealed only for encountered combat entries. */
  rootNodeId?: string;
  aliases?: string[];
  tags?: string[];
  recommendedRank?: string;
}
export interface AchievementPlayerView {
  revision: number;
  nodes: PlayerNodeView[];
  journalEntries: PlayerJournalView[];
  groups: PlayerGroupView[];
  edges: Array<{ module: NodeModule; from: string; to: string }>;
  chapters: Array<{
    chapterId: string;
    chapterName: string;
    chapterNumber: number;
  }>;
  moduleNames: Record<ContentModule, string>;
  availableTaskCount: number;
  claimableTaskCount: number;
  actionableTaskCount: number;
  newAvailableTaskIds: string[];
  newClaimableTaskIds: string[];
  orphanedProgress?: OrphanedProgress[];
  orphanedChapters?: OrphanedChapter[];
}

function requireText(input: string, label: string): string {
  const text = input.trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}
function requireBoundedText(
  input: string,
  label: string,
  maxLength: number,
): string {
  const text = requireText(input, label);
  if (text.length > maxLength)
    throw new Error(`${label}不能超过 ${maxLength} 个字符。`);
  return text;
}
function requireIsoDate(input: string): string {
  const timestamp = requireText(input, "创建时间");
  if (
    Number.isNaN(Date.parse(timestamp)) ||
    new Date(timestamp).toISOString() !== timestamp
  )
    throw new Error("创建时间必须是 ISO 时间。");
  return timestamp;
}
export function nodeDefinitions(
  catalog: ContentCatalog,
): Array<{ module: NodeModule; node: BaseNodeDefinition }> {
  return CONTENT_MODULES.flatMap((module) => {
    if (module === "journal") return [];
    const nodes =
      module === "travel"
        ? catalog.modules.travel.locations
        : catalog.modules[module].nodes;
    return nodes.map((node) => ({ module, node }));
  });
}
export function isTaskNode(
  module: NodeModule,
  node: BaseNodeDefinition,
): boolean {
  return (
    (node.dependencies !== undefined && module !== "adventure") ||
    module === "careers" ||
    module === "knowledge" ||
    (module === "abilities" && "nodeKind" in node && node.nodeKind === "skill")
  );
}
function nodeDefinition(
  catalog: ContentCatalog,
  nodeId: string,
): { module: NodeModule; node: BaseNodeDefinition } | undefined {
  return nodeDefinitions(catalog).find((entry) => entry.node.nodeId === nodeId);
}

export function nodePrerequisitesSatisfied(node: BaseNodeDefinition, save: AchievementSave): boolean {
  return prerequisiteIds(node).every(id => Boolean(save.nodeProgress[id]));
}

/** Shared by model completion and player claims; never supplements missing parents. */
export function nodeCompletionIssue(catalog: ContentCatalog, save: AchievementSave, nodeId: string): string | undefined {
  const definition = nodeDefinition(catalog, nodeId);
  if (!definition) return `未知节点 ${nodeId}。`;
  const { module, node } = definition;
  if (!nodePrerequisitesSatisfied(node, save)) return `节点 ${nodeId} 的前置条件未满足。`;
  if (node.choiceGroupId && nodeDefinitions(catalog).some(peer => peer.node.nodeId !== nodeId && peer.node.choiceGroupId === node.choiceGroupId && save.nodeProgress[peer.node.nodeId])) {
    return `节点 ${nodeId} 的互斥分支已经确定。`;
  }
  if (isTaskNode(module, node) && !save.nodeProgress[nodeId] && !['active', 'claimable'].includes(getTaskNodeState(catalog, save, nodeId)!)) {
    return `任务节点 ${nodeId} 尚未接取或已失效。`;
  }
  return undefined;
}
/**
 * 【核心规则 1：五态任务流转状态机】
 *
 * 一个任务（职业、技能、知识）当前处于什么状态？
 * 这个状态是【算】出来的，而不是存一个字符串字段随便改的。
 * 状态必须严格遵循五步走，任何人（包括 AI）不能跳级：
 *
 * 1. 'completed' (已完成)：save.nodeProgress 里有记录。
 * 2. 'blocked'   (锁死)：前置成就还没全部做完。
 * 3. 'claimable' (待领取)：AI在剧情里判定达成了(claimableAt)，但玩家还没点领取。
 * 4. 'active'    (进行中)：玩家已经点击接取了(acceptedAt)，AI 才会去检测这个任务。
 * 5. 'available' (可接取)：前置满足了，等着玩家在界面上点击接取。
 */
export function getTaskNodeState(
  catalog: ContentCatalog,
  save: AchievementSave,
  nodeId: string,
): TaskNodeState | undefined {
  const definition = nodeDefinition(catalog, nodeId);
  if (!definition || !isTaskNode(definition.module, definition.node))
    return undefined;
  if (save.nodeProgress[nodeId]) return "completed";
  if (definition.node.dependencies && !skillOwnerVisible(catalog, save, definition.node)) return 'blocked';
  if (!nodePrerequisitesSatisfied(definition.node, save) || (definition.node.choiceGroupId && nodeDefinitions(catalog).some(peer => peer.node.nodeId !== nodeId && peer.node.choiceGroupId === definition.node.choiceGroupId && save.nodeProgress[peer.node.nodeId])))
    return "blocked";
  const task = save.nodeTasks[nodeId];
  if (task?.claimableAt) return "claimable";
  return task?.acceptedAt ? "active" : "available";
}
function skillOwnerVisible(
  catalog: ContentCatalog,
  save: AchievementSave,
  node: BaseNodeDefinition,
): boolean {
  if (!("skillTreeId" in node) || typeof node.skillTreeId !== "string")
    return true;
  const tree = catalog.modules.abilities.skillTrees.find(
    (candidate) => candidate.skillTreeId === node.skillTreeId,
  );
  const owner = catalog.modules.abilities.owners.find(
    (candidate) => candidate.skillOwnerId === tree?.skillOwnerId,
  );
  return !owner?.revealNodeId || Boolean(save.nodeProgress[owner.revealNodeId]);
}
function taskVisible(
  catalog: ContentCatalog,
  save: AchievementSave,
  module: NodeModule,
  node: BaseNodeDefinition,
): boolean {
  return (
    isTaskNode(module, node) &&
    (module !== "abilities" || skillOwnerVisible(catalog, save, node))
  );
}
function cardView(
  card: AnnotationCard | undefined,
): PlayerCardView | undefined {
  if (!card) return undefined;
  return {
    cardId: card.cardId,
    style: card.style,
    text: card.textOverride ?? card.text,
    ...imageReference(card),
  };
}
function playerNodeView(
  node: BaseNodeDefinition,
  save: AchievementSave,
  root = false,
  nodeState?: TaskNodeState,
): PlayerNodeBase | undefined {
  const progress = save.nodeProgress[node.nodeId];
  if (!progress && !root && nodeState === undefined) return undefined;
  const card = progress?.cardId
    ? cardView(save.annotationCards[progress.cardId])
    : undefined;
  return {
    nodeId: node.nodeId,
    nodeName:
      progress?.nodeNameOverride ??
      save.retractedNodeProgress[node.nodeId]?.nodeNameOverride ??
      node.nodeName,
    unlocked: Boolean(progress),
    ...(node.description ? { authorDescription: node.description } : {}),
    ...(nodeState ? { nodeState } : {}),
    ...(progress?.generatedCopy?.description
      ? { description: progress.generatedCopy.description }
      : {}),
    ...(card ? { card } : {}),
    ...(progress ? imageReference(node) : {}),
  };
}

/**
 * 【核心规则 2：只读视图投影 (Read-Only Projection)】
 *
 * 为什么前端 UI 不能直接读取原始的 save 存档？
 * - 原始 save 里都是零散的 ID、时间戳、字典映射，直接给 UI 绑定会导致 UI 满屏逻辑判断。
 * - 本函数负责把【静态配置 catalog】和【动态存档 save】熔接，生成一份专门给前端画界面的“快照”：
 *   - 过滤掉未解锁迷雾区域
 *   - 计算章节连线 (edges)
 *   - 计算待领取、可接取的红点统计 (availableTaskCount, claimableTaskCount)
 * UI 拿到它只管老老实实渲染，没有任何机会改脏底层数据！
 */
export function buildPlayerView(
  catalog: ContentCatalog,
  save: AchievementSave,
): AchievementPlayerView {
  const m = catalog.modules,
    nodes: PlayerNodeView[] = [];
  // Only the contiguous opened prefix is revealed. First chapter is the entry.
  const chapters: AchievementPlayerView["chapters"] = [];
  for (const chapter of [...m.adventure.chapters].sort(
    (a, b) => a.chapterNumber - b.chapterNumber,
  )) {
    if (
      chapter.chapterNumber !== 1 &&
      !save.chapterProgress[chapter.chapterId]?.opened
    )
      break;
    chapters.push({ ...chapter });
  }
  const open = new Set(chapters.map((c) => c.chapterId));
  for (const node of m.adventure.nodes) {
    const tree = m.adventure.storyTrees.find(
      (t) => t.storyTreeId === node.storyTreeId,
    )!;
    if (!open.has(tree.chapterId)) continue;
    const view = playerNodeView(node, save, tree.rootNodeId === node.nodeId || Boolean(tree.entryNodeId && !branchParentId(node)), getTaskNodeState(catalog, save, node.nodeId));
    if (view)
      nodes.push({
        ...view,
        module: "adventure",
        chapterId: tree.chapterId,
        storyTreeId: tree.storyTreeId,
      });
  }
  for (const node of m.bonds.nodes) {
    const v = playerNodeView(node, save, false, getTaskNodeState(catalog, save, node.nodeId));
    if (v) nodes.push({ ...v, module: "bonds", personId: node.personId });
  }
  for (const node of m.careers.nodes) {
    const v = playerNodeView(
      node,
      save,
      false,
      getTaskNodeState(catalog, save, node.nodeId),
    );
    if (v)
      nodes.push({ ...v, module: "careers", careerTreeId: node.careerTreeId });
  }
  for (const node of m.abilities.nodes) {
    if (node.nodeKind === "combat") {
      const tree = m.abilities.combatTrees.find(t => t.combatTreeId === node.combatTreeId)!;
      if (!save.nodeProgress[tree.rootNodeId] && !(node.dependencies && node.nodeId === tree.rootNodeId)) continue;
      const unlocked = Boolean(save.nodeProgress[node.nodeId]);
      nodes.push({
        nodeId: node.nodeId, nodeName: node.nodeName, module: "abilities",
        nodeKind: "combat", combatTreeId: node.combatTreeId, unlocked,
        ...(getTaskNodeState(catalog, save, node.nodeId) ? { nodeState: getTaskNodeState(catalog, save, node.nodeId)! } : {}),
        ...(unlocked ? { description: node.description, ...imageReference(node) } : {}),
      });
      continue;
    }
    if (node.nodeKind === "skill" && !skillOwnerVisible(catalog, save, node))
      continue;
    const v = playerNodeView(
      node,
      save,
      false,
      node.nodeKind === "skill"
        ? getTaskNodeState(catalog, save, node.nodeId)
        : undefined,
    );
    if (!v) continue;
    nodes.push({
        ...v,
        module: "abilities",
        nodeKind: "skill",
        skillTreeId: node.skillTreeId,
        skillOwnerId: m.abilities.skillTrees.find(
          (t) => t.skillTreeId === node.skillTreeId,
        )!.skillOwnerId,
      });
  }
  for (const node of m.knowledge.nodes) {
    const v = playerNodeView(
      node,
      save,
      false,
      getTaskNodeState(catalog, save, node.nodeId),
    );
    if (v)
      nodes.push({
        ...v,
        module: "knowledge",
        knowledgeTopicId: node.knowledgeTopicId,
        knowledgeDomainId: m.knowledge.topics.find(
          (t) => t.knowledgeTopicId === node.knowledgeTopicId,
        )!.knowledgeDomainId,
      });
  }
  for (const node of m.travel.locations) {
    const v = playerNodeView(node, save, false, getTaskNodeState(catalog, save, node.nodeId));
    if (v)
      nodes.push({
        ...v,
        module: "travel",
        travelRegionId: node.travelRegionId,
        mapId: m.travel.regions.find(
          (r) => r.travelRegionId === node.travelRegionId,
        )!.mapId,
      });
  }
  const groups: PlayerGroupView[] = [];
  function group(
    module: NodeModule,
    kind: PlayerGroupView["kind"],
    groupId: string,
    groupName: string,
    members: PlayerNodeView[],
    parentGroupId?: string,
    picture?: ImageReference,
  ) {
    if (!members.length) return;
    groups.push({
      module,
      kind,
      groupId,
      groupName,
      nodeIds: members.map((n) => n.nodeId),
      ...(parentGroupId ? { parentGroupId } : {}),
      ...imageReference(picture),
    });
  }
  for (const t of m.adventure.storyTrees)
    group(
      "adventure",
      "storyTree",
      t.storyTreeId,
      t.storyTreeName,
      nodes.filter(
        (n) => n.module === "adventure" && n.storyTreeId === t.storyTreeId,
      ),
      t.chapterId,
      t,
    );
  for (const p of m.bonds.people)
    group(
      "bonds",
      "person",
      p.personId,
      p.personName,
      nodes.filter((n) => n.module === "bonds" && n.personId === p.personId),
      undefined,
      p,
    );
  for (const t of m.careers.trees)
    group(
      "careers",
      "careerTree",
      t.careerTreeId,
      t.careerTreeName,
      nodes.filter(
        (n) => n.module === "careers" && n.careerTreeId === t.careerTreeId,
      ),
      undefined,
      t,
    );
  for (const o of m.abilities.owners)
    group(
      "abilities",
      "skillOwner",
      o.skillOwnerId,
      o.skillOwnerName,
      nodes.filter(
        (n) =>
          n.module === "abilities" &&
          n.nodeKind === "skill" &&
          n.skillOwnerId === o.skillOwnerId,
      ),
      undefined,
      o,
    );
  for (const t of m.abilities.skillTrees)
    group(
      "abilities",
      "skillTree",
      t.skillTreeId,
      t.skillTreeName,
      nodes.filter(
        (n) =>
          n.module === "abilities" &&
          n.nodeKind === "skill" &&
          n.skillTreeId === t.skillTreeId,
      ),
      t.skillOwnerId,
      t,
    );
  for (const t of m.abilities.combatTrees) {
    const rootState = getTaskNodeState(catalog, save, t.rootNodeId);
    const unlocked = Boolean(save.nodeProgress[t.rootNodeId]) || Boolean(rootState && rootState !== 'blocked');
    const picture = imageReference(t);
    groups.push({
      module: "abilities", kind: "combatTree", groupId: t.combatTreeId,
      groupName: unlocked ? t.combatTreeName : "？？？", unlocked,
      ...(unlocked ? { rootNodeId: t.rootNodeId, ...(t.aliases ? {aliases: [...t.aliases]} : {}), ...(t.tags ? {tags: [...t.tags]} : {}), ...(t.recommendedRank ? {recommendedRank:t.recommendedRank} : {}) } : {}),
      nodeIds: nodes.filter(n => n.module === "abilities" && n.nodeKind === "combat" && n.combatTreeId === t.combatTreeId).map(n => n.nodeId),
      ...picture, ...(picture.assetRef || picture.imageName ? { imageAlt: unlocked ? picture.imageAlt : "尚未遇见的怪物" } : {}),
    });
  }
  for (const d of m.knowledge.domains)
    group(
      "knowledge",
      "knowledgeDomain",
      d.knowledgeDomainId,
      d.knowledgeDomainName,
      nodes.filter(
        (n) =>
          n.module === "knowledge" &&
          n.knowledgeDomainId === d.knowledgeDomainId,
      ),
      undefined,
      d,
    );
  for (const t of m.knowledge.topics)
    group(
      "knowledge",
      "knowledgeTopic",
      t.knowledgeTopicId,
      t.knowledgeTopicName,
      nodes.filter(
        (n) =>
          n.module === "knowledge" && n.knowledgeTopicId === t.knowledgeTopicId,
      ),
      t.knowledgeDomainId,
      t,
    );
  for (const t of m.travel.maps)
    group(
      "travel",
      "map",
      t.mapId,
      t.mapName,
      nodes.filter((n) => n.module === "travel" && n.mapId === t.mapId),
      undefined,
      t,
    );
  for (const r of m.travel.regions)
    group(
      "travel",
      "travelRegion",
      r.travelRegionId,
      r.travelRegionName,
      nodes.filter(
        (n) => n.module === "travel" && n.travelRegionId === r.travelRegionId,
      ),
      r.mapId,
      r,
    );
  const visible = new Map(nodes.map((node) => [node.nodeId, node]));
  const scope = new Map<string, string>();
  for (const node of nodes)
    scope.set(
      node.nodeId,
      node.module === "adventure"
        ? node.storyTreeId
        : node.module === "bonds"
          ? node.personId
          : node.module === "careers"
            ? node.careerTreeId
            : node.module === "abilities"
              ? node.nodeKind === "skill"
                ? node.skillTreeId
                : node.combatTreeId
              : node.module === "knowledge"
                ? node.knowledgeTopicId
                : node.travelRegionId,
    );
  const edges = nodeDefinitions(catalog).flatMap(({ module, node }) => {
    const target = visible.get(node.nodeId);
    const combat = target?.module === "abilities" && target.nodeKind === "combat";
    if (!target || (!combat && !target.nodeState && !target.unlocked)) return [];
    return (node.dependencies ? node.dependencies.filter(dep => dep.kind === 'branch').map(dep => dep.nodeId) : prerequisiteIds(node))
      .filter((id) => {
        const source = visible.get(id);
        return (
          source &&
          source.module === module &&
          scope.get(id) === scope.get(node.nodeId) &&
          (combat || target.nodeState ? true : source.unlocked)
        );
      })
      .map((from) => ({ module, from, to: node.nodeId }));
  });
  const available = nodes.filter((node) => node.nodeState === "available");
  const claimable = nodes.filter((node) => node.nodeState === "claimable");
  return {
    revision: save.revision,
    ...(save.orphanedProgress ? { orphanedProgress: structuredClone(save.orphanedProgress) } : {}),
    ...(save.orphanedChapters ? { orphanedChapters: structuredClone(save.orphanedChapters) } : {}),
    nodes,
    groups,
    edges,
    chapters,
    availableTaskCount: available.length,
    claimableTaskCount: claimable.length,
    actionableTaskCount: available.length + claimable.length,
    newAvailableTaskIds: available
      .filter((node) => !save.nodeTasks[node.nodeId]?.availabilityNotified)
      .map((node) => node.nodeId),
    newClaimableTaskIds: claimable
      .filter((node) => !save.nodeTasks[node.nodeId]?.claimabilityNotified)
      .map((node) => node.nodeId),
    moduleNames: Object.fromEntries(
      CONTENT_MODULES.map((id) => [id, m[id].moduleName]),
    ) as Record<ContentModule, string>,
    journalEntries: save.journalEntries.map((e) => ({
      journalId: e.journalId,
      origin: e.origin,
      ...(e.title ? { title: e.title } : {}),
      text:
        e.origin === "player"
          ? e.playerText
          : (e.playerText ?? e.generatedText),
      createdAt: e.createdAt,
    })),
  };
}

function acceptNodeTask(
  catalog: ContentCatalog,
  save: AchievementSave,
  command: Extract<PlayerCommand, { type: "acceptNodeTask" }>,
): void {
  const definition = nodeDefinition(catalog, command.nodeId);
  if (
    !definition ||
    !taskVisible(catalog, save, definition.module, definition.node)
  )
    throw new Error(`节点 ${command.nodeId} 不是当前可见的成长任务。`);
  if (getTaskNodeState(catalog, save, command.nodeId) !== "available")
    throw new Error(`节点 ${command.nodeId} 当前不能接取。`);
  save.nodeTasks[command.nodeId] = {
    ...save.nodeTasks[command.nodeId],
    acceptedAt: requireIsoDate(command.acceptedAt),
  };
}

function markAvailableTasksNotified(
  catalog: ContentCatalog,
  save: AchievementSave,
  nodeIds: string[],
): void {
  if (!nodeIds.length) throw new Error("没有需要标记的任务提醒。");
  for (const nodeId of new Set(nodeIds)) {
    const definition = nodeDefinition(catalog, nodeId);
    if (
      !definition ||
      !taskVisible(catalog, save, definition.module, definition.node) ||
      getTaskNodeState(catalog, save, nodeId) !== "available"
    ) {
      throw new Error(`节点 ${nodeId} 当前不是可提醒的任务。`);
    }
    save.nodeTasks[nodeId] = {
      ...save.nodeTasks[nodeId],
      availabilityNotified: true,
    };
  }
}

function markClaimableTasksNotified(
  catalog: ContentCatalog,
  save: AchievementSave,
  nodeIds: string[],
): void {
  if (!nodeIds.length) throw new Error("没有需要标记的领取提醒。");
  for (const nodeId of new Set(nodeIds)) {
    const definition = nodeDefinition(catalog, nodeId);
    if (
      !definition ||
      !taskVisible(catalog, save, definition.module, definition.node) ||
      getTaskNodeState(catalog, save, nodeId) !== "claimable"
    ) {
      throw new Error(`节点 ${nodeId} 当前不是可提醒的待领取成就。`);
    }
    save.nodeTasks[nodeId] = {
      ...save.nodeTasks[nodeId],
      claimabilityNotified: true,
    };
  }
}

function claimNodeTask(
  catalog: ContentCatalog,
  save: AchievementSave,
  command: Extract<PlayerCommand, { type: "claimNodeTask" }>,
): void {
  const definition = nodeDefinition(catalog, command.nodeId);
  if (
    !definition ||
    !taskVisible(catalog, save, definition.module, definition.node)
  )
    throw new Error(`节点 ${command.nodeId} 不是当前可见的成长任务。`);
  if (getTaskNodeState(catalog, save, command.nodeId) !== "claimable")
    throw new Error(`节点 ${command.nodeId} 当前不能领取。`);
  const issue = nodeCompletionIssue(catalog, save, command.nodeId);
  if (issue) throw new Error(issue);
  const task = save.nodeTasks[command.nodeId]!;
  if ('nodeKind' in definition.node && definition.node.nodeKind === 'combat') {
    save.nodeProgress[command.nodeId] = { ...save.retractedNodeProgress[command.nodeId], status: 'unlocked', unlockedAt: requireIsoDate(command.claimedAt), sourceRefs: [] };
    delete save.nodeTasks[command.nodeId];
    delete save.retractedNodeProgress[command.nodeId];
    return;
  }
  const archived = save.retractedNodeProgress[command.nodeId];
  const cardId = archived?.cardId ?? `card.node.${command.nodeId}`;
  const previousCard = save.annotationCards[cardId];
  const style =
    definition.module === 'adventure' ? 'story' : definition.module === 'bonds' ? 'friend' : definition.module === 'travel' ? 'place' : definition.module === "careers"
      ? "career"
      : definition.module === "knowledge"
        ? "knowledge"
        : "skill";
  save.nodeProgress[command.nodeId] = {
    status: "unlocked",
    unlockedAt: requireIsoDate(command.claimedAt),
    sourceRefs: [],
    cardId,
    ...(archived?.nodeNameOverride
      ? { nodeNameOverride: archived.nodeNameOverride }
      : {}),
    ...(task.completionCopy
      ? { generatedCopy: structuredClone(task.completionCopy) }
      : {}),
  };
  save.annotationCards[cardId] = {
    cardId,
    nodeId: command.nodeId,
    style,
    text: task.completionCopy?.memento ?? task.completionCopy?.description ?? definition.node.condition,
    sourceRefs: [],
    ...imageReference(previousCard?.assetRef || previousCard?.imageName ? previousCard : definition.node),
    ...(task.completionCopy?.description === undefined && previousCard?.textOverride
      ? { textOverride: previousCard.textOverride }
      : {}),
  };
  delete save.nodeTasks[command.nodeId];
  delete save.retractedNodeProgress[command.nodeId];
}

function editNodeCard(
  save: AchievementSave,
  command: Extract<PlayerCommand, { type: "editNodeCard" }>,
): void {
  const progress = save.nodeProgress[command.nodeId];
  const card = progress?.cardId
    ? save.annotationCards[progress.cardId]
    : undefined;
  if (!card) throw new Error(`节点 ${command.nodeId} 没有可编辑的附言卡。`);
  if (command.patch.nodeName === undefined && command.patch.text === undefined)
    throw new Error("没有需要保存的改动。");
  if (command.patch.nodeName !== undefined)
    progress!.nodeNameOverride = requireBoundedText(
      command.patch.nodeName,
      "节点名称",
      200,
    );
  if (command.patch.text !== undefined)
    card.textOverride = requireBoundedText(
      command.patch.text,
      "卡片正文",
      4_000,
    );
}

function addPlayerJournal(
  catalog: ContentCatalog,
  save: AchievementSave,
  command: Extract<PlayerCommand, { type: "addPlayerJournal" }>,
): void {
  if (
    save.journalEntries.some((entry) => entry.journalId === command.journalId)
  )
    throw new Error(`日记 ${command.journalId} 已存在。`);
  save.journalEntries.push({
    journalId: requireBoundedText(command.journalId, "日记 ID", 200),
    origin: "player",
    ...(command.title?.trim() ? { title: requireBoundedText(command.title, "日记标题", 200) } : {}),
    playerText: requireBoundedText(
      command.text,
      "日记正文",
      catalog.modules.journal.maxEntryLength,
    ),
    createdAt: requireIsoDate(command.createdAt),
    sourceRefs: [],
  });
}

function editJournalEntry(
  catalog: ContentCatalog,
  save: AchievementSave,
  command: Extract<PlayerCommand, { type: "editJournalEntry" }>,
): void {
  const entry = save.journalEntries.find(
    (candidate) => candidate.journalId === command.journalId,
  );
  if (!entry) throw new Error(`找不到日记 ${command.journalId}。`);
  if (command.title !== undefined) {
    if (command.title.trim()) entry.title = requireBoundedText(command.title, "日记标题", 200);
    else delete entry.title;
  }
  entry.playerText = requireBoundedText(
    command.text,
    "日记正文",
    catalog.modules.journal.maxEntryLength,
  );
}

function deleteJournalEntry(save: AchievementSave, journalId: string): void {
  const index = save.journalEntries.findIndex(
    (entry) => entry.journalId === journalId,
  );
  if (index < 0) throw new Error(`找不到日记 ${journalId}。`);
  save.journalEntries.splice(index, 1);
}

function sameSource(
  left: MessageEvidenceRef,
  right: MessageEvidenceRef,
): boolean {
  return (
    left.messageId === right.messageId &&
    left.contentVersion === right.contentVersion
  );
}

/**
 * 【核心规则 3：连带级联回滚 (Cascade Rollback)】
 *
 * 规则：如果玩家后悔了，把一个父成就“重新上锁”，会发生什么？
 * 必须“拔出萝卜带出泥”！
 * - 递归找出所有以它为前置的子孙成就；
 * - 连带把子孙成就全部打回锁定状态，并存入 retractedNodeProgress 备份；
 * - 清除所有下游的任务状态。
 * 绝不能出现“父节点锁着，子节点却亮着”的荒谬断层！
 */
function lockNode(
  catalog: ContentCatalog,
  save: AchievementSave,
  nodeId: string,
): void {
  if (!save.nodeProgress[nodeId]) throw new Error(`节点 ${nodeId} 尚未解锁。`);
  const nodes = nodeDefinitions(catalog).map((entry) => entry.node);
  const retracted = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (retracted.has(node.nodeId) || !save.nodeProgress[node.nodeId])
        continue;
      if (
        prerequisiteIds(node).some((prerequisiteId) =>
          retracted.has(prerequisiteId),
        )
      ) {
        retracted.add(node.nodeId);
        changed = true;
      }
    }
  }
  for (const retractedNodeId of retracted) {
    const progress = save.nodeProgress[retractedNodeId];
    if (!progress) continue;
    const correction = save.manualCorrections[retractedNodeId] ?? {
      rejectedSourceRefs: [],
    };
    for (const sourceRef of progress.sourceRefs) {
      if (
        !correction.rejectedSourceRefs.some((existing) =>
          sameSource(existing, sourceRef),
        )
      ) {
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
      if (
        !affected.has(node.nodeId) &&
        prerequisiteIds(node).some((id) => affected.has(id))
      ) {
        affected.add(node.nodeId);
        expanded = true;
      }
    }
  }
  for (const affectedNodeId of affected) delete save.nodeTasks[affectedNodeId];
}

/**
 * 【核心规则 4：聚合根唯一写入口 (Single Entry Mutation)】
 *
 * 前端界面无论发生什么玩家交互，【只能】调用这一个函数！
 *
 * 它的三大防线：
 * 1. 严格审查：根据 command.type 分流到具体的检查函数，任何非法操作直接抛错阻止。
 * 2. 数据不可变 (Immutable)：通过 structuredClone 深拷贝一份全新的 `next`，绝不改脏原数据。
 * 3. 版本自增：`next.revision += 1`，保证每次状态流转都有唯一版本号，彻底解决并发竞态。
 */
export function applyPlayerCommand(
  catalog: ContentCatalog,
  save: AchievementSave,
  command: PlayerCommand,
): AchievementSave {
  const next = structuredClone(save);
  if (command.type === "editNodeCard") {
    const definition = nodeDefinition(catalog, command.nodeId);
    if (definition && isCombatNode(definition.node)) throw new Error("怪物介绍由内容作者预设，不能在存档中改写。");
    editNodeCard(next, command);
  }
  else if (command.type === "lockNode") lockNode(catalog, next, command.nodeId);
  else if (command.type === "acceptNodeTask")
    acceptNodeTask(catalog, next, command);
  else if (command.type === "claimNodeTask")
    claimNodeTask(catalog, next, command);
  else if (command.type === "markAvailableTasksNotified")
    markAvailableTasksNotified(catalog, next, command.nodeIds);
  else if (command.type === "markClaimableTasksNotified")
    markClaimableTasksNotified(catalog, next, command.nodeIds);
  else if (command.type === "addPlayerJournal")
    addPlayerJournal(catalog, next, command);
  else if (command.type === "editJournalEntry")
    editJournalEntry(catalog, next, command);
  else if (command.type === "deleteJournalEntry")
    deleteJournalEntry(next, command.journalId);
  else throw new Error("不支持的玩家操作，你点你妈呢。");
  next.revision += 1;
  return next;
}
