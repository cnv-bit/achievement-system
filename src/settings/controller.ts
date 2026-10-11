import type { TextGenerationPort, TextGenerationRequest, WorldbookPort } from '../runtime/ports.ts';
import {
  isHttpUrl,
  isTextApiConfigured,
  validateSettings,
  type RuntimeSettings,
  type TextApiConfig,
  type WorldbookBindings,
} from './model.ts';
import { SettingsRepository } from './storage.ts';
import type { ApiSettingsPort, SecretsPort, SettingsSnapshot } from './ports.ts';

export type { SettingsSnapshot } from './ports.ts';

function textConnection(config: TextApiConfig, apiKey: string): TextGenerationRequest['connection'] {
  return {
    source: config.source,
    apiUrl: config.apiUrl,
    apiKey,
    model: config.model,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  };
}

export class ApiSettingsController implements ApiSettingsPort {
  private readonly repository: SettingsRepository;
  private readonly generation: TextGenerationPort;
  private readonly secrets: SecretsPort;
  private readonly worldbooks: WorldbookPort | undefined;
  private hasTextApiKey = false;

  constructor(
    repository: SettingsRepository,
    generation: TextGenerationPort,
    secrets: SecretsPort,
    worldbooks?: WorldbookPort,
  ) {
    this.repository = repository;
    this.generation = generation;
    this.secrets = secrets;
    this.worldbooks = worldbooks;
  }

  load(): SettingsSnapshot {
    return { settings: this.repository.load(), hasTextApiKey: this.hasTextApiKey };
  }

  async initialize(): Promise<void> {
    const state = await this.secrets.initialize(this.repository.load());
    this.hasTextApiKey = state.hasTextApiKey;
  }

  async save(settings: RuntimeSettings, key: string): Promise<void> {
    const next = this.repository.load();
    next.textApi = structuredClone(settings.textApi);
    const errors = validateSettings(next);
    if (errors.length > 0) throw new Error(errors.join('\n'));
    const state = await this.secrets.save(next, key);
    this.hasTextApiKey = state.hasTextApiKey;
    await this.repository.save(next);
  }

  worldbookNames(): string[] { return this.worldbooks?.names() ?? []; }

  worldbookEntries(name: string) {
    if (!this.worldbooks) throw new Error('世界书读取接口未接入。');
    return this.worldbooks.entries(name);
  }

  async saveWorldbooks(bindings: WorldbookBindings): Promise<void> {
    const settings = this.repository.load();
    settings.worldbooks = structuredClone(bindings);
    await this.repository.save(settings);
  }

  async listTextModels(config: TextApiConfig, apiKey: string): Promise<string[]> {
    if (!config.apiUrl.trim()) throw new Error('文本 API 地址不能为空。');
    if (!isHttpUrl(config.apiUrl)) throw new Error('文本 API 地址必须使用 http 或 https。');
    return this.generation.listModels(textConnection(config, apiKey));
  }

  async testTextConnection(config: TextApiConfig, apiKey: string): Promise<void> {
    const settings = this.repository.load();
    settings.textApi = structuredClone(config);
    const errors = validateSettings(settings);
    if (errors.length > 0) throw new Error(errors.join('\n'));
    if (!isTextApiConfigured(settings)) throw new Error('文本 API 地址和模型不能为空。');
    const reply = await this.generation.generate({
      generationId: `goblin-connection-test-${Date.now()}`,
      prompts: [{ role: 'user', content: '只回复 OK' }],
      connection: textConnection(config, apiKey),
    });
    if (reply.trim().length === 0) throw new Error('文本 API 返回了空响应。');
  }

}
