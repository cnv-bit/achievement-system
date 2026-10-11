import type { JsonValue } from '../domain/index.ts';
import { requestBackend } from '../settings/backend.ts';
import type {
  AchievementMetadataPort,
  ChatContextPort,
  ImageConnectionPort,
  RuntimeChatMessage,
  TextGenerationPort,
  VariableContextPort,
  WorldbookPort,
  WorldbookEntry,
} from '../runtime/ports.ts';
import type { ChatSendingStorage } from '../settings/storage.ts';

export class TavernChatContext implements ChatContextPort {
  currentChatId(): string {
    const chatId = SillyTavern.getCurrentChatId();
    if (typeof chatId !== 'string' || !chatId.trim()) throw new Error('请先打开一个聊天存档。');
    return chatId;
  }

  messages(startFloor: number, endFloor: number): RuntimeChatMessage[] {
    return getChatMessages(`${startFloor}-${endFloor}`, { include_swipes: false }).map(message => ({
      id: message.message_id,
      role: message.role,
      text: message.message,
    }));
  }

  latestMessageId(): number {
    return getChatMessages(-1, { include_swipes: false })[0]?.message_id ?? 0;
  }

  keywordMatchOptions(): { caseSensitive: boolean; matchWholeWords: boolean } {
    const doc = window.parent.document;
    return {
      caseSensitive: doc.querySelector<HTMLInputElement>('#world_info_case_sensitive')?.checked ?? false,
      matchWholeWords: doc.querySelector<HTMLInputElement>('#world_info_match_whole_words')?.checked ?? false,
    };
  }

  onAssistantMessage(listener: (messageId: number) => void): () => void {
    const subscription = eventOn(tavern_events.MESSAGE_RECEIVED, (messageId: number) => listener(messageId));
    return () => subscription.stop();
  }

  onChatChanged(listener: () => void): () => void {
    const subscription = eventOn(tavern_events.CHAT_CHANGED, () => listener());
    return () => subscription.stop();
  }
}

async function writeChatMetadataField(key: string, value: unknown): Promise<void> {
  const chatId = SillyTavern.getCurrentChatId();
  if (typeof chatId !== 'string' || !chatId.trim()) throw new Error('请先打开一个聊天存档，未写入元数据。');
  const hadField = Object.hasOwn(SillyTavern.chatMetadata, key);
  const previous = structuredClone(SillyTavern.chatMetadata[key]);
  SillyTavern.updateChatMetadata({ [key]: structuredClone(value) }, false);
  const target = SillyTavern.chatMetadata;
  try {
    await SillyTavern.saveMetadata();
  } catch (error) {
    // Restore only this failed field on the original metadata object, never a newly selected chat.
    if (hadField) target[key] = previous;
    else delete target[key];
    throw error;
  }
  if (chatId !== SillyTavern.getCurrentChatId()) throw new Error('保存期间切换了聊天，请返回原聊天查看保存结果。');
}

export class TavernAchievementMetadata implements AchievementMetadataPort {
  read(): unknown {
    return SillyTavern.chatMetadata.goblin_achievements;
  }

  async write(nextState: Record<string, unknown>): Promise<void> {
    await writeChatMetadataField('goblin_achievements', nextState);
  }
}

export class TavernChatSendingStorage implements ChatSendingStorage {
  read(): unknown {
    return SillyTavern.chatMetadata.goblin_achievements_sending;
  }

  async write(settings: Parameters<ChatSendingStorage['write']>[0]): Promise<void> {
    await writeChatMetadataField('goblin_achievements_sending', settings);
  }
}

export class TavernTextGeneration implements TextGenerationPort {
  async generate(request: Parameters<TextGenerationPort['generate']>[0]): Promise<string> {
    const generated = await requestBackend('generate', request) as {
      content?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
      error?: unknown;
    };
    if (generated.error) throw new Error('API 请求失败，请稍后重试或检查连接配置。');
    const content = generated.choices?.[0]?.message?.content ?? generated.content;
    if (typeof content !== 'string') throw new Error('模型返回格式无效。');
    return content;
  }

  async listModels(connection: Parameters<TextGenerationPort['listModels']>[0]): Promise<string[]> {
    const result = await requestBackend('models', { connection }) as {
      data?: unknown;
      models?: unknown;
      error?: unknown;
    };
    if (result.error) throw new Error('API 请求失败，请稍后重试或检查连接配置。');
    const raw = Array.isArray(result) ? result : (Array.isArray(result.data) ? result.data : result.models);
    if (!Array.isArray(raw)) throw new Error('模型列表格式无效。');
    return raw.map(item => typeof item === 'string' ? item : (item as { id?: unknown })?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
}

export class TavernWorldbooks implements WorldbookPort {
  names(): string[] {
    return getWorldbookNames();
  }

  async entries(worldbookName: string) {
    // Native reader preserves per-entry matching overrides omitted by getWorldbook.
    const book = await SillyTavern.loadWorldInfo(worldbookName);
    if (!book?.entries) throw new Error(`世界书读取失败：${worldbookName}`);
    const logic = ['and_any', 'not_all', 'not_any', 'and_all'] as const;
    return Object.values(book.entries).map((entry): WorldbookEntry => ({
      uid: entry.uid,
      name: entry.comment || `条目 #${entry.uid}`,
      content: SillyTavern.substituteParams(entry.content),
      enabled: !entry.disable,
      strategy: entry.constant ? 'constant' : entry.vectorized ? 'vectorized' : 'selective',
      keys: (entry.key ?? []).map(key => SillyTavern.substituteParams(key)),
      secondaryKeys: {
        logic: logic[entry.selectiveLogic ?? 0] ?? 'and_any',
        keys: entry.selective === false ? [] : (entry.keysecondary ?? []).map(key => SillyTavern.substituteParams(key)),
      },
      caseSensitive: entry.caseSensitive ?? null,
      matchWholeWords: entry.matchWholeWords ?? null,
      order: entry.order ?? 0,
    }));
  }
}

export class MvuVariableContext implements VariableContextPort {
  read(messageId: number): Record<string, JsonValue> {
    if (typeof Mvu === 'undefined') return {};
    const serialized = JSON.stringify(Mvu.getMvuData({ type: 'message', message_id: messageId }).stat_data);
    return JSON.parse(serialized) as Record<string, JsonValue>;
  }
}

export class OpenAiImageConnection implements ImageConnectionPort {
  async test(connection: Parameters<ImageConnectionPort['test']>[0]): Promise<void> {
    await requestBackend('models', { connection, slot: 'image' });
  }
}
