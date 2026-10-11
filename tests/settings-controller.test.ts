import assert from 'node:assert/strict';
import test from 'node:test';

import type { TextGenerationPort, TextGenerationRequest } from '../src/runtime/ports.ts';
import { ApiSettingsController } from '../src/settings/controller.ts';
import { SettingsRepository, type StringStorage } from '../src/settings/storage.ts';
import type { SecretsPort } from '../src/settings/ports.ts';

const secrets = (): SecretsPort => ({
  initialize: async () => ({ hasTextApiKey: true, hasImageApiKey: false }),
  save: async () => ({ hasTextApiKey: true, hasImageApiKey: false }),
});

class MemoryStorage implements StringStorage {
  readonly records = new Map<string, string>();
  getItem(key: string): string | null { return this.records.get(key) ?? null; }
  setItem(key: string, value: string): void { this.records.set(key, value); }
}

test('text connection test uses the unsaved form values', async () => {
  let captured: TextGenerationRequest | undefined;
  const generation: TextGenerationPort = {
    listModels: async () => ['model-a'],
    generate: async request => {
      captured = request;
      return 'OK';
    },
  };
  const controller = new ApiSettingsController(
    new SettingsRepository(new MemoryStorage()),
    generation,
    secrets(),
  );
  const settings = controller.load().settings;
  settings.textApi.apiUrl = 'https://api.example.com/v1';
  settings.textApi.model = 'model-a';

  await controller.testTextConnection(settings.textApi, 'form-secret');

  assert.equal(captured?.connection.apiKey, 'form-secret');
  assert.equal(captured?.prompts[0]?.content, '只回复 OK');
});

test('settings controller refuses to save an unsafe API URL', async () => {
  const generation: TextGenerationPort = { listModels: async () => [], generate: async () => 'OK' };
  const controller = new ApiSettingsController(
    new SettingsRepository(new MemoryStorage()),
    generation,
    secrets(),
  );
  const snapshot = controller.load();
  snapshot.settings.textApi.apiUrl = 'file:///secret';

  await assert.rejects(() => controller.save(snapshot.settings, ''), /文本 API 地址/);
});

test('model list rejects a missing API URL without making a request', async () => {
  let requestCount = 0;
  const generation: TextGenerationPort = {
    listModels: async () => {
      requestCount += 1;
      return [];
    },
    generate: async () => 'OK',
  };
  const controller = new ApiSettingsController(
    new SettingsRepository(new MemoryStorage()),
    generation,
    secrets(),
  );
  const config = controller.load().settings.textApi;

  await assert.rejects(() => controller.listTextModels(config, ''), /文本 API 地址不能为空/);
  assert.equal(requestCount, 0);
});

test('connection test validates generation parameters before making a request', async () => {
  let requestCount = 0;
  const generation: TextGenerationPort = {
    listModels: async () => [],
    generate: async () => {
      requestCount += 1;
      return 'OK';
    },
  };
  const controller = new ApiSettingsController(
    new SettingsRepository(new MemoryStorage()),
    generation,
    secrets(),
  );
  const config = controller.load().settings.textApi;
  config.apiUrl = 'https://api.example.com/v1';
  config.model = 'model-a';
  config.maxTokens = 0;

  await assert.rejects(() => controller.testTextConnection(config, ''), /最大输出必须是正整数/);
  assert.equal(requestCount, 0);
});
