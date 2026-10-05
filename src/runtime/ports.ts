export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface RuntimeChatMessage {
  id: number;
  role: 'assistant' | 'system' | 'user';
  text: string;
}

export interface ChatContextPort {
  currentChatId(): string;
  messages(startFloor: number, endFloor: number): RuntimeChatMessage[];
  latestMessageId(): number;
  keywordMatchOptions(): { caseSensitive: boolean; matchWholeWords: boolean };
  onAssistantMessage(listener: (messageId: number) => void): () => void;
  onChatChanged(listener: () => void): () => void;
}

export interface AchievementMetadataPort {
  read(): unknown;
  write(nextState: Record<string, unknown>): Promise<void>;
}

export interface TextGenerationRequest {
  generationId: string;
  prompts: Array<{ role: 'assistant' | 'system' | 'user'; content: string }>;
  connection: {
    source: 'custom' | 'openai';
    apiUrl: string;
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
  };
}

export interface TextGenerationPort {
  generate(request: TextGenerationRequest): Promise<string>;
  listModels(connection: TextGenerationRequest['connection']): Promise<string[]>;
}

export interface VariableContextPort {
  read(messageId: number): Record<string, JsonValue>;
}

export interface ImageConnectionPort {
  test(connection: {
    source: 'openai' | 'openai-compatible';
    apiUrl: string;
    apiKey: string;
    model: string;
  }): Promise<void>;
}

export interface WorldbookEntry {
  uid: number;
  name: string;
  content: string;
  enabled?: boolean;
  strategy?: 'constant' | 'selective' | 'vectorized';
  keys?: string[];
  secondaryKeys?: { logic: 'and_any' | 'and_all' | 'not_all' | 'not_any'; keys: string[] };
  caseSensitive?: boolean | null;
  matchWholeWords?: boolean | null;
  order?: number;
}

export interface WorldbookPort {
  names(): string[];
  entries(worldbookName: string): Promise<WorldbookEntry[]>;
}
