import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequestTicket, isRequestTicketCurrent } from '../src/runtime/archive-guard.ts';
import { AchievementMetadataRepository } from '../src/runtime/metadata.ts';
import type { AchievementMetadataPort, RuntimeChatMessage } from '../src/runtime/ports.ts';
import type { AchievementSave } from '../src/domain/index.ts';

class MemoryMetadataPort implements AchievementMetadataPort {
  state: AchievementSave = {
    schemaVersion: 6,
    chapterProgress: {},
    retractedNodeProgress: {},
    revision: 2,
    nodeProgress: {
      'story.existing': {
        status: 'unlocked',
        unlockedAt: '2026-09-29T00:00:00.000Z',
        sourceRefs: [{ messageId: 'message-3', contentVersion: 'v1:test' }],
      },
    },
    nodeTasks: {},
    annotationCards: {},
    journalEntries: [],
    manualCorrections: {},
    processedThrough: {},
    appliedRequestIds: [],
  };

  read(): unknown {
    return structuredClone(this.state);
  }

  async write(nextState: Record<string, unknown>): Promise<void> {
    this.state = structuredClone(nextState) as unknown as AchievementSave;
  }
}

class LegacyMetadataPort implements AchievementMetadataPort {
  writes = 0;
  state: unknown = {
    schemaVersion: 1,
    revision: 2,
    nodeProgress: {
      'story.existing': {
        status: 'unlocked',
        unlockedAt: '2026-09-29T00:00:00.000Z',
        sourceMessageIds: ['message-3'],
      },
    },
    journalEntries: [{
      id: 'journal.legacy',
      generatedText: '旧日记。',
      createdAt: '2026-09-29T00:00:00.000Z',
      sourceMessageIds: ['message-3'],
    }],
    processedThrough: {},
    appliedRequestIds: [],
  };

  read(): unknown { return structuredClone(this.state); }
  async write(nextState: Record<string, unknown>): Promise<void> {
    this.writes += 1;
    this.state = structuredClone(nextState);
  }
}

const sourceMessages: RuntimeChatMessage[] = [
  { id: 4, role: 'user', text: '进入城门。' },
  { id: 5, role: 'assistant', text: '守卫放行。' },
];

test('recording a processed request preserves existing node progress', async () => {
  const port = new MemoryMetadataPort();
  const repository = new AchievementMetadataRepository(port);
  const current = repository.load();

  await repository.save({
    ...current,
    revision: current.revision + 1,
    processedThrough: {
      ...current.processedThrough,
      adventure: { messageId: 'message-5', turnIndex: 2 },
    },
    appliedRequestIds: [...current.appliedRequestIds, 'request-1'],
  });

  assert.equal(port.state.nodeProgress['story.existing']?.status, 'unlocked');
  assert.deepEqual(port.state.processedThrough.adventure, { messageId: 'message-5', turnIndex: 2 });
  assert.deepEqual(port.state.appliedRequestIds, ['request-1']);
});

test('loading a version 1 save migrates it in memory without overwriting metadata', () => {
  const port = new LegacyMetadataPort();
  const repository = new AchievementMetadataRepository(port);

  const loaded = repository.load();

  assert.equal(loaded.schemaVersion, 6);
  assert.deepEqual(loaded.nodeProgress['story.existing']?.sourceRefs, [{
    messageId: 'message-3',
    contentVersion: 'legacy:unknown',
  }]);
  assert.equal(loaded.journalEntries[0]?.origin, 'generated');
  assert.deepEqual(loaded.annotationCards, {});
  assert.deepEqual(loaded.manualCorrections, {});
  assert.equal(port.writes, 0);
});

test('request ticket becomes stale when the current chat changes', () => {
  const ticket = createRequestTicket('chat-a', sourceMessages, ['adventure']);

  assert.equal(isRequestTicketCurrent(ticket, 'chat-b', sourceMessages), false);
});

test('request ticket becomes stale when a selected message is edited', () => {
  const ticket = createRequestTicket('chat-a', sourceMessages, ['adventure']);
  const edited = sourceMessages.map(message => message.id === 5 ? { ...message, text: '守卫拒绝放行。' } : message);

  assert.equal(isRequestTicketCurrent(ticket, 'chat-a', edited), false);
});

test('request id is stable for retries of the same chat input and module set', () => {
  const first = createRequestTicket('chat-a', sourceMessages, ['adventure', 'travel']);
  const retry = createRequestTicket('chat-a', sourceMessages, ['travel', 'adventure']);

  assert.equal(first.requestId, retry.requestId);
});
