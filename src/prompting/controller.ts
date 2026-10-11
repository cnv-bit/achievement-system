import type { ContentModule } from '../domain/index.ts';
import { AchievementRuntime, type RuntimePreview, type RuntimeRunResult } from '../runtime/achievement-runtime.ts';
import { validateSettings, type RuntimeSettings } from '../settings/model.ts';
import { SettingsRepository } from '../settings/storage.ts';
import type { PromptingPort } from './ports.ts';

export class PromptingController implements PromptingPort {
  private readonly repository: SettingsRepository;
  private readonly runtime: AchievementRuntime;

  constructor(repository: SettingsRepository, runtime: AchievementRuntime) {
    this.repository = repository;
    this.runtime = runtime;
  }

  load(): RuntimeSettings {
    return this.repository.load();
  }

  async save(settings: RuntimeSettings, currentChapterId?: string): Promise<void> {
    const next = this.repository.load();
    next.prompts = structuredClone(settings.prompts);
    next.sending = structuredClone(settings.sending);
    const errors = validateSettings(next);
    if (errors.length > 0) throw new Error(errors.join('\n'));
    if (currentChapterId) await this.runtime.setCurrentChapter(currentChapterId);
    await this.repository.save(next);
  }

  async sendManual(startFloor: number, endFloor: number, moduleIds: ContentModule[]): Promise<RuntimeRunResult> {
    return this.runtime.runManual({ startFloor, endFloor, moduleIds });
  }

  previewManual(startFloor: number, endFloor: number): Promise<RuntimePreview> {
    return this.runtime.previewManual({ startFloor, endFloor });
  }

  sendPreview(previewId: string): Promise<RuntimeRunResult> {
    return this.runtime.sendPreview(previewId);
  }

  latestMessageId(): number {
    return this.runtime.latestMessageId();
  }

  modelGroups() { return this.runtime.modelGroups(); }
  chapters() { return this.runtime.chapters(); }
  currentChapterId() { return this.runtime.currentChapterId(); }
}
