import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBoundWorldbookContext, matchesWorldbookEntry } from '../src/prompting/worldbook-context.ts';
import type { WorldbookEntry, WorldbookPort } from '../src/runtime/ports.ts';

const defaults = { caseSensitive: false, matchWholeWords: true };
const entry: WorldbookEntry = { uid: 7, name: 'irrelevant', content: '人设', strategy: 'selective', keys: ['/demo/i'] };

test('green-light matching keeps regex, overrides and all four secondary rules', () => {
  assert.equal(matchesWorldbookEntry('DEMO at cathedral', entry, defaults), true);
  assert.equal(matchesWorldbookEntry('cathedral', { ...entry, keys: ['cat'] }, defaults), false);
  assert.equal(matchesWorldbookEntry('cathedral', { ...entry, keys: ['cat'], matchWholeWords: false }, defaults), true);
  assert.equal(matchesWorldbookEntry('demo', { ...entry, keys: ['Demo'], caseSensitive: true }, defaults), false);
  const match = (logic: NonNullable<WorldbookEntry['secondaryKeys']>['logic']) => matchesWorldbookEntry('Demo clock', {
    ...entry, secondaryKeys: { logic, keys: ['clock', 'tower'] },
  }, defaults);
  assert.deepEqual(['and_any', 'and_all', 'not_any', 'not_all'].map(logic => match(logic as Parameters<typeof match>[0])), [true, false, false, true]);
  assert.equal(matchesWorldbookEntry('Demo', { ...entry, enabled: false }, defaults), false);
  assert.equal(matchesWorldbookEntry('Demo', { ...entry, strategy: 'constant' }, defaults), false);
});

test('no user input skips persona reads; shared background is explicit and deduplicated', async () => {
  let reads = 0;
  const worldbooks: WorldbookPort = { names: () => ['book'], entries: async () => { reads++; return [entry]; } };
  const bindings = { keywordBooks: [{ worldbookName: 'book', entryUids: null }], sharedEntries: [], characterEntries: {} };
  assert.deepEqual(await loadBoundWorldbookContext(worldbooks, bindings, [{ id: 1, role: 'assistant', text: 'Demo' }], defaults), []);
  assert.equal(reads, 0);
  const selected = await loadBoundWorldbookContext(worldbooks, {
    ...bindings, sharedEntries: [{ worldbookName: 'book', entryUid: 7 }],
  }, [{ id: 0, role: 'user', text: 'Demo' }], defaults);
  assert.equal(selected.length, 1);
  assert.equal(reads, 1);
});
