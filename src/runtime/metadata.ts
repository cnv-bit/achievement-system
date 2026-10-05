import {
  emptyAchievementSave,
  loadAchievementSave,
  validateAchievementSave,
  type AchievementSave,
  type ContentCatalog,
} from '../domain/index.ts';
import type { AchievementMetadataPort } from './ports.ts';

function isEmptyMetadata(candidate: unknown): boolean {
  return candidate === undefined
    || candidate === null
    || (typeof candidate === 'object' && !Array.isArray(candidate) && Object.keys(candidate).length === 0);
}

export class AchievementMetadataRepository {
  private readonly port: AchievementMetadataPort;
  private readonly catalog: ContentCatalog | undefined;

  constructor(port: AchievementMetadataPort, catalog?: ContentCatalog) {
    this.port = port;
    this.catalog = catalog;
  }

  load(): AchievementSave {
    const stored = this.port.read();
    if (isEmptyMetadata(stored)) return structuredClone(emptyAchievementSave);
    const validated = loadAchievementSave(stored, this.catalog);
    if (!validated.ok) {
      const details = validated.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ');
      throw new Error(`当前聊天的成就存档无效：${details}`);
    }
    return structuredClone(validated.value);
  }

  async save(nextState: AchievementSave): Promise<void> {
    const validated = validateAchievementSave(nextState);
    if (!validated.ok) throw new Error('拒绝写入无效的成就存档。');
    await this.port.write(structuredClone(validated.value) as unknown as Record<string, unknown>);
  }
}
