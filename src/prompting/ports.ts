import type { ChapterDefinition } from '../domain/types.ts';
import type { RuntimePreview, RuntimeRunResult } from '../runtime/achievement-runtime.ts';
import type { ModelGroupOption } from '../runtime/model-context.ts';
import type { RuntimeSettings } from '../settings/model.ts';

export interface PromptingPort {
  load(): RuntimeSettings;
  save(settings: RuntimeSettings, currentChapterId?: string): Promise<void>;
  previewManual(startFloor: number, endFloor: number): Promise<RuntimePreview>;
  sendPreview(previewId: string): Promise<RuntimeRunResult>;
  latestMessageId(): number;
  modelGroups(): ModelGroupOption[];
  chapters(): ChapterDefinition[];
  currentChapterId(): string | undefined;
}
