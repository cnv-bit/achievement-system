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
    const next = applyPlayerCommand(this.catalog, this.metadata.load(), command);
    await this.metadata.save(next);
    return buildPlayerView(this.catalog, next);
  }
}
