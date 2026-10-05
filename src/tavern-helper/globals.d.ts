interface TavernChatMessage {
  message_id: number;
  role: 'assistant' | 'system' | 'user';
  message: string;
}

declare function getChatMessages(range: string | number, options?: { include_swipes?: false }): TavernChatMessage[];
declare function getWorldbookNames(): string[];
declare const tavern_events: {
  MESSAGE_RECEIVED: 'message_received';
  CHAT_CHANGED: 'chat_id_changed';
};
declare function eventOn(event: string, listener: (...args: never[]) => void): { stop(): void };
declare function getButtonEvent(buttonName: string): string;
declare function replaceScriptButtons(buttons: Array<{ name: string; visible: boolean }>): void;
declare const __GOBLIN_JOURNAL_CSS__: string;

declare const SillyTavern: {
  loadWorldInfo(name: string): Promise<{ entries: Record<string, {
    uid: number; comment: string; content: string; disable?: boolean; constant?: boolean; vectorized?: boolean;
    key?: string[]; keysecondary?: string[]; selective?: boolean; selectiveLogic?: number;
    caseSensitive?: boolean | null; matchWholeWords?: boolean | null; order?: number;
  }> } | null>;
  substituteParams(text: string): string;
  getRequestHeaders(): Record<string, string>;
  accountStorage: Storage;
  chatMetadata: Record<string, unknown>;
  getCurrentChatId(): string;
  updateChatMetadata(values: Record<string, unknown>, reset: boolean): void;
  saveMetadata(): Promise<void>;
};

declare const Mvu: {
  getMvuData(options: { type: 'message'; message_id: number | 'latest' }): { stat_data: Record<string, unknown> };
};

interface Window {
  toastr: import('../notifications.ts').TavernToastr;
  GoblinAchievementsPlugin?: unknown;
  GOBLIN_ACHIEVEMENTS_CATALOG?: unknown;
  GOBLIN_ACHIEVEMENTS_LAYOUTS?: unknown;
  /** Host-verified existing files only: full filename -> browser-loadable URL. */
  GOBLIN_ACHIEVEMENTS_IMAGES?: Record<string, string>;
  GOBLIN_ACHIEVEMENTS_MODEL_CONTEXT?: import('../runtime/model-context.ts').ModelContextReader;
}
