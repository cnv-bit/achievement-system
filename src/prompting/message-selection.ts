import type { RuntimeChatMessage } from '../runtime/ports.ts';

export interface TagFilterConfig {
  extractPattern: string;
  removePatterns: string[];
}

export interface SelectedAssistantBody {
  turnIndex: number;
  assistant: RuntimeChatMessage;
}

export interface FloorSelection {
  startFloor: number;
  endFloor: number;
  maxRounds?: number;
}

export interface KeywordMatchOptions {
  caseSensitive: boolean;
  matchWholeWords: boolean;
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function filterAssistantBody(text: string, config: TagFilterConfig): string {
  if (!config.extractPattern.trim()) return '';
  const extraction = new RegExp(config.extractPattern, 'gis');
  const matches = [...text.matchAll(extraction)];
  if (matches.some(match => match[1] === undefined)) {
    throw new Error('正文提取正则必须用第一个捕获组标出要发送的正文。');
  }
  return config.removePatterns.reduce((body, pattern) => (
    pattern.trim() ? body.replace(new RegExp(pattern, 'gis'), '') : body
  ), matches.map(match => match[1]).join('\n')).trim();
}

export function selectAssistantBodies(
  messages: RuntimeChatMessage[],
  selection: FloorSelection,
): SelectedAssistantBody[] {
  const bodies: SelectedAssistantBody[] = [];
  let turnIndex = 0;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (message.id >= selection.startFloor && message.id <= selection.endFloor) {
      bodies.push({ turnIndex, assistant: message });
    }
    turnIndex += 1;
  }
  return selection.maxRounds === undefined ? bodies : bodies.slice(-selection.maxRounds);
}

function parseRegexFromString(source: string): RegExp | undefined {
  // ST world-info.js parseRegexFromString; its pure matcher is not exported.
  const match = source.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (!match || /(^|[^\\])\//.test(match[1] ?? '')) return undefined;
  try {
    return new RegExp((match[1] ?? '').replace('\\/', '/'), match[2]);
  } catch {
    return undefined;
  }
}

export function matchesWorldbookKey(text: string, key: string, options: KeywordMatchOptions): boolean {
  const regex = parseRegexFromString(key);
  if (regex) {
    regex.lastIndex = 0;
    return regex.test(text);
  }
  const haystack = options.caseSensitive ? text : text.toLowerCase();
  const needle = options.caseSensitive ? key.trim() : key.trim().toLowerCase();
  if (!needle) return false;
  if (!options.matchWholeWords || /\s/.test(needle)) return haystack.includes(needle);
  return new RegExp(`(?:^|\\W)(${escapeRegExp(needle)})(?:$|\\W)`).test(haystack);
}

export function selectUserMessages(messages: RuntimeChatMessage[], selection: FloorSelection): RuntimeChatMessage[] {
  return messages.filter(message => message.role === 'user' && message.id >= selection.startFloor && message.id <= selection.endFloor);
}
