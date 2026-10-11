import { CONTENT_MODULES, type ContentModule } from '../domain/index.ts';
import { defaultSettings, type RuntimeSettings } from './model.ts';

export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface ChatSendingStorage {
  read(): unknown;
  write(settings: Pick<RuntimeSettings['sending'], 'mode' | 'enabledModuleIds' | 'selectedGroupIds'>): Promise<void>;
}

const SETTINGS_KEY = 'goblin-achievements.settings.v1';

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

function stringArray(candidate: unknown, fallback: string[]): string[] {
  return Array.isArray(candidate) && candidate.every(entry => typeof entry === 'string') ? [...candidate] : fallback;
}

function moduleArray(candidate: unknown): ContentModule[] {
  return stringArray(candidate, []).filter((entry): entry is ContentModule => CONTENT_MODULES.includes(entry as ContentModule));
}

function recordOfStrings(candidate: unknown): Record<string, string> {
  if (!isRecord(candidate)) return {};
  return Object.fromEntries(Object.entries(candidate).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function stringOr(candidate: unknown, fallback: string): string {
  return typeof candidate === 'string' ? candidate : fallback;
}

function numberOr(candidate: unknown, fallback: number): number {
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
}

function entryBindings(candidate: unknown): RuntimeSettings['worldbooks']['sharedEntries'] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap(entry => {
    if (!isRecord(entry) || typeof entry.worldbookName !== 'string' || !Number.isInteger(entry.entryUid) || Number(entry.entryUid) < 0) return [];
    return [{ worldbookName: entry.worldbookName, entryUid: Number(entry.entryUid) }];
  });
}

function characterBindings(candidate: unknown): RuntimeSettings['worldbooks']['characterEntries'] {
  if (!isRecord(candidate)) return {};
  return Object.fromEntries(Object.entries(candidate).map(([personId, entries]) => [personId, entryBindings(entries)]));
}

function mergePersistedSettings(candidate: unknown): RuntimeSettings {
  const fallback = defaultSettings();
  if (!isRecord(candidate)) return fallback;
  const textApi = isRecord(candidate.textApi) ? candidate.textApi : {};
  const imageApi = isRecord(candidate.imageApi) ? candidate.imageApi : {};
  const sending = isRecord(candidate.sending) ? candidate.sending : {};
  const tagFilter = isRecord(sending.tagFilter) ? sending.tagFilter : {};
  const prompts = isRecord(candidate.prompts) ? candidate.prompts : {};
  const worldbooks = isRecord(candidate.worldbooks) ? candidate.worldbooks : {};

  return {
    ...fallback,
    textApi: {
      source: textApi.source === 'custom' || textApi.source === 'openai' ? textApi.source : fallback.textApi.source,
      apiUrl: stringOr(textApi.apiUrl, fallback.textApi.apiUrl),
      model: stringOr(textApi.model, fallback.textApi.model),
      maxTokens: numberOr(textApi.maxTokens, fallback.textApi.maxTokens),
      temperature: numberOr(textApi.temperature, fallback.textApi.temperature),
    },
    imageApi: {
      source: imageApi.source === 'openai' || imageApi.source === 'openai-compatible'
        ? imageApi.source
        : fallback.imageApi.source,
      apiUrl: stringOr(imageApi.apiUrl, fallback.imageApi.apiUrl),
      model: stringOr(imageApi.model, fallback.imageApi.model),
    },
    worldbooks: {
      keywordBooks: Array.isArray(worldbooks.keywordBooks) ? worldbooks.keywordBooks.flatMap<RuntimeSettings['worldbooks']['keywordBooks'][number]>(book => {
        if (!isRecord(book) || typeof book.worldbookName !== 'string') return [];
        if (book.entryUids === null) return [{ worldbookName: book.worldbookName, entryUids: null }];
        if (!Array.isArray(book.entryUids) || !book.entryUids.every(uid => Number.isInteger(uid) && uid >= 0)) return [];
        return [{ worldbookName: book.worldbookName, entryUids: [...book.entryUids] as number[] }];
      }) : [],
      sharedEntries: entryBindings(worldbooks.sharedEntries),
      characterEntries: characterBindings(worldbooks.characterEntries),
    },
    prompts: {
      taskPrompt: stringOr(prompts.taskPrompt, stringOr(prompts.publicPrompt, fallback.prompts.taskPrompt)),
      reasoningPrompt: stringOr(prompts.reasoningPrompt, fallback.prompts.reasoningPrompt),
      modulePrompts: recordOfStrings(prompts.modulePrompts),
    },
    sending: {
      mode: sending.mode === 'automatic' || sending.mode === 'manual' ? sending.mode : fallback.sending.mode,
      autoEveryRounds: numberOr(sending.autoEveryRounds, fallback.sending.autoEveryRounds),
      bodyRounds: numberOr(sending.bodyRounds, fallback.sending.bodyRounds),
      enabledModuleIds: moduleArray(sending.enabledModuleIds),
      selectedGroupIds: stringArray(sending.selectedGroupIds, []),
      tagFilter: {
        extractPattern: stringOr(tagFilter.extractPattern, fallback.sending.tagFilter.extractPattern),
        removePatterns: stringArray(tagFilter.removePatterns, fallback.sending.tagFilter.removePatterns),
      },
    },
  };
}

function parseJson(source: string | null): unknown {
  if (source === null) return undefined;
  try {
    return JSON.parse(source);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export class SettingsRepository {
  private readonly settingsStorage: StringStorage;
  private readonly chatSendingStorage: ChatSendingStorage | undefined;
  private readonly coordinateWrite: ((write: () => Promise<void>) => Promise<void>) | undefined;

  constructor(
    settingsStorage: StringStorage,
    chatSendingStorage?: ChatSendingStorage,
    coordinateWrite?: (write: () => Promise<void>) => Promise<void>,
  ) {
    this.settingsStorage = settingsStorage;
    this.chatSendingStorage = chatSendingStorage;
    this.coordinateWrite = coordinateWrite;
  }

  load(): RuntimeSettings {
    const settings = mergePersistedSettings(parseJson(this.settingsStorage.getItem(SETTINGS_KEY)));
    if (!this.chatSendingStorage) return settings;
    const chat = this.chatSendingStorage.read();
    const record = isRecord(chat) ? chat : {};
    settings.sending.mode = record.mode === 'automatic' || record.mode === 'manual' ? record.mode : 'manual';
    settings.sending.enabledModuleIds = moduleArray(record.enabledModuleIds);
    settings.sending.selectedGroupIds = stringArray(record.selectedGroupIds, []);
    return settings;
  }

  async save(settings: RuntimeSettings): Promise<void> {
    const intent = structuredClone(settings);
    const write = () => this.write(intent);
    if (this.coordinateWrite) await this.coordinateWrite(write);
    else await write();
  }

  private async write(settings: RuntimeSettings): Promise<void> {
    const accountSettings = structuredClone(settings);
    if (this.chatSendingStorage) {
      accountSettings.sending.mode = 'manual';
      accountSettings.sending.enabledModuleIds = [];
      accountSettings.sending.selectedGroupIds = [];
    }
    const previous = this.settingsStorage.getItem(SETTINGS_KEY);
    this.settingsStorage.setItem(SETTINGS_KEY, JSON.stringify(accountSettings));
    try {
      await this.chatSendingStorage?.write({
        mode: settings.sending.mode,
        enabledModuleIds: [...settings.sending.enabledModuleIds],
        selectedGroupIds: [...settings.sending.selectedGroupIds],
      });
    } catch (error) {
      if (previous !== null) this.settingsStorage.setItem(SETTINGS_KEY, previous);
      else if (this.settingsStorage.removeItem) this.settingsStorage.removeItem(SETTINGS_KEY);
      else this.settingsStorage.setItem(SETTINGS_KEY, 'null');
      throw error;
    }
  }
}
