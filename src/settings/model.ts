import type { TagFilterConfig } from '../prompting/message-selection.ts';
import type { ContentModule } from '../domain/index.ts';

export interface TextApiConfig {
  source: 'custom' | 'openai';
  apiUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface ImageApiConfig {
  source: 'openai' | 'openai-compatible';
  apiUrl: string;
  model: string;
}

export interface EntryBinding {
  worldbookName: string;
  entryUid: number;
}

export interface WorldbookBindings {
  /** null means all enabled green-light entries in this book. */
  keywordBooks: Array<{ worldbookName: string; entryUids: number[] | null }>;
  sharedEntries: EntryBinding[];
  /** Preserve old bindings without using person IDs to activate persona entries. */
  characterEntries: Record<string, EntryBinding[]>;
}

export interface PromptSettings {
  taskPrompt: string;
  reasoningPrompt: string;
  modulePrompts: Partial<Record<ContentModule, string>>;
}

export interface SendingSettings {
  mode: 'automatic' | 'manual';
  autoEveryRounds: number;
  bodyRounds: number;
  enabledModuleIds: ContentModule[];
  selectedGroupIds: string[];
  tagFilter: TagFilterConfig;
}

export interface RuntimeSettings {
  version: 1;
  textApi: TextApiConfig;
  imageApi: ImageApiConfig;
  worldbooks: WorldbookBindings;
  prompts: PromptSettings;
  sending: SendingSettings;
}

export function defaultSettings(): RuntimeSettings {
  return {
    version: 1,
    textApi: { source: 'openai', apiUrl: '', model: '', maxTokens: 4096, temperature: 0.2 },
    imageApi: { source: 'openai-compatible', apiUrl: '', model: '' },
    worldbooks: { keywordBooks: [], sharedEntries: [], characterEntries: {} },
    prompts: {
      taskPrompt: '',
      reasoningPrompt: '',
      modulePrompts: {},
    },
    sending: {
      mode: 'manual',
      autoEveryRounds: 1,
      bodyRounds: 4,
      enabledModuleIds: [],
      selectedGroupIds: [],
      tagFilter: { extractPattern: '', removePatterns: [] },
    },
  };
}

export function isHttpUrl(address: string): boolean {
  try {
    const protocol = new URL(address).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isPositiveInteger(number: number): boolean {
  return Number.isInteger(number) && number > 0;
}

export function validateSettings(settings: RuntimeSettings): string[] {
  const errors: string[] = [];
  if (settings.textApi.source !== 'openai' && settings.textApi.source !== 'custom') {
    errors.push('文本 API 来源无效。');
  }
  if (settings.imageApi.source !== 'openai' && settings.imageApi.source !== 'openai-compatible') {
    errors.push('生图 API 来源无效。');
  }
  if (settings.textApi.apiUrl && !isHttpUrl(settings.textApi.apiUrl)) {
    errors.push('文本 API 地址必须使用 http 或 https。');
  }
  if (settings.imageApi.apiUrl && !isHttpUrl(settings.imageApi.apiUrl)) {
    errors.push('生图 API 地址必须使用 http 或 https。');
  }
  if (!isPositiveInteger(settings.textApi.maxTokens)) {
    errors.push('文本 API 最大输出必须是正整数。');
  }
  if (!Number.isFinite(settings.textApi.temperature) || settings.textApi.temperature < 0 || settings.textApi.temperature > 2) {
    errors.push('文本 API 温度必须在 0 到 2 之间。');
  }
  if (!isPositiveInteger(settings.sending.autoEveryRounds)) {
    errors.push('自动发送间隔必须是正整数。');
  }
  if (!isPositiveInteger(settings.sending.bodyRounds)) {
    errors.push('正文轮数必须是正整数。');
  }
  const filterPatterns = [settings.sending.tagFilter.extractPattern, ...settings.sending.tagFilter.removePatterns]
    .filter(pattern => pattern.trim().length > 0);
  for (const pattern of filterPatterns) {
    try {
      new RegExp(pattern);
    } catch {
      errors.push(`正文清洗正则无效：${pattern}`);
    }
  }
  return errors;
}

export function isTextApiConfigured(settings: RuntimeSettings): boolean {
  return isHttpUrl(settings.textApi.apiUrl) && settings.textApi.model.trim().length > 0;
}
