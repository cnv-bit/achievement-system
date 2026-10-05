import {
  validateContentCatalog,
  validateContentLayouts,
  type AchievementPlayerView,
  type ContentCatalog,
  type ContentModule,
  type ContentLayouts,
  type PlayerCommand,
} from '../domain/index.ts';
import { buildJournalScene, type ImageResolver } from '../frontend/view-scene.ts';
import type { JournalScene } from '../frontend/journal-port.ts';
import { PromptingController } from '../prompting/controller.ts';
import { mountPromptingPage } from '../prompting/prompting-page.ts';
import { notifications } from '../notifications.ts';
import { AchievementRuntime } from '../runtime/achievement-runtime.ts';
import { AchievementMetadataRepository } from '../runtime/metadata.ts';
import { AchievementPlayerController } from '../runtime/player-controller.ts';
import { RuntimeScheduler } from '../runtime/scheduler.ts';
import type { ModelContextReader } from '../runtime/model-context.ts';
import { ApiSettingsController } from '../settings/controller.ts';
import { mountSettingsPage } from '../settings/settings-page.ts';
import { SettingsRepository } from '../settings/storage.ts';
import { BackendSecrets, requestBackend } from '../settings/backend.ts';
import {
  MvuVariableContext,
  TavernAchievementMetadata,
  TavernChatSendingStorage,
  TavernChatContext,
  TavernTextGeneration,
  TavernWorldbooks,
} from './adapters.ts';

export interface GoblinAchievementsPluginHandle {
  mountPrompting(container: HTMLElement): () => void;
  mountSettings(container: HTMLElement): () => void;
  getPlayerView(): AchievementPlayerView;
  getPlayerScene(module: ContentModule): JournalScene;
  dispatchPlayerCommand(command: PlayerCommand): Promise<AchievementPlayerView>;
  runManual(startFloor: number, endFloor: number, moduleIds: ContentModule[]): ReturnType<AchievementRuntime['runManual']>;
  getCurrentChapterId(): string | undefined;
  setCurrentChapter(chapterId: string): Promise<void>;
  destroy(): void;
}

function validatedCatalog(candidate: unknown): ContentCatalog {
  const validated = validateContentCatalog(candidate);
  if (validated.ok) return validated.value;
  const details = validated.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ');
  throw new Error(`成就内容目录无效：${details}`);
}

export function startGoblinAchievementsPlugin(candidateCatalog: unknown, readModelContext?: ModelContextReader, candidateLayouts?: unknown, resolveImage?: ImageResolver, onPlayerViewChange?: (view: AchievementPlayerView) => void): GoblinAchievementsPluginHandle {
  const catalog = validatedCatalog(candidateCatalog);
  const emptyLayouts: ContentLayouts = {schemaVersion:1,chapters:{},storyTrees:{},bondTrees:{},careerTrees:{},skillTrees:{},combatTrees:{},knowledgeTrees:{},maps:{}};
  const validated = validateContentLayouts(candidateLayouts ?? emptyLayouts, catalog);
  if (!validated.ok) throw new Error('成就布局无效：' + validated.issues.map(issue=>`${issue.path}: ${issue.message}`).join('；'));
  const layouts = validated.value;
  const chat = new TavernChatContext();
  const generation = new TavernTextGeneration();
  const worldbooks = new TavernWorldbooks();
  const settings = new SettingsRepository(SillyTavern.accountStorage, new TavernChatSendingStorage());
  const metadata = new AchievementMetadataRepository(new TavernAchievementMetadata(), catalog);
  const runtime = new AchievementRuntime({
    catalog,
    chat,
    metadata,
    settings,
    generation,
    worldbooks,
    variables: new MvuVariableContext(),
    ...(readModelContext ? { readModelContext } : {}),
  });
  const playerController = new AchievementPlayerController(catalog, metadata);
  const settingsController = new ApiSettingsController(settings, generation, new BackendSecrets(requestBackend, window.localStorage), worldbooks);
  const promptingController = new PromptingController(settings, runtime);
  const scheduler = new RuntimeScheduler(runtime, chat, status => {
    if (status.phase === 'completed') {
      notifications.success(status.message);
      onPlayerViewChange?.(playerController.view());
    }
    else if (status.phase === 'error') notifications.error(status.message);
    else if (status.message) notifications.info(status.message);
  });
  const unmounts: Array<() => void> = [];
  scheduler.start();

  const handle: GoblinAchievementsPluginHandle = {
    mountSettings: container => mountSettingsPage(container, settingsController),
    mountPrompting: container => mountPromptingPage(container, promptingController),
    getPlayerView: () => playerController.view(),
    getPlayerScene: module => buildJournalScene(playerController.view(), layouts, module, resolveImage),
    dispatchPlayerCommand: async command => {
      const next = await playerController.dispatch(command);
      onPlayerViewChange?.(next);
      return next;
    },
    runManual: (startFloor, endFloor, moduleIds) => runtime.runManual({ startFloor, endFloor, moduleIds }),
    getCurrentChapterId: () => runtime.currentChapterId(),
    setCurrentChapter: chapterId => runtime.setCurrentChapter(chapterId),
    destroy: () => {
      scheduler.stop();
      unmounts.splice(0).forEach(unmount => unmount());
    },
  };

  const settingsPage = document.querySelector<HTMLElement>('[data-goblin-page="settings"]');
  if (settingsPage) unmounts.push(handle.mountSettings(settingsPage));
  const promptingPage = document.querySelector<HTMLElement>('[data-goblin-page="prompting"]');
  if (promptingPage) unmounts.push(handle.mountPrompting(promptingPage));
  return handle;
}
