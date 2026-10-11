import type { AchievementPlayerView, PlayerCommand } from '../domain/index.ts';

export interface PlayerUseCases {
  getPlayerView(): AchievementPlayerView;
  dispatchPlayerCommand(command: PlayerCommand): Promise<AchievementPlayerView>;
}
