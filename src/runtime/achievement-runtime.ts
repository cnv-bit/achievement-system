import {
  type AchievementSave,
  type ChildApiRequest,
  type ChildApiResponse,
  type ContentCatalog,
  type ContentModule,
  type NodeModule,
  type ResponseValidationContext,
} from '../domain/index.ts';
import { filterAssistantBody, selectAssistantBodies, selectUserMessages, type SelectedAssistantBody } from '../prompting/message-selection.ts';
import { buildOrderedPrompts, type NamedPrompt } from '../prompting/prompt-builder.ts';
import { loadBoundWorldbookContext } from '../prompting/worldbook-context.ts';
import type { RuntimeSettings } from '../settings/model.ts';
import { isTextApiConfigured } from '../settings/model.ts';
import type { SettingsRepository } from '../settings/storage.ts';
import { createRequestTicket, isRequestTicketCurrent } from './archive-guard.ts';
import type { RequestTicket } from './archive-guard.ts';
import { AchievementMetadataRepository } from './metadata.ts';
import type { ChatContextPort, RuntimeChatMessage, TextGenerationPort, VariableContextPort, WorldbookPort } from './ports.ts';
import { buildChildApiRequest } from './request-builder.ts';
import type { ModelRequest } from './request-builder.ts';
import { admittedModelGroups, catalogModelContext, type ModelContext, type ModelContextReader, type ModelGroupOption } from './model-context.ts';
import { applyChildApiResponseWithOutcome, type ResponseApplicationResult } from '../domain/response-application.ts';
import { parseChildApiResponseText } from './response-parser.ts';

export interface ManualRunSelection {
  startFloor: number;
  endFloor: number;
  moduleIds?: ContentModule[];
  maxRounds?: number;
}

export interface RuntimeRunResult {
  request: ModelRequest;
  response: ChildApiResponse;
  save: AchievementSave;
  skipped?: true;
  outcome?: Omit<ResponseApplicationResult, 'save'>;
}

export interface RuntimePreview {
  previewId: string;
  request: ModelRequest;
  prompts: NamedPrompt[];
  selectedFloors: number[];
  userInputFloors: number[];
}

interface RuntimeDependencies {
  catalog: ContentCatalog;
  chat: ChatContextPort;
  metadata: AchievementMetadataRepository;
  settings: SettingsRepository;
  generation: TextGenerationPort;
  worldbooks: WorldbookPort;
  variables: VariableContextPort;
  readModelContext?: ModelContextReader;
  onModelCommitted?: (result: RuntimeRunResult) => void;
}

interface PreparedRequest {
  request: ModelRequest;
  ticket: RequestTicket;
  activePersonIds: string[];
  bodies: SelectedAssistantBody[];
  context: ModelContext;
  userInputFloors: number[];
  catalogSnapshot: string;
}

interface PendingManualPreview {
  previewId: string;
  settings: RuntimeSettings;
  modules: ContentModule[];
  selection: ManualRunSelection;
  prepared: PreparedRequest;
  prompts: NamedPrompt[];
}

interface RunContext {
  selection: ManualRunSelection;
  settings: RuntimeSettings;
  mode: 'manual' | 'automatic';
}

function sourceMessages(bodies: SelectedAssistantBody[]): RuntimeChatMessage[] {
  return bodies.map(body => body.assistant);
}

function filteredBodies(bodies: SelectedAssistantBody[], settings: RuntimeSettings): SelectedAssistantBody[] {
  if (!settings.sending.tagFilter.extractPattern.trim()) {
    throw new Error('请先在“提示词与发送”中填写正文提取正则。');
  }
  return bodies.map(body => {
    const text = filterAssistantBody(body.assistant.text, settings.sending.tagFilter);
    if (!text) throw new Error(`第 ${body.assistant.id} 楼未提取到正文，请检查正文提取及排除正则。`);
    return { ...body, assistant: { ...body.assistant, text } };
  });
}

function responseContext(request: ChildApiRequest, activePersonIds: string[]): ResponseValidationContext {
  const candidateNodeIds: Partial<Record<NodeModule, string[]>> = {};
  for (const candidate of request.candidates) {
    (candidateNodeIds[candidate.module] ??= []).push(candidate.nodeId);
  }
  return {
    requestId: request.requestId,
    chatId: request.chatId,
    stateRevision: request.baseRevision,
    allowedModules: request.allowedModules,
    candidateNodeIds,
    activePersonIds,
    combatCandidateNodeIds: request.candidates.filter(c => c.module === 'abilities' && c.nodeKind === 'combat').map(c => c.nodeId),
  };
}

function requireRunnable(settings: RuntimeSettings, modules: ContentModule[]): void {
  if (!isTextApiConfigured(settings)) throw new Error('请先在设置页填写文本子 API 地址和模型。');
  if (modules.length === 0) throw new Error('本次没有选择允许更新的内容模块。');
}

function requireModules(modules: ContentModule[]): void {
  if (modules.length === 0) throw new Error('本次没有选择允许更新的内容模块。');
}

function validateSelection(selection: ManualRunSelection): void {
  if (!Number.isInteger(selection.startFloor) || !Number.isInteger(selection.endFloor)) {
    throw new Error('起止楼层必须是整数。');
  }
  if (selection.startFloor < 0 || selection.endFloor < selection.startFloor) {
    throw new Error('楼层范围无效。');
  }
  if (selection.maxRounds !== undefined && (!Number.isInteger(selection.maxRounds) || selection.maxRounds < 1)) throw new Error('正文数必须是正整数。');
}

export class AchievementRuntime {
  private readonly dependencies: RuntimeDependencies;
  private pendingManualPreview: PendingManualPreview | undefined;

  constructor(dependencies: RuntimeDependencies) {
    this.dependencies = dependencies;
  }

  latestMessageId(): number {
    return this.dependencies.chat.latestMessageId();
  }

  chapters() { return structuredClone(this.dependencies.catalog.modules.adventure.chapters); }

  currentChapterId(): string | undefined {
    return this.readContext(this.latestMessageId()).currentChapterId;
  }

  async setCurrentChapter(chapterId: string): Promise<void> {
    if (!this.chapters().some(chapter => chapter.chapterId === chapterId)) throw new Error('请选择有效的当前剧情章节。');
    await this.dependencies.metadata.commit(save => ({
      save: save.currentChapterId === chapterId ? save : { ...save, currentChapterId: chapterId, revision: save.revision + 1 },
      result: undefined,
    }));
    this.pendingManualPreview = undefined;
  }

  modelGroups(): ModelGroupOption[] {
    const latest = this.dependencies.chat.messages(0, this.latestMessageId()).filter(message => message.role === 'assistant').at(-1)?.id ?? this.latestMessageId();
    return admittedModelGroups(this.dependencies.catalog, this.readContext(latest))
      .map(({ module, id, label }) => ({ module, id, label }));
  }

  private readContext(messageId: number): ModelContext {
    const reader = this.dependencies.readModelContext;
    const save = this.dependencies.metadata.load();
    const context = reader ? structuredClone(reader(messageId, this.dependencies.variables.read(messageId))) : this.dependencies.catalog.schemaVersion === 3 ? catalogModelContext(this.dependencies.catalog, save) : { canSend: {}, variables: {} } as ModelContext;
    const chapterId = context.currentChapterId ?? save.currentChapterId;
    if (chapterId !== undefined) context.currentChapterId = chapterId;
    return context;
  }

  async previewManual(selection: ManualRunSelection): Promise<RuntimePreview> {
    validateSelection(selection);
    const settings = this.dependencies.settings.load();
    const modules = selection.moduleIds ?? settings.sending.enabledModuleIds;
    requireModules(modules);
    const bodies = selectAssistantBodies(this.dependencies.chat.messages(0, selection.endFloor), selection);
    if (bodies.length === 0) throw new Error('所选楼层内没有可用的助手正文。');
    const prepared = await this.prepareRequest(settings, modules, bodies, { selection, mode: 'manual' });
    this.assertCurrent(prepared, selection, settings);
    const prompts = prepared.request.allowedModules.length ? buildOrderedPrompts(settings, prepared.request) : [];
    const previewId = prepared.request.requestId;
    this.pendingManualPreview = { previewId, settings, modules, selection, prepared, prompts };
    return {
      previewId,
      request: prepared.request,
      prompts,
      selectedFloors: prepared.bodies.map(body => body.assistant.id),
      userInputFloors: prepared.userInputFloors,
    };
  }

  async sendPreview(previewId: string): Promise<RuntimeRunResult> {
    const pending = this.pendingManualPreview;
    if (!pending || pending.previewId !== previewId) throw new Error('这份预览已失效，请重新生成后再发送。');
    this.assertCurrent(pending.prepared, pending.selection, pending.settings);
    if (!pending.prepared.request.allowedModules.length) {
      this.pendingManualPreview = undefined;
      return this.skippedResult(pending.prepared);
    }
    requireRunnable(pending.settings, pending.modules);
    const rawResponse = await this.generate(pending.settings, pending.prepared.request, pending.prompts);
    const result = await this.commitResponse(pending.prepared, rawResponse, { selection: pending.selection, settings: pending.settings, mode: 'manual' });
    if (this.pendingManualPreview === pending) this.pendingManualPreview = undefined;
    return result;
  }

  async runManual(selection: ManualRunSelection): Promise<RuntimeRunResult> {
    validateSelection(selection);
    const settings = this.dependencies.settings.load();
    const modules = selection.moduleIds ?? settings.sending.enabledModuleIds;
    requireModules(modules);
    const bodies = selectAssistantBodies(this.dependencies.chat.messages(0, selection.endFloor), selection);
    if (bodies.length === 0) throw new Error('所选楼层内没有可用的助手正文。');
    return this.execute(settings, modules, bodies, { selection, mode: 'manual' });
  }

  async runAutomatic(endFloor: number): Promise<RuntimeRunResult | undefined> {
    const settings = this.dependencies.settings.load();
    if (settings.sending.mode !== 'automatic') return undefined;
    const allMessages = this.dependencies.chat.messages(0, endFloor);
    const allBodies = selectAssistantBodies(allMessages, { startFloor: 0, endFloor });
    const save = this.dependencies.metadata.load();
    const context = this.readContext(allBodies.at(-1)?.assistant.id ?? endFloor);
    const admittedSettings = structuredClone(settings);
    admittedSettings.sending.enabledModuleIds = settings.sending.enabledModuleIds.filter(module => context.canSend[module] === true);
    if (!shouldAutomaticallyRun(admittedSettings, save, allBodies)) return undefined;
    // Cadence may skip rounds, but automatic material always contains only the newest round.
    const previousBody = allBodies.at(-2);
    const selection = { startFloor: previousBody ? previousBody.assistant.id + 1 : 0, endFloor, maxRounds: 1 };
    return this.execute(settings, admittedSettings.sending.enabledModuleIds, allBodies.slice(-1), { selection, mode: 'automatic' });
  }

  private async execute(
    settings: RuntimeSettings,
    modules: ContentModule[],
    bodies: SelectedAssistantBody[],
    options: Pick<RunContext, 'selection' | 'mode'>,
  ): Promise<RuntimeRunResult> {
    const { selection, mode } = options;
    const prepared = await this.prepareRequest(settings, modules, bodies, options);
    this.assertCurrent(prepared, selection, settings);
    if (!prepared.request.allowedModules.length) return this.skippedResult(prepared);
    requireRunnable(settings, modules);
    const rawResponse = await this.generate(settings, prepared.request);
    return this.commitResponse(prepared, rawResponse, { selection, settings, mode });
  }

  private skippedResult(prepared: PreparedRequest): RuntimeRunResult {
    const request = prepared.request;
    return { request, skipped: true, save: this.dependencies.metadata.load(), response: {
      schemaVersion: 1, requestId: request.requestId, chatId: request.chatId, baseRevision: request.baseRevision,
      judgementSummary: '本次没有命中的可发送树或其他模块材料，未请求模型。', updates: [],
    } };
  }

  private async prepareRequest(
    settings: RuntimeSettings,
    modules: ContentModule[],
    bodies: SelectedAssistantBody[],
    options: Pick<RunContext, 'selection' | 'mode'>,
  ): Promise<PreparedRequest> {
    const { selection, mode } = options;
    const chatId = this.dependencies.chat.currentChatId();
    const users = selectUserMessages(this.dependencies.chat.messages(selection.startFloor, selection.endFloor), selection);
    const preparedBodies = filteredBodies(bodies, settings);
    const context = this.readContext(preparedBodies.at(-1)!.assistant.id);
    if (modules.includes('adventure') && context.canSend.adventure === true && !this.chapters().some(chapter => chapter.chapterId === context.currentChapterId)) {
      throw new Error('请先在“提示词与发送”中选择并保存当前剧情章节；不会按最高已解锁章推断。');
    }
    const save = this.dependencies.metadata.load();
    const matchOptions = this.dependencies.chat.keywordMatchOptions();
    const catalogSnapshot = JSON.stringify(this.dependencies.catalog);
    const worldContext = await loadBoundWorldbookContext(
      this.dependencies.worldbooks,
      settings.worldbooks,
      users,
      matchOptions,
    );
    const ticket = createRequestTicket(chatId, [...users, ...sourceMessages(bodies)].sort((left, right) => left.id - right.id), modules, { material: {
      selectedGroupIds: [...settings.sending.selectedGroupIds].sort(),
      tagFilter: settings.sending.tagFilter,
      prompts: settings.prompts,
      context,
      worldContext: worldContext.map(entry => [entry.worldbookName, entry.uid, entry.content]),
      catalogSnapshot,
      packBinding: [save.packId ?? null, save.packVersion ?? null, save.packHash ?? null],
    }, ...(mode === 'manual' ? { intentId: crypto.randomUUID() } : {}) });
    const request = buildChildApiRequest({
      requestId: ticket.requestId,
      chatId,
      catalog: this.dependencies.catalog,
      save,
      allowedModules: modules,
      bodies: preparedBodies,
      userMessages: users,
      includeUserInput: mode === 'automatic',
      matchOptions,
      selectedGroupIds: settings.sending.selectedGroupIds,
      context,
      worldContext: worldContext.map(entry => `${entry.name}\n${entry.content}`),
    });
    if (!modules.some(module => context.canSend[module] === true)) throw new Error('所选模块尚未获得数据侧的发送准入，请先接入 canSend 白名单。');
    const activePersonIds = request.moduleContext.filter(group => group.module === 'bonds').map(group => group.groupId);
    return { request, ticket, activePersonIds, bodies: preparedBodies, context, userInputFloors: users.map(message => message.id), catalogSnapshot };
  }

  private async commitResponse(prepared: PreparedRequest, rawResponse: string, context: RunContext): Promise<RuntimeRunResult> {
    const { selection, settings, mode } = context;
    const lastBody = prepared.bodies.at(-1)!;
    const parsedResponse = {
      ...parseChildApiResponseText(rawResponse),
      // 身份戳只取发送时的快照，不能取返回时的当前聊天或修订号。
      requestId: prepared.request.requestId,
      chatId: prepared.request.chatId,
      baseRevision: prepared.request.baseRevision,
    };
    const result = await this.dependencies.metadata.commit(currentSave => {
      if (this.dependencies.chat.currentChatId() !== prepared.request.chatId) throw new Error('聊天已切换，本次结果未写入。');
      if (!currentSave.appliedRequestIds.includes(prepared.request.requestId)) this.assertCurrent(prepared, selection, settings);
      const applied = applyChildApiResponseWithOutcome({
        catalog: this.dependencies.catalog,
        save: currentSave,
        response: parsedResponse,
        requestContext: responseContext(prepared.request, prepared.activePersonIds),
        ...(mode === 'automatic' ? { processedThrough: { messageId: `message-${lastBody.assistant.id}`, turnIndex: lastBody.turnIndex } } : {}),
        now: new Date().toISOString(),
      });
      const { save, ...outcome } = applied;
      return { save, result: { request: prepared.request, response: parsedResponse as ChildApiResponse, save, outcome } };
    });
    this.dependencies.onModelCommitted?.(result);
    return result;
  }

  private async generate(settings: RuntimeSettings, request: ChildApiRequest, prompts = buildOrderedPrompts(settings, request)): Promise<string> {
    return this.dependencies.generation.generate({
      generationId: request.requestId,
      prompts: prompts.map(({ role, content }) => ({ role, content })),
      connection: {
        source: settings.textApi.source,
        apiUrl: settings.textApi.apiUrl,
        apiKey: '', // 已保存的密钥仅由后端取用。
        model: settings.textApi.model,
        maxTokens: settings.textApi.maxTokens,
        temperature: settings.textApi.temperature,
      },
    });
  }

  private assertCurrent(prepared: PreparedRequest, selection: ManualRunSelection, settings: RuntimeSettings): void {
    if (JSON.stringify(this.dependencies.catalog) !== prepared.catalogSnapshot) throw new Error('成就内容发生变化，本次结果未写入，请重新预览。');
    const messages = this.dependencies.chat.messages(0, selection.endFloor);
    const bodies = selectAssistantBodies(messages, selection);
    const users = selectUserMessages(messages, selection);
    if (!isRequestTicketCurrent(prepared.ticket, this.dependencies.chat.currentChatId(), [...users, ...sourceMessages(bodies)].sort((left, right) => left.id - right.id))) {
      throw new Error('聊天、所选正文或用户输入已变化，本次结果未写入，请重新预览。');
    }
    if (JSON.stringify(this.dependencies.settings.load()) !== JSON.stringify(settings)) throw new Error('已保存配置发生变化，请重新预览；本次结果未写入。');
    if (JSON.stringify(this.readContext(prepared.bodies.at(-1)!.assistant.id)) !== JSON.stringify(prepared.context)) throw new Error('数据侧发送准入或变量发生变化，请重新预览；本次结果未写入。');
  }
}

export function shouldAutomaticallyRun(
  settings: RuntimeSettings,
  save: AchievementSave,
  bodies: SelectedAssistantBody[],
): boolean {
  if (settings.sending.mode !== 'automatic' || settings.sending.enabledModuleIds.length === 0 || bodies.length === 0) return false;
  const processedTurns = settings.sending.enabledModuleIds.map(module => save.processedThrough[module]?.turnIndex ?? -1);
  const oldestCursor = Math.min(...processedTurns);
  const newestTurn = bodies.at(-1)!.turnIndex;
  return newestTurn - oldestCursor >= settings.sending.autoEveryRounds;
}
