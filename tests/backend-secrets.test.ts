import assert from 'node:assert/strict';
import test from 'node:test';
import { BackendSecrets } from '../src/settings/backend.ts';
import { defaultSettings } from '../src/settings/model.ts';

test('legacy secrets are removed only after a confirmed backend save; nothing writes new browser secrets', async () => {
  let raw: string | null = JSON.stringify({ textApiKey: 'migration-test-key', imageApiKey: '' });
  const legacy = { getItem: () => raw, removeItem: () => { raw = null; } };
  const settings = defaultSettings();
  settings.textApi.apiUrl = 'https://api.example.com/v1';
  const failed = new BackendSecrets(async () => { throw new Error('offline'); }, legacy);
  await assert.rejects(() => failed.initialize(settings), /offline/);
  assert.ok(raw);
  const invalid = new BackendSecrets(async () => ({ hasTextApiKey: false, hasImageApiKey: false }), legacy);
  await assert.rejects(() => invalid.initialize(settings), /未确认/);
  assert.ok(raw);
  let count = 0;
  const ready = new BackendSecrets(async (route, body) => {
    count++;
    if (count === 1) {
      assert.equal(route, 'save');
      assert.equal((body as { text: { key: string } }).text.key, 'migration-test-key');
      assert.ok(raw, 'must not remove before backend confirmation');
    } else assert.equal(route, 'state');
    return { hasTextApiKey: true, hasImageApiKey: false };
  }, legacy);
  assert.deepEqual(await ready.initialize(settings), { hasTextApiKey: true, hasImageApiKey: false });
  assert.equal(raw, null);
  await ready.initialize(settings);
});
