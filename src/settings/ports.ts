import type { WorldbookEntry } from '../runtime/ports.ts';
import type { RuntimeSettings, TextApiConfig, WorldbookBindings } from './model.ts';

export interface SecretState { hasTextApiKey: boolean; hasImageApiKey: boolean }

export interface SecretsPort {
  initialize(settings: RuntimeSettings): Promise<SecretState>;
  save(settings: RuntimeSettings, key: string): Promise<SecretState>;
}

export interface SettingsSnapshot {
  settings: RuntimeSettings;
  hasTextApiKey: boolean;
}

export interface ApiSettingsPort {
  load(): SettingsSnapshot;
  initialize(): Promise<void>;
  save(settings: RuntimeSettings, key: string): Promise<void>;
  listTextModels(config: TextApiConfig, apiKey: string): Promise<string[]>;
  testTextConnection(config: TextApiConfig, apiKey: string): Promise<void>;
  worldbookNames(): string[];
  worldbookEntries(name: string): Promise<WorldbookEntry[]>;
  saveWorldbooks(bindings: WorldbookBindings): Promise<void>;
}
