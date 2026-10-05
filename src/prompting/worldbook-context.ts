import type { WorldbookBindings } from '../settings/model.ts';
import type { RuntimeChatMessage, WorldbookEntry, WorldbookPort } from '../runtime/ports.ts';
import { matchesWorldbookKey, type KeywordMatchOptions } from './message-selection.ts';

export interface BoundWorldbookEntry extends WorldbookEntry {
  worldbookName: string;
  entryUid: number;
}

export function matchesWorldbookEntry(text: string, entry: WorldbookEntry, defaults: KeywordMatchOptions): boolean {
  if (entry.enabled === false || entry.strategy !== 'selective') return false;
  const options = {
    caseSensitive: entry.caseSensitive ?? defaults.caseSensitive,
    matchWholeWords: entry.matchWholeWords ?? defaults.matchWholeWords,
  };
  const match = (key: string) => matchesWorldbookKey(text, key.trim(), options);
  if (!entry.keys?.some(match)) return false;
  const secondary = entry.secondaryKeys;
  if (!secondary?.keys.length) return true;
  switch (secondary.logic) {
    case 'and_any': return secondary.keys.some(match);
    case 'and_all': return secondary.keys.every(match);
    case 'not_any': return !secondary.keys.some(match);
    case 'not_all': return !secondary.keys.every(match);
  }
}

export async function loadBoundWorldbookContext(
  worldbooks: WorldbookPort,
  bindings: WorldbookBindings,
  userMessages: RuntimeChatMessage[],
  options: KeywordMatchOptions,
): Promise<BoundWorldbookEntry[]> {
  // The selected range is the scan buffer; never add assistant text or recursive content.
  const users = userMessages.filter(message => message.role === 'user');
  const text = users.map(message => message.text).join('\n\u0001');
  const keywordBooks = users.length ? bindings.keywordBooks : [];
  const bookNames = new Set([...bindings.sharedEntries.map(entry => entry.worldbookName), ...keywordBooks.map(book => book.worldbookName)]);
  const selected = new Map<string, BoundWorldbookEntry>();
  for (const name of bookNames) {
    const entries = await worldbooks.entries(name);
    const add = (entry: WorldbookEntry) => {
      if (entry.enabled !== false) selected.set(`${name}\u0000${entry.uid}`, { ...entry, worldbookName: name, entryUid: entry.uid });
    };
    for (const binding of bindings.sharedEntries.filter(binding => binding.worldbookName === name)) {
      const entry = entries.find(entry => entry.uid === binding.entryUid);
      if (!entry) throw new Error(`世界书条目不存在：${name} #${binding.entryUid}`);
      add(entry);
    }
    const book = keywordBooks.find(book => book.worldbookName === name);
    if (!book) continue;
    for (const uid of book.entryUids ?? []) {
      if (!entries.some(entry => entry.uid === uid)) throw new Error(`世界书条目不存在：${name} #${uid}`);
    }
    for (const entry of entries) {
      if ((book.entryUids === null || book.entryUids.includes(entry.uid)) && matchesWorldbookEntry(text, entry, options)) add(entry);
    }
  }
  return [...selected.values()].sort((left, right) => (right.order ?? 0) - (left.order ?? 0));
}
