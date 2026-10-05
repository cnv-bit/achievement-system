import assert from 'node:assert/strict';
import test from 'node:test';
import type { AchievementSave, ContentCatalog } from '../src/domain/types.ts';
import { skeletonModelContext } from '../src/runtime/model-context.ts';
import { buildChildApiRequest } from '../src/runtime/request-builder.ts';
import { AchievementRuntime } from '../src/runtime/achievement-runtime.ts';
import { AchievementMetadataRepository } from '../src/runtime/metadata.ts';
import { SettingsRepository } from '../src/settings/storage.ts';
import type { ChatContextPort, RuntimeChatMessage } from '../src/runtime/ports.ts';

const catalog: ContentCatalog = {
  schemaVersion: 2, choiceGroups: [],
  modules: {
    adventure: { module: 'adventure', moduleName: '剧情',
      chapters: [{ chapterId: 'chapter.3', chapterName: '第三章隐藏', chapterNumber: 3 }],
      storyTrees: [{ storyTreeId: 'story.hidden', storyTreeName: '隐藏剧情树', chapterId: 'chapter.3', rootNodeId: 'node.hidden' }], storyLines: [],
      nodes: [{ nodeId: 'node.hidden', nodeName: '隐藏节点', condition: '隐藏规则', storyTreeId: 'story.hidden' }],
    },
    bonds: { module: 'bonds', moduleName: '羁绊',
      people: [{ personId: 'person.a', personName: '已准入人物', keywords: ['Demo'] }, { personId: 'person.b', personName: '未命中人物', keywords: ['Merchant'] }],
      nodes: [
        { nodeId: 'bond.a1', nodeName: '旧阶段', personId: 'person.a', condition: '旧条件' },
        { nodeId: 'bond.a2', nodeName: '新阶段', personId: 'person.a', condition: '新条件', prerequisiteNodeIds: ['bond.a1'] },
        { nodeId: 'bond.b1', nodeName: '其他人', personId: 'person.b', condition: '不应发送' },
      ],
    },
    careers: { module: 'careers', moduleName: '职业', trees: [], nodes: [] },
    abilities: { module: 'abilities', moduleName: '技能', owners: [], skillTrees: [], combatTrees: [], nodes: [] },
    knowledge: { module: 'knowledge', moduleName: '知识', domains: [], topics: [], nodes: [] },
    travel: { module: 'travel', moduleName: '地图', maps: [], regions: [], locations: [] },
    journal: { module: 'journal', moduleName: '日记', maxEntryLength: 280 },
  },
};
const save: AchievementSave = {
  schemaVersion: 6, revision: 0, nodeTasks: {}, retractedNodeProgress: {}, annotationCards: {}, journalEntries: [], manualCorrections: {}, chapterProgress: {}, processedThrough: {}, appliedRequestIds: [],
  nodeProgress: Object.fromEntries(['bond.a1', 'bond.b1', 'node.hidden'].map(id => [id, { status: 'unlocked' as const, unlockedAt: '2026-10-01', sourceRefs: [] }])),
};

test('request scope matches body keywords, ignores individual selections and removes denied nodes and unrelated unlocked IDs', () => {
  const context = skeletonModelContext(catalog);
  context.canSend['chapter.3'] = false;
  context.variables = { currentRegion: '示例地区' };
  const input = {
    requestId: 'r1', chatId: 'chat1', catalog, save, allowedModules: ['bonds', 'adventure'] as const,
    selectedGroupIds: ['person.b', 'story.hidden'], context, worldContext: [],
    bodies: [{ turnIndex: 0, assistant: { id: 1, role: 'assistant' as const, text: 'Demo 在正文中。' } }],
  };
  const request = buildChildApiRequest({ ...input, allowedModules: [...input.allowedModules] });
  assert.deepEqual(request.candidates.map(node => node.nodeId), ['bond.a2']);
  assert.deepEqual(request.unlockedNodeIds, ['bond.a1']);
  assert.deepEqual(request.moduleContext.map(group => group.groupId), ['person.a']);
  assert.equal(JSON.stringify(request).includes('node.hidden'), false);
  assert.equal(JSON.stringify(request).includes('bond.b1'), false);
  const disabledModule = buildChildApiRequest({ ...input, allowedModules: ['journal'] });
  assert.deepEqual(disabledModule.moduleContext, []);
  assert.deepEqual(disabledModule.candidates, []);
  assert.deepEqual(disabledModule.unlockedNodeIds, []);
  context.canSend['bond.a1'] = false;
  const blocked = buildChildApiRequest({ ...input, allowedModules: [...input.allowedModules] });
  assert.deepEqual(blocked.candidates, [], 'hidden prerequisites must not be removed from a rule to enable it');
  assert.deepEqual(blocked.unlockedNodeIds, []);
  context.canSend.bonds = false;
  const denied = buildChildApiRequest({ ...input, allowedModules: [...input.allowedModules] });
  assert.equal(denied.allowedModules.includes('bonds'), false);
  assert.deepEqual(denied.moduleContext, []);
  const missing = buildChildApiRequest({ ...input, allowedModules: [...input.allowedModules], context: { canSend: {}, variables: {} } });
  assert.deepEqual(missing.candidates, []);
  assert.deepEqual(missing.allowedModules, []);
});

test('runtime matches all selected user messages, never backfills input, and rejects changed preview before API', async () => {
  const records = new Map<string, string>();
  const settings = new SettingsRepository({ getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value); } });
  const configured = settings.load();
  configured.textApi.apiUrl = 'https://example.com/v1';
  configured.textApi.model = 'offline';
  configured.sending.enabledModuleIds = ['bonds'];
  configured.sending.selectedGroupIds = ['person.a'];
  configured.sending.tagFilter.extractPattern = '<content>([\\s\\S]*?)</content>';
  configured.worldbooks.keywordBooks = [{ worldbookName: 'personas', entryUids: null }];
  await settings.save(configured);
  const messages: RuntimeChatMessage[] = [
    { id: 0, role: 'user', text: 'merchant' }, { id: 1, role: 'assistant', text: '<content>旧正文</content>' },
    { id: 2, role: 'user', text: 'Demo' }, { id: 3, role: 'user', text: 'clock' },
    { id: 4, role: 'assistant', text: '<content>无人物关键词的正文</content>' },
  ];
  const chat: ChatContextPort = {
    currentChatId: () => 'chat1', latestMessageId: () => 4,
    messages: (start, end) => messages.filter(message => message.id >= start && message.id <= end),
    keywordMatchOptions: () => ({ caseSensitive: false, matchWholeWords: false }),
    onAssistantMessage: () => () => undefined, onChatChanged: () => () => undefined,
  };
  class PreviewMetadata extends AchievementMetadataRepository {
    override load() { return structuredClone(save); }
  }
  let apiCalls = 0;
  const runtime = new AchievementRuntime({
    catalog, chat, settings, metadata: new PreviewMetadata({ read: () => undefined, write: async () => undefined }),
    variables: { read: () => ({}) }, readModelContext: () => skeletonModelContext(catalog),
    generation: { listModels: async () => [], generate: async () => { apiCalls++; throw new Error('offline-stop'); } },
    worldbooks: { names: () => ['personas'], entries: async () => [
      { uid: 1, name: '人设甲', content: 'matched-persona', strategy: 'selective', keys: ['Demo'], secondaryKeys: { logic: 'and_all', keys: ['clock'] } },
      { uid: 2, name: '商人', content: 'outside-range', strategy: 'selective', keys: ['merchant'] },
    ] },
  });
  const preview = await runtime.previewManual({ startFloor: 2, endFloor: 4 });
  assert.deepEqual(preview.userInputFloors, [2, 3]);
  assert.deepEqual(preview.request.worldContext, ['人设甲\nmatched-persona']);
  assert.deepEqual(preview.request.storyMessages.map(message => message.id), ['message-4']);
  assert.equal(preview.request.storyMessages.some(message => message.text.includes('Demo')), false);
  const replyOnly = await runtime.previewManual({ startFloor: 4, endFloor: 4 });
  assert.deepEqual(replyOnly.userInputFloors, []);
  assert.deepEqual(replyOnly.request.worldContext, []);
  assert.deepEqual(replyOnly.request.candidates, []);
  assert.deepEqual(replyOnly.prompts, []);
  const skipped = await runtime.sendPreview(replyOnly.previewId);
  assert.equal(skipped.skipped, true);
  assert.deepEqual(skipped.save, save);
  assert.equal(apiCalls, 0);
  const changed = await runtime.previewManual({ startFloor: 2, endFloor: 4 });
  messages[2]!.text = 'changed';
  await assert.rejects(runtime.sendPreview(changed.previewId), /用户输入已变化/);
  assert.equal(apiCalls, 0);
  messages[2]!.text = 'Demo';
  const newPreview = await runtime.previewManual({ startFloor: 2, endFloor: 4 });
  const updated = settings.load();
  updated.prompts.taskPrompt = '新的已保存任务';
  await settings.save(updated);
  await assert.rejects(runtime.sendPreview(newPreview.previewId), /配置发生变化/);
  assert.equal(apiCalls, 0);
  updated.sending.mode = 'automatic';
  updated.sending.bodyRounds = 1;
  await settings.save(updated);
  await assert.rejects(runtime.runAutomatic(4), /offline-stop/);
  assert.equal(apiCalls, 1, 'only the fake generator is called; no network exists in this check');
});
