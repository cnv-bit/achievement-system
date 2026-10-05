import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOrderedPrompts } from '../src/prompting/prompt-builder.ts';
import { loadBoundWorldbookContext } from '../src/prompting/worldbook-context.ts';
import { defaultSettings } from '../src/settings/model.ts';
import type { WorldbookPort } from '../src/runtime/ports.ts';
import type { ChildApiRequest } from '../src/domain/index.ts';

function request(): ChildApiRequest {
  return {
    schemaVersion: 1,
    requestId: 'request-1',
    chatId: 'chat-a',
    baseRevision: 0,
    allowedModules: ['adventure'],
    storyMessages: [
      { id: 'message-21', role: 'assistant', turnIndex: 10, text: '我推开示例地点的大门，守卫认出了来客。' },
    ],
    worldContext: ['守卫很谨慎。'],
    variables: { location: '示例地点' },
    candidates: [{
      module: 'adventure',
      nodeId: 'story.guard',
      condition: '遇到守卫。',
      prerequisiteIds: [],
    }],
    unlockedNodeIds: ['story.arrived'],
  };
}

test('prompt sections follow the required permission-to-output order', () => {
  const settings = defaultSettings();
  settings.sending.enabledModuleIds = ['adventure'];
  settings.prompts.modulePrompts.adventure = '判断剧情节点是否解锁。';
  const prompts = buildOrderedPrompts(settings, request());

  const sectionNames = prompts.map(prompt => prompt.name);
  assert.deepEqual(sectionNames, [
    'task-and-permissions',
    'world-and-persona',
    'filtered-story',
    'variables-and-state',
    'candidate-definitions',
    'reasoning-requirements',
    'output-protocol',
  ]);
  assert.equal(prompts[0]!.content.includes('adventure'), true);
  assert.equal(prompts[2]!.content.includes('我推开示例地点的大门'), true);
});

test('only enabled module prompts are included', () => {
  const settings = defaultSettings();
  settings.sending.enabledModuleIds = ['travel'];
  settings.prompts.modulePrompts.travel = '判断地点。';
  settings.prompts.modulePrompts.journal = '写日记。';

  const travelRequest = request();
  travelRequest.allowedModules = ['travel'];
  travelRequest.candidates = [];
  const prompts = buildOrderedPrompts(settings, travelRequest);

  const task = prompts[0]!.content;
  assert.equal(task.includes('判断地点。'), true);
  assert.equal(task.includes('写日记。'), false);
});

test('worldbook context loads shared entries and only user-keyword matches', async () => {
  const worldbooks: WorldbookPort = {
    names: () => ['共同书', '人物书'],
    entries: async name => name === '共同书'
      ? [{ uid: 1, name: '世界观', content: '共同设定' }]
      : [
          { uid: 7, name: '名字无关', content: '守卫设定', strategy: 'selective' as const, keys: ['守卫'] },
          { uid: 8, name: '商人', content: '商人设定', strategy: 'selective' as const, keys: ['商人'] },
        ],
  };

  const context = await loadBoundWorldbookContext(worldbooks, {
    sharedEntries: [{ worldbookName: '共同书', entryUid: 1 }],
    keywordBooks: [{ worldbookName: '人物书', entryUids: null }],
    characterEntries: {},
  }, [{ id: 0, role: 'user', text: '找守卫' }, { id: 1, role: 'assistant', text: '商人' }], { caseSensitive: false, matchWholeWords: false });

  assert.deepEqual(context.map(entry => entry.name), ['世界观', '名字无关']);
});
