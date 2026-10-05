import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterAssistantBody,
  matchesWorldbookKey,
  selectAssistantBodies,
  selectUserMessages,
} from '../src/prompting/message-selection.ts';
import type { RuntimeChatMessage } from '../src/runtime/ports.ts';

const messages: RuntimeChatMessage[] = [
  { id: 10, role: 'user', text: '用户输入不会参与扫描：示例地点。' },
  { id: 11, role: 'assistant', text: '<content>Demo 在城门旁等候。</content><think>隐藏分析</think>' },
  { id: 12, role: 'user', text: '继续。' },
  { id: 13, role: 'assistant', text: '<content>猎魔人先一步进了示例地点。</content>' },
];
const matching = { caseSensitive: false, matchWholeWords: false };

test('assistant body selection ignores user messages and accepts reply-only ranges', () => {
  const bodies = selectAssistantBodies(messages, { startFloor: 11, endFloor: 13 });
  assert.deepEqual(bodies.map(body => body.assistant.id), [11, 13]);
});

test('body extraction and user keyword material are separate selections', () => {
  const bodies = selectAssistantBodies(messages, { startFloor: 10, endFloor: 13 }).map(body => ({
    ...body,
    assistant: { ...body.assistant, text: filterAssistantBody(body.assistant.text, {
      extractPattern: '<content[^>]*>([\\s\\S]*?)<\\/content>',
      removePatterns: ['<think[^>]*>[\\s\\S]*?<\\/think>'],
    }) },
  }));
  assert.equal(bodies[0]!.assistant.text, 'Demo 在城门旁等候。');
  assert.deepEqual(selectUserMessages(messages, { startFloor: 11, endFloor: 13 }).map(message => message.id), [12]);
  assert.deepEqual(selectUserMessages(messages, { startFloor: 11, endFloor: 11 }), []);
});

test('worldbook matching supports slash regex and whole-word mode', () => {
  assert.equal(matchesWorldbookKey('Demo arrived', '/demo/i', matching), true);
  assert.equal(matchesWorldbookKey('cathedral', 'cat', { caseSensitive: false, matchWholeWords: true }), false);
});

test('body extraction never falls back to an unfiltered full match', () => {
  assert.throws(() => filterAssistantBody('<content>正文</content>', {
    extractPattern: '<content>[\\s\\S]*?<\\/content>',
    removePatterns: [],
  }), /第一个捕获组/);
});
