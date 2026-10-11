import {
  applyPlayerCommand,
  buildPlayerView,
  type AchievementPlayerView,
  type ContentCatalog,
  type PlayerCommand,
} from '../domain/index.ts';
import { AchievementMetadataRepository } from './metadata.ts';

export class AchievementPlayerController {
  private readonly catalog: ContentCatalog;
  private readonly metadata: AchievementMetadataRepository;

  constructor(
    catalog: ContentCatalog,
    metadata: AchievementMetadataRepository,
  ) {
    this.catalog = catalog;
    this.metadata = metadata;
  }

  view(): AchievementPlayerView {
    return buildPlayerView(this.catalog, this.metadata.load());
  }

  async dispatch(command: PlayerCommand): Promise<AchievementPlayerView> {
    const intent = structuredClone(command);
    return this.metadata.commit(save => {
      const next = applyPlayerCommand(this.catalog, save, intent);
      return { save: next, result: buildPlayerView(this.catalog, next) };
    });
  }
}
