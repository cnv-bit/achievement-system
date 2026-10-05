import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultSettings, validateSettings } from '../src/settings/model.ts';
import { SettingsRepository, type ChatSendingStorage, type StringStorage } from '../src/settings/storage.ts';

class MemoryStorage implements StringStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class MemoryChatSending implements ChatSendingStorage {
  value: unknown;
  read(): unknown { return this.value; }
  async write(settings: Parameters<ChatSendingStorage['write']>[0]): Promise<void> {
    this.value = structuredClone(settings);
  }
}

test('settings default to manual sending and no enabled content modules', () => {
  const settings = defaultSettings();

  assert.equal(settings.sending.mode, 'manual');
  assert.deepEqual(settings.sending.enabledModuleIds, []);
  assert.equal(settings.textApi.source, 'openai');
});

test('settings repository has no browser secret storage', () => {
  const accountStorage = new MemoryStorage();
  const repository = new SettingsRepository(accountStorage);
  const settings = defaultSettings();
  settings.textApi.apiUrl = 'https://api.example.com/v1';
  settings.textApi.model = 'example-model';

  repository.save(settings);

  const accountRecord = accountStorage.getItem('goblin-achievements.settings.v1')!;
  assert.equal(accountRecord.includes('text-secret'), false);
  assert.equal(accountRecord.includes('image-secret'), false);
  assert.equal(accountStorage.getItem('goblin-achievements.secrets.v1'), null);
  assert.equal(accountStorage.values.size, 1);
});

test('automatic mode and enabled modules follow the current chat', async () => {
  const accountStorage = new MemoryStorage();
  const chatStorage = new MemoryChatSending();
  const repository = new SettingsRepository(accountStorage, chatStorage);
  const settings = repository.load();
  settings.sending.mode = 'automatic';
  settings.sending.enabledModuleIds = ['travel', 'journal'];
  settings.sending.selectedGroupIds = ['travelRegion.demo-region'];
  settings.prompts.taskPrompt = '按剧情判定。';

  await repository.save(settings);

  assert.equal(repository.load().sending.mode, 'automatic');
  assert.deepEqual(repository.load().sending.enabledModuleIds, ['travel', 'journal']);
  assert.deepEqual(repository.load().sending.selectedGroupIds, ['travelRegion.demo-region']);
  chatStorage.value = undefined;
  assert.equal(repository.load().sending.mode, 'manual');
  assert.deepEqual(repository.load().sending.enabledModuleIds, []);
  assert.deepEqual(repository.load().sending.selectedGroupIds, []);
  assert.equal(repository.load().prompts.taskPrompt, '按剧情判定。');
});

test('keyword book and entry selections persist without changing API settings', async () => {
  const repository = new SettingsRepository(new MemoryStorage());
  const settings = repository.load();
  settings.worldbooks.keywordBooks = [{ worldbookName: 'all', entryUids: null }, { worldbookName: 'selected', entryUids: [7, 8] }];
  settings.worldbooks.sharedEntries = [{ worldbookName: 'selected', entryUid: 1 }];
  await repository.save(settings);
  assert.deepEqual(repository.load().worldbooks, settings.worldbooks);
});

test('malformed persisted settings fall back to safe defaults', () => {
  const accountStorage = new MemoryStorage();
  accountStorage.setItem('goblin-achievements.settings.v1', '{bad json');
  const repository = new SettingsRepository(accountStorage);

  assert.deepEqual(repository.load(), defaultSettings());
});

test('persisted settings discard invalid field types and unknown modules', () => {
  const accountStorage = new MemoryStorage();
  accountStorage.setItem('goblin-achievements.settings.v1', JSON.stringify({
    textApi: { source: 'unsupported', maxTokens: 'many' },
    sending: { bodyRounds: 'four', enabledModuleIds: ['travel', 'unknown-module'] },
  }));
  const repository = new SettingsRepository(accountStorage);
  const loaded = repository.load();

  assert.equal(loaded.textApi.source, 'openai');
  assert.equal(loaded.textApi.maxTokens, 4096);
  assert.equal(loaded.sending.bodyRounds, 4);
  assert.deepEqual(loaded.sending.enabledModuleIds, ['travel']);
});

test('settings validation rejects unsafe URLs and invalid automatic intervals', () => {
  const settings = defaultSettings();
  settings.textApi.apiUrl = 'file:///secret';
  settings.textApi.model = 'model';
  settings.sending.mode = 'automatic';
  settings.sending.autoEveryRounds = 0;

  assert.deepEqual(validateSettings(settings), [
    '文本 API 地址必须使用 http 或 https。',
    '自动发送间隔必须是正整数。',
  ]);
});
